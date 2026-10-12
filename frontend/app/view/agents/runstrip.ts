// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Pure: the per-task strip a run draws, under its row in the agent tree and as the rail's Run bar. One fill map for
// both, so the two cannot disagree about a task.

import { runProgress } from "./runlineage";
import { runSegments, type LaneState } from "./runrail";
import type { PipState } from "./runstage";

// working is blue, not the accent: clay and the error red share a lightness, and at the strip's 3px a working task
// read as a failed one
export const SEG_FILL: Record<LaneState, string> = {
    done: "bg-success",
    working: "bg-running",
    asking: "bg-warning",
    lead: "bg-running",
    pending: "bg-edge-strong",
    failed: "bg-error",
    muted: "bg-muted",
};

// the tail after a run's tasks: Final check, Wrap-up, Land (runstage.ts). Pending is the strip's own grey, so a
// tail with nothing started reads as more of the same road
export const PIP_FILL: Record<PipState, string> = {
    pending: "bg-edge-strong",
    active: "bg-running",
    done: "bg-success",
    held: "bg-warning",
    failed: "bg-error",
    skipped: "bg-muted/40",
};

// past this many tasks the segments get too thin to read in the 248px tree, so the strip becomes one bar
export const STRIP_MAX = 24;

export type TaskStrip = { kind: "segments"; states: LaneState[] } | { kind: "bar"; done: number; total: number };

export function taskStrip(dag: TaskGroup | undefined, digest: DagStatusDigest | undefined): TaskStrip | undefined {
    const states = runSegments(dag, digest);
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
