// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// The only place the frontend calls the Resource Manager RPCs. The snapshot is polled while the window is visible,
// and at once whenever the Consumers panel opens; the backend samples only while it is being asked (pkg/resmon), so
// the poll is also its keep-alive.

import { globalStore } from "@/app/store/jotaiStore";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { atom, type PrimitiveAtom } from "jotai";
import { killNote, type AgentCommand } from "./resmon";

export const RESMON_POLL_MS = 2000;
// a snapshot answers in milliseconds; a call that hangs must not hold the poll, which waits for the one in flight
export const RESMON_RPC_TIMEOUT_MS = 5000;

// null until the first snapshot lands
export const resmonSnapshotAtom = atom<ResMonSnapshotData | null>(null) as PrimitiveAtom<ResMonSnapshotData | null>;
// Windows only (pkg/resmon): there the Consumers panel shows each agent's CPU and command; elsewhere it shows RAM alone
export const resmonSupportedAtom = atom((get) => get(resmonSnapshotAtom)?.supported === true);
// the note under an agent's row after its command's kill, by tab id
export const resmonNotesAtom = atom<Record<string, { text: string; tone: "note" | "alert" }>>({}) as PrimitiveAtom<
    Record<string, { text: string; tone: "note" | "alert" }>
>;

// DEV fixture state: a pinned snapshot is never overwritten by a poll; an armed outcome answers the next kill
let pinned = false;
let armedOutcome: ResMonKillRtnData | null = null;

let inFlight = false;
let failing = false;

/** One snapshot read. `force` reads even while the document reads hidden: the panel is open, so it is in view. */
export async function pollResMon(force = false): Promise<void> {
    if (pinned || inFlight || (!force && typeof document !== "undefined" && document.hidden)) {
        return;
    }
    inFlight = true;
    try {
        const snap = await RpcApi.ResMonSnapshotCommand(TabRpcClient, {}, { timeout: RESMON_RPC_TIMEOUT_MS });
        failing = false;
        if (!pinned) {
            globalStore.set(resmonSnapshotAtom, snap ?? null);
        }
    } catch (e) {
        // keep the last snapshot; log once per streak, not every 2s
        if (!failing) {
            console.warn("resmon: snapshot failed", e);
        }
        failing = true;
    } finally {
        inFlight = false;
    }
}

export function startResMonPolling(): () => void {
    void pollResMon();
    const timer = setInterval(() => void pollResMon(), RESMON_POLL_MS);
    return () => clearInterval(timer);
}

async function runKill(cmd: AgentCommand): Promise<ResMonKillRtnData> {
    if (armedOutcome != null) {
        const r = armedOutcome;
        armedOutcome = null;
        return r;
    }
    try {
        return await RpcApi.ResMonKillCommand(TabRpcClient, { ownerid: cmd.ownerid, pid: cmd.pid, tree: true });
    } catch (e) {
        return { outcome: "failed", killed: 0, error: e instanceof Error ? e.message : String(e) };
    }
}

/** Kills an agent's command and what it started, notes the outcome under the agent's row, then reads again. */
export async function killAgentCommand(tabId: string, cmd: AgentCommand): Promise<void> {
    const r = await runKill(cmd);
    globalStore.set(resmonNotesAtom, (notes) => ({ ...notes, [tabId]: killNote(r, cmd.label) }));
    await pollResMon(true);
}

export function clearResMonNote(tabId: string): void {
    globalStore.set(resmonNotesAtom, (notes) => {
        const { [tabId]: _, ...rest } = notes;
        return rest;
    });
}

if (import.meta.env.DEV && typeof window !== "undefined") {
    window.__resmonFixture = {
        set: (s) => {
            pinned = true;
            globalStore.set(resmonSnapshotAtom, s);
        },
        killOutcome: (r) => {
            armedOutcome = r;
        },
        clear: () => {
            pinned = false;
            armedOutcome = null;
            globalStore.set(resmonNotesAtom, {});
            globalStore.set(resmonSnapshotAtom, null);
            void pollResMon();
        },
    };
}

declare global {
    interface Window {
        __resmonFixture?: {
            set: (s: ResMonSnapshotData | null) => void;
            killOutcome: (r: ResMonKillRtnData) => void;
            clear: () => void;
        };
    }
}
