// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Pure: when a parent's subagent list needs a fresh read besides its own transcript activity. The Agent
// surface's sidebar streams no transcript, so activity never stamps there: a parent's state change (a hook)
// and a slow poll while a child still reads as working are what keep its list current.

import type { SubagentVM } from "./session-models/sessionviewmodel";
import { runningBackgroundTasks, type BackgroundTask } from "./transcriptprojection";

export type StatusTrackable = { id: string; state?: string; stateSince?: number; idleSince?: number };

// how often a parent with a working child or a running background task re-reads its subagents dir and transcript: a
// background child or command runs on while its parent sits idle, so no hook of the parent's says when it ends
export const WORKING_CHILD_POLL_MS = 15_000;

function statusKey(a: StatusTrackable): string {
    return `${a.state ?? ""}:${a.stateSince ?? a.idleSince ?? ""}`;
}

/** The ids whose state changed since prev, which is updated in place. A first sighting only records its key:
 *  the enter-time refresh already read that state. Ids gone from agents are forgotten. */
export function statusChangedIds(prev: Map<string, string>, agents: StatusTrackable[]): string[] {
    const changed: string[] = [];
    const seen = new Set<string>();
    for (const a of agents) {
        seen.add(a.id);
        const key = statusKey(a);
        const old = prev.get(a.id);
        if (old != null && old !== key) {
            changed.push(a.id);
        }
        prev.set(a.id, key);
    }
    for (const id of [...prev.keys()]) {
        if (!seen.has(id)) {
            prev.delete(id);
        }
    }
    return changed;
}

/** The ids among agents with a child that still reads as working. */
export function workingChildIds(agents: { id: string }[], subs: Record<string, SubagentVM[]>): string[] {
    return agents.filter((a) => (subs[a.id] ?? []).some((s) => s.state === "working")).map((a) => a.id);
}

/** The ids among agents with a background task that still reads as running. */
export function backgroundRunningIds(agents: { id: string }[], bg: Record<string, BackgroundTask[]>): string[] {
    return agents.filter((a) => runningBackgroundTasks(bg[a.id]).length > 0).map((a) => a.id);
}
