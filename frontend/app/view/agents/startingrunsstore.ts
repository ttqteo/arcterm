// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The runs the New dialog handed off while they start (startingrunsmodel.ts): the atom the Agent tree draws a row from,
// and the start, cancel, retry and dismiss behind that row. In memory only: a start is the frontend's await on
// CreateRun, so a reload drops the row, and the run, once it exists, shows as its lead.

import { globalStore } from "@/app/store/jotaiStore";
import { fireAndForget } from "@/util/util";
import { atom, type PrimitiveAtom } from "jotai";
import { handBackStartedRun } from "./launcherrun";
import { cancelRun } from "./runactions";
import { patchStarting, type StartingRun } from "./startingrunsmodel";

export const startingRunsAtom = atom<StartingRun[]>([]) as PrimitiveAtom<StartingRun[]>;

type Launch = {
    start: () => Promise<{ channelId: string; run: Run }>;
    onStarted?: ((runId: string) => void) | null;
};

// each row's start, kept for Try again; it goes with the row
const launches = new Map<string, Launch>();

function patch(id: string, p: Partial<StartingRun>): void {
    globalStore.set(startingRunsAtom, (prev) => patchStarting(prev, id, p));
}

function drop(id: string): void {
    launches.delete(id);
    globalStore.set(startingRunsAtom, (prev) => prev.filter((r) => r.id !== id));
}

function stateOf(id: string): StartingRun["state"] | undefined {
    return globalStore.get(startingRunsAtom).find((r) => r.id === id)?.state;
}

function run(id: string, launch: Launch): void {
    fireAndForget(async () => {
        let started: { channelId: string; run: Run };
        try {
            started = await launch.start();
        } catch (e) {
            if (stateOf(id) === "cancelling") {
                drop(id);
            } else {
                patch(id, { state: "failed", error: String(e) });
            }
            return;
        }
        if (stateOf(id) === "cancelling") {
            try {
                await cancelRun(started.channelId, started.run.id);
            } finally {
                drop(id);
            }
            return;
        }
        drop(id);
        handBackStartedRun(launch.onStarted, started.run.id);
    });
}

/** Starts a run behind a row: the row reads Starting until CreateRun returns, then goes, and the run's lead takes its
 *  place in the folder. A start cancelled meanwhile cancels the run it made when that returns; a start that fails keeps
 *  its row, Failed with the reason, for Try again or Dismiss. `onStarted` is the caller that filled the dialog (a
 *  brainstorm's Approve), told the run's id. */
export function startRunInBackground(input: { project: string; title: string } & Launch): void {
    const id = crypto.randomUUID();
    const row: StartingRun = { id, project: input.project, title: input.title, ts: Date.now(), state: "starting" };
    const launch: Launch = { start: input.start, onStarted: input.onStarted };
    launches.set(id, launch);
    globalStore.set(startingRunsAtom, (prev) => [...prev, row]);
    run(id, launch);
}

/** The row's Cancel: the start cannot be stopped mid-way, so the run it makes is cancelled the moment it exists. */
export function cancelStartingRun(id: string): void {
    if (stateOf(id) === "starting") {
        patch(id, { state: "cancelling" });
    }
}

/** A failed start's Try again: the same start, with the goal, project and route the dialog sent. */
export function retryStartingRun(id: string): void {
    const launch = launches.get(id);
    if (stateOf(id) !== "failed" || launch == null) {
        return;
    }
    patch(id, { state: "starting", ts: Date.now(), error: undefined });
    run(id, launch);
}

/** A failed start's row goes. */
export function dismissStartingRun(id: string): void {
    if (stateOf(id) === "failed") {
        drop(id);
    }
}
