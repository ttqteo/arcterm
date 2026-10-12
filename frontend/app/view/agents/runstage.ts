// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// A run's stage, said one way everywhere. A run carries four state machines (run.status, dag.status,
// dag.final.state, run.land.state), and the Agent tree, the Brief and the run sheet each used to combine a
// different subset, so one stage read four ways. This is the one combination: where the run is, whether it
// needs you, how it came out, and the strip's tail. Pure: no React, no Wave runtime imports.

import type { RunInfo } from "./runlineage";

export type RunStageKey =
    | "planning"
    | "plan-review"
    | "working"
    | "final-check"
    | "wrapping-up"
    | "landing"
    | "land-held"
    | "landed"
    | "complete"
    | "cancelled";
export type PipState = "pending" | "active" | "done" | "held" | "failed" | "skipped";
// working is a task at work (green, like an agent); running is the engine moving the run on (blue)
export type StageTone = "working" | "running" | "asking" | "done" | "error" | "muted";
export type TailPip = { name: "Final check" | "Wrap-up" | "Land"; state: PipState };

export interface RunStageView {
    key: RunStageKey;
    label: string;
    tone: StageTone;
    needsYou: boolean;
    outcome: "" | "passed" | "unverified" | "failed";
    complete: boolean;
    tail: TailPip[];
}

const LABEL: Record<RunStageKey, string> = {
    planning: "Planning",
    "plan-review": "Plan review",
    working: "Working",
    "final-check": "Final check",
    "wrapping-up": "Wrapping up",
    landing: "Landing",
    "land-held": "Land held",
    landed: "Landed",
    complete: "Complete",
    cancelled: "Cancelled",
};

// lifecycle order, for "is the run past this stage"; land-held sits with landing
const ORDER: RunStageKey[] = [
    "planning",
    "plan-review",
    "working",
    "final-check",
    "wrapping-up",
    "landing",
    "land-held",
    "landed",
    "complete",
];

function stageKey(run: Pick<RunInfo, "status" | "land" | "dag">): RunStageKey {
    const status = run.status ?? "";
    const dagStatus = run.dag?.status ?? "";
    if (status === "cancelled" || dagStatus === "cancelled") {
        return "cancelled";
    }
    // a done run on its own branch is not in its base until the branch lands, whatever its dag still says (a human
    // can land a run whose final stage failed, and its dag stays blocked). With no land there is nothing to land,
    // so it is complete, unless its dag is itself unfinished: that run is not over, so it reads by its dag below.
    const land = run.land?.state;
    if (status === "done" && (land != null || run.dag == null || dagStatus === "done")) {
        return land == null ? "complete" : land === "landed" ? "landed" : land === "held" ? "land-held" : "landing";
    }
    if (dagStatus === "done") {
        return "wrapping-up";
    }
    if (dagStatus === "finalizing") {
        return "final-check";
    }
    if (dagStatus === "plan-review" || status === "awaiting-review" || status === "plan-review") {
        return "plan-review";
    }
    if (run.dag != null || status === "executing" || status === "blocked") {
        return "working";
    }
    return "planning";
}

export function runStage(run: Pick<RunInfo, "status" | "land" | "dag">, asking = false): RunStageView {
    const key = stageKey(run);
    const status = run.status ?? "";
    const dagStatus = run.dag?.status ?? "";
    const finalState = run.dag?.final?.state ?? "";
    const outcome = finalState === "passed" || finalState === "unverified" || finalState === "failed" ? finalState : "";
    const past = (k: RunStageKey) => key !== "cancelled" && ORDER.indexOf(key) > ORDER.indexOf(k);
    const needsYou =
        key !== "cancelled" &&
        (asking ||
            status === "awaiting-review" ||
            status === "blocked" ||
            dagStatus === "blocked" ||
            dagStatus === "awaiting-review" ||
            (key === "land-held" && run.land?.dismissed !== true));
    const complete = key === "landed" || key === "complete";
    const tone: StageTone =
        key === "cancelled"
            ? "muted"
            : needsYou
              ? "asking"
              : finalState === "failed" && !complete
                ? "error"
                : complete
                  ? outcome === "unverified"
                      ? "asking"
                      : "done"
                  : key === "working"
                    ? "working"
                    : "running";

    const landPip: PipState =
        key === "cancelled" || key === "complete"
            ? "skipped"
            : key === "landed"
              ? "done"
              : key === "land-held"
                ? "held"
                : key === "landing"
                  ? "active"
                  : "pending";
    let tail: TailPip[];
    if (run.dag == null) {
        tail = [{ name: "Land", state: landPip }];
    } else {
        const finalPip: PipState =
            key === "cancelled"
                ? "skipped"
                : finalState === "failed"
                  ? "failed"
                  : key === "final-check"
                    ? "active"
                    : past("final-check")
                      ? outcome === "unverified"
                          ? "held"
                          : "done"
                      : "pending";
        const wrapPip: PipState =
            key === "cancelled"
                ? "skipped"
                : key === "wrapping-up"
                  ? "active"
                  : past("wrapping-up")
                    ? "done"
                    : "pending";
        tail = [
            { name: "Final check", state: finalPip },
            { name: "Wrap-up", state: wrapPip },
            { name: "Land", state: landPip },
        ];
    }
    return { key, label: LABEL[key], tone, needsYou, outcome, complete, tail };
}
