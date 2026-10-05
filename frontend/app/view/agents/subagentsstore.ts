// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Disk-backed subagent lists per parent agent, plus the "which child interior is open" selection.
// Also holds each parent's background shell tasks, read from the same transcript tail (no extra RPC).
// Mirrors cardgitstore.ts: refresh on enter, scheduleSubagents (debounced) on parent-transcript
// activity, drop on leave. The source of truth is the on-disk subagents/ dir (GetSubagentsCommand);
// the parent transcript tail supplies the Task spawns that correlate type + outcome onto each file.

import { globalStore } from "@/app/store/jotaiStore";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { atom, type PrimitiveAtom } from "jotai";
import type { SubagentVM } from "./session-models/sessionviewmodel";
import { correlateSubagents } from "./subagentcorrelate";
import { extractBackgroundTasks, extractSubagentSpawns, type BackgroundTask } from "./transcriptprojection";

export interface FocusSubagent {
    parentId: string;
    agentId: string;
    transcriptPath: string;
    label: string;
}

// per parent-agent-id -> its correlated children
export const subagentsByIdAtom = atom<Record<string, SubagentVM[]>>({}) as PrimitiveAtom<Record<string, SubagentVM[]>>;
// per parent-agent-id -> its background shell tasks, from the same transcript tail as the subagent spawns
export const backgroundTasksByIdAtom = atom<Record<string, BackgroundTask[]>>({}) as PrimitiveAtom<
    Record<string, BackgroundTask[]>
>;
// the child interior currently open in the focused view (null = show the parent terminal)
export const focusSubagentAtom = atom<FocusSubagent | null>(null) as PrimitiveAtom<FocusSubagent | null>;

const PARENT_TAIL_LINES = 1000; // covers the current turn's Task spawns + results
const DEBOUNCE_MS = 4000; // same cadence as cardgitstore
const timers = new Map<string, ReturnType<typeof setTimeout>>();
const loadSeq = new Map<string, number>();

function setIn<T>(a: PrimitiveAtom<Record<string, T[]>>, id: string, list: T[] | null): void {
    const cur = globalStore.get(a);
    if (list == null || list.length === 0) {
        if (!(id in cur)) {
            return;
        }
        const { [id]: _, ...rest } = cur;
        globalStore.set(a, rest);
        return;
    }
    globalStore.set(a, { ...cur, [id]: list });
}

/** Load the parent's subagent files + tail its transcript, correlate, and store. Guarded so a
 *  superseding load (or a drop) discards a slower older result. */
export async function refreshSubagents(id: string, transcriptPath: string | undefined): Promise<void> {
    const seq = (loadSeq.get(id) ?? 0) + 1;
    loadSeq.set(id, seq);
    if (!transcriptPath) {
        setIn(subagentsByIdAtom, id, null);
        setIn(backgroundTasksByIdAtom, id, null);
        return;
    }
    try {
        const [subs, tr] = await Promise.all([
            RpcApi.GetSubagentsCommand(TabRpcClient, { path: transcriptPath }),
            RpcApi.GetAgentTranscriptCommand(TabRpcClient, { path: transcriptPath, maxlines: PARENT_TAIL_LINES }),
        ]);
        if (loadSeq.get(id) !== seq) {
            return;
        }
        setIn(backgroundTasksByIdAtom, id, extractBackgroundTasks(tr.lines ?? []));
        const files = subs.subagents ?? [];
        if (files.length === 0) {
            setIn(subagentsByIdAtom, id, null);
            return;
        }
        setIn(subagentsByIdAtom, id, correlateSubagents(extractSubagentSpawns(tr.lines ?? []), files));
    } catch {
        if (loadSeq.get(id) === seq) {
            setIn(subagentsByIdAtom, id, null);
            setIn(backgroundTasksByIdAtom, id, null);
        }
    }
}

/** Debounced refresh, coalescing a burst of parent activity into one load. */
export function scheduleSubagents(id: string, transcriptPath: string | undefined): void {
    const existing = timers.get(id);
    if (existing) {
        clearTimeout(existing);
    }
    timers.set(
        id,
        setTimeout(() => {
            timers.delete(id);
            void refreshSubagents(id, transcriptPath);
        }, DEBOUNCE_MS)
    );
}

/** Stop tracking a parent that left the rendered set: cancel pending work, invalidate in-flight loads,
 *  drop its list, and close the interior if it belonged to this parent. */
export function dropSubagents(id: string): void {
    const existing = timers.get(id);
    if (existing) {
        clearTimeout(existing);
        timers.delete(id);
    }
    loadSeq.set(id, (loadSeq.get(id) ?? 0) + 1);
    setIn(subagentsByIdAtom, id, null);
    setIn(backgroundTasksByIdAtom, id, null);
    const fs = globalStore.get(focusSubagentAtom);
    if (fs && fs.parentId === id) {
        globalStore.set(focusSubagentAtom, null);
    }
}
