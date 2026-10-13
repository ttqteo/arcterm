// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// The only place the frontend calls the Resource Manager RPCs. The snapshot is polled while the window is
// visible; the backend samples only while it is being asked (pkg/resmon), so the poll is also its keep-alive.

import { globalStore } from "@/app/store/jotaiStore";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { atom, type PrimitiveAtom } from "jotai";
import { outcomeNote, RESMON_UI_INITIAL, resmonReduce, rowLabel, type ResMonAction, type ResMonUi } from "./resmon";

export const RESMON_POLL_MS = 2000;

// null until the first snapshot lands
export const resmonSnapshotAtom = atom<ResMonSnapshotData | null>(null) as PrimitiveAtom<ResMonSnapshotData | null>;
export const resmonOpenAtom = atom(false) as PrimitiveAtom<boolean>;
export const resmonUiAtom = atom<ResMonUi>(RESMON_UI_INITIAL) as PrimitiveAtom<ResMonUi>;

// DEV fixture state: a pinned snapshot is never overwritten by a poll; an armed outcome answers the next confirm
let pinned = false;
let armedOutcome: ResMonKillRtnData | null = null;

let inFlight = false;
let failing = false;

async function pollOnce(): Promise<void> {
    if (pinned || inFlight || (typeof document !== "undefined" && document.hidden)) {
        return;
    }
    inFlight = true;
    try {
        const snap = await RpcApi.ResMonSnapshotCommand(TabRpcClient, {});
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
    void pollOnce();
    const timer = setInterval(() => void pollOnce(), RESMON_POLL_MS);
    return () => clearInterval(timer);
}

export function dispatchResMon(a: ResMonAction): void {
    globalStore.set(resmonUiAtom, (ui) => resmonReduce(ui, a));
}

async function runKill(g: ResMonGroup, pid: number | null): Promise<ResMonKillRtnData> {
    if (armedOutcome != null) {
        const r = armedOutcome;
        armedOutcome = null;
        return r;
    }
    try {
        if (pid != null) {
            return await RpcApi.ResMonKillCommand(TabRpcClient, { ownerid: g.ownerid ?? "", pid, tree: true });
        }
        return await RpcApi.ResMonKillChildrenCommand(TabRpcClient, { ownerid: g.ownerid ?? "" });
    } catch (e) {
        return { outcome: "failed", killed: 0, error: e instanceof Error ? e.message : String(e) };
    }
}

export async function confirmResMon(): Promise<void> {
    const confirm = globalStore.get(resmonUiAtom).confirm;
    if (confirm == null) {
        return;
    }
    // cleared before the kill runs, so a second Enter cannot send it twice
    dispatchResMon({ type: "cancel" });
    const g = globalStore.get(resmonSnapshotAtom)?.groups.find((x) => x.key === confirm.key);
    if (g == null) {
        return;
    }
    const pid = confirm.kind === "row" ? confirm.pid : null;
    const row = pid == null ? null : g.rows.find((r) => r.pid === pid);
    const target = pid == null ? null : { name: row ? rowLabel(row).name : "process", pid };
    const r = await runKill(g, pid);
    dispatchResMon({ type: "note", key: g.key, note: outcomeNote(r, target, g) });
    await pollOnce();
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
        open: () => globalStore.set(resmonOpenAtom, true),
        clear: () => {
            pinned = false;
            armedOutcome = null;
            globalStore.set(resmonOpenAtom, false);
            globalStore.set(resmonUiAtom, RESMON_UI_INITIAL);
            globalStore.set(resmonSnapshotAtom, null);
            void pollOnce();
        },
    };
}

declare global {
    interface Window {
        __resmonFixture?: {
            set: (s: ResMonSnapshotData | null) => void;
            killOutcome: (r: ResMonKillRtnData) => void;
            open: () => void;
            clear: () => void;
        };
    }
}
