// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// The Setup surface's Memory tab: its atoms and the memhygiene RPCs. Module-level atoms because the
// Setup surface unmounts on a switch, and the selected project and change must survive one (the
// memhygiene address also writes them before it switches here).

import { globalStore } from "@/app/store/jotaiStore";
import { waveEventSubscribeSingle } from "@/app/store/wps";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { fireAndForget } from "@/util/util";
import { atom, type PrimitiveAtom } from "jotai";

// list and check read state files and return at once; decide copies backups and writes files, so it
// gets more room before a stalled backend is reported
const READ_TIMEOUT_MS = 5000;
const DECIDE_TIMEOUT_MS = 15000;

export type MemVerdict = "apply" | "keep" | "undo" | "reopen";

// null = not read yet
export const memoryProjectsAtom = atom<MemHygieneProject[] | null>(null) as PrimitiveAtom<MemHygieneProject[] | null>;
export const memorySelectedProjectAtom = atom<string | null>(null) as PrimitiveAtom<string | null>;
export const memorySelectedChangeAtom = atom<string | null>(null) as PrimitiveAtom<string | null>;
export const memoryErrorAtom = atom<string | null>(null) as PrimitiveAtom<string | null>;
export const memoryBusyAtom = atom<boolean>(false) as PrimitiveAtom<boolean>;

function errText(e: unknown): string {
    return e instanceof Error ? e.message : String(e);
}

// an update event can start a list while an earlier one is still in flight; only the latest may land
let loadSeq = 0;

export async function loadMemory(): Promise<void> {
    const seq = ++loadSeq;
    try {
        const rtn = await RpcApi.ListMemoryHygieneCommand(TabRpcClient, { timeout: READ_TIMEOUT_MS });
        if (seq === loadSeq) {
            globalStore.set(memoryProjectsAtom, rtn.projects ?? []);
        }
    } catch (e) {
        globalStore.set(memoryErrorAtom, `Could not read memory checks: ${errText(e)}`);
    }
}

// every state write publishes memhygiene:update with no payload, so the tab re-lists while it is open
export function subscribeMemory(): () => void {
    return waveEventSubscribeSingle({
        eventType: "memhygiene:update",
        handler: () => fireAndForget(loadMemory),
    });
}

export function selectMemoryProject(name: string): void {
    globalStore.set(memorySelectedProjectAtom, name);
    globalStore.set(memorySelectedChangeAtom, null);
}

export function selectMemoryChange(id: string): void {
    globalStore.set(memorySelectedChangeAtom, id);
}

async function busy(fn: () => Promise<void>): Promise<void> {
    globalStore.set(memoryBusyAtom, true);
    globalStore.set(memoryErrorAtom, null);
    try {
        await fn();
    } catch (e) {
        globalStore.set(memoryErrorAtom, errText(e));
    } finally {
        globalStore.set(memoryBusyAtom, false);
    }
}

// the check runs in the background and returns at once; re-list so "Checking…" shows without waiting
// on the update event
export function checkMemory(project: string): Promise<void> {
    return busy(async () => {
        try {
            await RpcApi.CheckMemoryHygieneCommand(TabRpcClient, { project }, { timeout: READ_TIMEOUT_MS });
        } catch (e) {
            throw new Error(`Could not start the check of ${project}: ${errText(e)}`);
        }
        await loadMemory();
    });
}

export function decideMemory(project: string, changeId: string, verdict: MemVerdict): Promise<void> {
    return busy(async () => {
        let updated: MemHygieneProject;
        try {
            updated = await RpcApi.DecideMemoryChangeCommand(
                TabRpcClient,
                { project, changeid: changeId, verdict },
                { timeout: DECIDE_TIMEOUT_MS }
            );
        } catch (e) {
            throw new Error(`Could not ${verdict} the change in ${project}: ${errText(e)}`);
        }
        const projects = globalStore.get(memoryProjectsAtom);
        if (updated != null && projects != null) {
            // a list started before the decision would land older state over it
            loadSeq++;
            globalStore.set(
                memoryProjectsAtom,
                projects.map((p) => (p.project === updated.project ? updated : p))
            );
        }
    });
}
