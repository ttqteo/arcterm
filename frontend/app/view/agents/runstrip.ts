// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Pure: the per-task strip a run draws, under its row in the agent tree and as the rail's Run bar. One fill map for
// both, so the two cannot disagree about a task.

import type { FinalTone } from "./finalstage";
import { runProgress } from "./runlineage";
import { runSegments, type LaneState } from "./runrail";
import type { PipState } from "./runstage";

// working is the status green and pulses, never the accent: a blue accent read as focus, and clay as the error red
// at the strip's 3px. Done is the same green dimmed, so a task at work stands out from the ones behind it
export const SEG_FILL: Record<LaneState, string> = {
    done: "bg-success/45",
    working: "bg-working pulse-dot",
    asking: "bg-warning",
    lead: "bg-working",
    pending: "bg-edge-strong",
    failed: "bg-error",
    muted: "bg-muted",
};

// the tail after a run's tasks: Final check, Wrap-up, Land (runstage.ts). Pending is the strip's own grey, so a
// tail with nothing started reads as more of the same road
export const PIP_FILL: Record<PipState, string> = {
    pending: "bg-edge-strong",
    active: "bg-working pulse-dot",
    paused: "bg-muted",
    done: "bg-success/45",
    held: "bg-warning",
    failed: "bg-error",
    skipped: "bg-muted/40",
};

// past this many tasks the segments get too thin to read in the 248px tree, so the strip becomes one bar
export const STRIP_MAX = 24;

export type TaskStrip = { kind: "segments"; states: LaneState[] } | { kind: "bar"; done: number; total: number };

// a paused run (runStage().paused) has nothing at work: its working tasks hold still in the muted grey instead of pulsing
export function taskStrip(
    dag: TaskGroup | undefined,
    digest: DagStatusDigest | undefined,
    paused = false
): TaskStrip | undefined {
    const live = runSegments(dag, digest);
    const states = paused ? live.map((s): LaneState => (s === "working" ? "muted" : s)) : live;
    if (states.length === 0) {
        return undefined;
    }
    if (states.length > STRIP_MAX) {
        return { kind: "bar", ...runProgress(dag) };
    }
    return { kind: "segments", states };
}

export function taskStripLabel(dag: TaskGroup | undefined, digest: DagStatusDigest | undefined): string {
    const { done, total } = runProgress(dag);
    const asking = runSegments(dag, digest).filter((s) => s === "asking").length;
    return `${done} of ${total} tasks done${asking > 0 ? `, ${asking} asking you` : ""}`;
}

// the final stage's fill by tone, from the task fills so a slot and a segment cannot disagree about a color
export const FINAL_FILL: Record<FinalTone, string> = {
    wait: SEG_FILL.pending,
    run: SEG_FILL.working,
    pass: SEG_FILL.done,
    fail: SEG_FILL.failed,
    warn: SEG_FILL.asking,
};
