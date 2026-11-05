// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// What a run's ⋯ menu holds: Pause while the run can be paused, Resume while it is paused, and nothing for a run that is
// neither (a finished run, a child run), which then draws no ⋯ at all. The rules are runmodel's canPause and
// canResumePaused, the one source every Pause and Resume control reads. Pure: no React, no Wave runtime.

import { canPause, canResumePaused } from "./runmodel";

// anything canPause reads: a Run, or the RunInfo of a tree row or a lead card
export type RunMenuRun = Parameters<typeof canPause>[0];

export type RunMenuKey = "pause" | "resume";

export interface RunMenuChoice {
    key: RunMenuKey;
    label: string;
    title: string;
    /** off while this run's Pause or Resume call is still in flight, which takes a moment: its agents are being stopped or reopened */
    enabled: boolean;
}

/** Pure: the menu's items in order, from the run and which of its calls are in flight. */
export function runMenuChoices(run: RunMenuRun, inFlight: { pausing: boolean; resuming: boolean }): RunMenuChoice[] {
    const choices: RunMenuChoice[] = [];
    if (canPause(run)) {
        choices.push({
            key: "pause",
            label: inFlight.pausing ? "Pausing…" : "Pause",
            title: "Suspend this run's agents to free their memory; Resume reopens them in their own sessions",
            enabled: !inFlight.pausing,
        });
    }
    if (canResumePaused(run)) {
        choices.push({
            key: "resume",
            label: inFlight.resuming ? "Resuming…" : "Resume",
            title: "Reopen this run's agents in their own sessions",
            enabled: !inFlight.resuming,
        });
    }
    return choices;
}
