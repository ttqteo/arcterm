// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Which agent each agent waits on, read off the background tasks still running in it: a `wsh agents wait <tab>` (what
// the cockpit-runs skill teaches), else a task that only watches (a Monitor, a loop that sleeps) and names another live
// agent's tab id, as the 8-character prefix `wsh agents list` prints or more. The tree nests a waiter under the agent
// it waits on (agenttreemodel.ts).

import { onlyWatches } from "./bgactivity";
import { runningBackgroundTasks, type BackgroundTask } from "./transcriptprojection";

// what follows `wsh agents wait` up to the end of its command: its flags and the tab
const WAIT_ARGS = /\bwsh\s+agents\s+wait\b([^|;&\n]*)/;
// a tab id or a prefix of one: a word of lowercase hex, dashes past the first 4 characters
const TAB_WORD = /^[0-9a-f]{4}[0-9a-f-]*$/;
// a tab id's prefix inside a longer command
const TAB_PREFIX = /\b[0-9a-f]{8}\b/g;

function waitTokens(task: BackgroundTask): string[] {
    const command = task.command ?? "";
    const args = WAIT_ARGS.exec(command)?.[1];
    if (args != null) {
        return args.split(/\s+/).filter((w) => TAB_WORD.test(w));
    }
    return onlyWatches(task) ? [...command.matchAll(TAB_PREFIX)].map((m) => m[0]) : [];
}

/** Pure: the id of the live agent (`agentIds`, the roster) a running background task of `selfId` waits on, or null.
 *  A word matches when exactly one other agent's id starts with it. */
export function waitTarget(
    tasks: BackgroundTask[] | undefined,
    selfId: string,
    agentIds: readonly string[]
): string | null {
    for (const task of runningBackgroundTasks(tasks)) {
        for (const word of waitTokens(task)) {
            const hits = agentIds.filter((id) => id !== selfId && id.startsWith(word));
            if (hits.length === 1) {
                return hits[0];
            }
        }
    }
    return null;
}

/** Pure: waiter id -> the id of the agent it waits on, for every agent of the roster that waits on another. */
export function waitMap(
    agents: readonly { id: string }[],
    bgTasks: Readonly<Record<string, BackgroundTask[]>>
): Map<string, string> {
    const ids = agents.map((a) => a.id);
    const out = new Map<string, string>();
    for (const a of agents) {
        const target = waitTarget(bgTasks[a.id], a.id, ids);
        if (target != null) {
            out.set(a.id, target);
        }
    }
    return out;
}
