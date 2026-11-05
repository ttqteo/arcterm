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
import {
    checkResult,
    isPending,
    nextPending,
    projectsToReview,
    resolveSelection,
    type MemorySelection,
    type StatusText,
} from "./memorymodel";

// list and check read state files and return at once; decide copies backups and writes files, so it
// gets more room before a stalled backend is reported
const READ_TIMEOUT_MS = 5000;
const DECIDE_TIMEOUT_MS = 15000;
// long enough to read; it goes stale once the user starts deciding the changes it counts
const RESULT_SHOW_MS = 5000;

export type MemVerdict = "apply" | "keep" | "undo" | "reopen";

// null = not read yet
export const memoryProjectsAtom = atom<MemHygieneProject[] | null>(null) as PrimitiveAtom<MemHygieneProject[] | null>;
export const memorySelectedProjectAtom = atom<string | null>(null) as PrimitiveAtom<string | null>;
export const memorySelectedChangeAtom = atom<string | null>(null) as PrimitiveAtom<string | null>;
export const memoryErrorAtom = atom<string | null>(null) as PrimitiveAtom<string | null>;
export const memoryBusyAtom = atom<boolean>(false) as PrimitiveAtom<boolean>;
// an Apply all in flight: its group and how far it got
export const memoryBulkAtom = atom<BulkProgress | null>(null) as PrimitiveAtom<BulkProgress | null>;
// what the last check this tab started found, shown beside Check now for a few seconds
export const memoryCheckResultAtom = atom<CheckResult | null>(null) as PrimitiveAtom<CheckResult | null>;

export interface BulkProgress {
    project: string;
    group: string;
    done: number;
    total: number;
}

export interface CheckResult extends StatusText {
    project: string;
}

function errText(e: unknown): string {
    return e instanceof Error ? e.message : String(e);
}

// an update event can start a list while an earlier one is still in flight; only the latest may land
let loadSeq = 0;

// projects whose check this tab started and has not yet seen end
const started = new Set<string>();
let resultTimer: ReturnType<typeof setTimeout> | undefined;

function noteEnded(projects: MemHygieneProject[]): void {
    for (const p of projects) {
        if (!started.has(p.project) || p.checking) {
            continue;
        }
        started.delete(p.project);
        clearTimeout(resultTimer);
        globalStore.set(memoryCheckResultAtom, { project: p.project, ...checkResult(p) });
        resultTimer = setTimeout(() => globalStore.set(memoryCheckResultAtom, null), RESULT_SHOW_MS);
    }
}

export async function loadMemory(): Promise<void> {
    const seq = ++loadSeq;
    try {
        const rtn = await RpcApi.ListMemoryHygieneCommand(TabRpcClient, { timeout: READ_TIMEOUT_MS });
        if (seq === loadSeq) {
            globalStore.set(memoryProjectsAtom, rtn.projects ?? []);
            noteEnded(rtn.projects ?? []);
        }
    } catch (e) {
        globalStore.set(memoryErrorAtom, `Could not read memory checks: ${errText(e)}`);
    }
}

let feeding = false;

// the nav rail's Setup badge counts the projects to review while Setup is closed, so the list is read once at
// start and again on every memhygiene:update (each state write publishes one, with no payload) for the app's life
export function ensureMemoryFeed(): void {
    if (feeding) {
        return;
    }
    feeding = true;
    waveEventSubscribeSingle({
        eventType: "memhygiene:update",
        handler: () => fireAndForget(loadMemory),
    });
    fireAndForget(loadMemory);
}

// the projects with a change still to review: the Setup badge and the Memory tab's count
export const memoryToReviewAtom = atom((get) => projectsToReview(get(memoryProjectsAtom) ?? []));

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
// on the update event. the first list after a successful start that reads it not checking is its end:
// loadSeq keeps a list begun before the start from landing.
export function checkMemory(project: string): Promise<void> {
    return busy(async () => {
        globalStore.set(memoryCheckResultAtom, null);
        try {
            await RpcApi.CheckMemoryHygieneCommand(TabRpcClient, { project }, { timeout: READ_TIMEOUT_MS });
        } catch (e) {
            throw new Error(`Could not start the check of ${project}: ${errText(e)}`);
        }
        started.add(project);
        await loadMemory();
    });
}

// the shown project and change, as the tab draws them
export function memorySelection(): MemorySelection {
    return resolveSelection(
        globalStore.get(memoryProjectsAtom),
        globalStore.get(memorySelectedProjectAtom),
        globalStore.get(memorySelectedChangeAtom)
    );
}

async function decideOne(project: string, changeId: string, verdict: MemVerdict): Promise<MemHygieneProject> {
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
    return updated;
}

// once the shown change is decided, show the next one still to review. a change found changed on disk stays,
// since its alert is what to read next.
function advanceFrom(updated: MemHygieneProject | null, changeId: string): void {
    const shown = updated?.changes.find((c) => c.id === changeId);
    if (updated == null || shown == null || isPending(shown) || memorySelection().change?.id !== changeId) {
        return;
    }
    const next = nextPending(updated, changeId);
    if (next != null) {
        globalStore.set(memorySelectedChangeAtom, next);
    }
}

export function decideMemory(project: string, changeId: string, verdict: MemVerdict): Promise<void> {
    return busy(async () => {
        const updated = await decideOne(project, changeId, verdict);
        if (verdict === "apply" || verdict === "keep") {
            advanceFrom(updated, changeId);
        }
    });
}

// one apply at a time: each rewrites the same MEMORY.md. a failure stops the run where it is; a change found
// changed on disk is marked so and the run goes on.
export function applyMemoryGroup(project: string, group: string, ids: string[]): Promise<void> {
    const shownBefore = memorySelection().change?.id ?? null;
    return busy(async () => {
        let updated: MemHygieneProject | null = null;
        try {
            for (const [i, id] of ids.entries()) {
                globalStore.set(memoryBulkAtom, { project, group, done: i, total: ids.length });
                updated = await decideOne(project, id, "apply");
            }
        } finally {
            globalStore.set(memoryBulkAtom, null);
            if (shownBefore != null) {
                advanceFrom(updated, shownBefore);
            }
        }
    });
}
