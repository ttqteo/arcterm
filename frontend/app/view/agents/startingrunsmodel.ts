// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// A run the New dialog handed off while it starts: CreateRun builds the landing tree and the lead before it returns,
// which can take minutes, so the dialog closes at once and the run waits as a row in its project's folder until it
// exists. Pure wording and state; startingrunsstore.ts holds the atom and the actions, agenttree.tsx the row.

import { formatAgeShort } from "./agentsviewmodel";
import { lastPathSegment } from "./runlineage";

export type StartingRunState = "starting" | "cancelling" | "failed";

export type StartingRun = {
    id: string;
    project: string;
    title: string;
    ts: number; // when it was handed off (UnixMilli)
    state: StartingRunState;
    error?: string;
};

/** Pure: what the row is called: the goal's first line, or the plan file's name for a start from a plan. */
export function startingTitle(goal: string, planPath: string): string {
    const plan = planPath.trim();
    if (plan !== "") {
        return lastPathSegment(plan);
    }
    return (
        goal
            .split(/\r?\n/)
            .map((l) => l.trim())
            .find((l) => l !== "") ?? "Run"
    );
}

/** Pure: the row's second line. A start reads its age, so a slow one is seen to be slow. */
export function startingMeta(r: StartingRun, now: number): string {
    switch (r.state) {
        case "cancelling":
            return "Cancelling…";
        case "failed":
            return r.error ? `Failed · ${r.error}` : "Failed";
        default:
            return `Starting · ${formatAgeShort(now - r.ts)}`;
    }
}

/** Pure: one row changed by id; the list as it was when the id is not in it. */
export function patchStarting(list: readonly StartingRun[], id: string, patch: Partial<StartingRun>): StartingRun[] {
    return list.map((r) => (r.id === id ? { ...r, ...patch } : r));
}
