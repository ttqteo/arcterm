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
    /** the run is paused (PAUSED_LABEL): its label and tone say so, and its key is the stage it stopped in */
    paused: boolean;
    tail: TailPip[];
}

/** What a paused run says wherever its stage is shown: the Agent tree, the Brief and the run sheet. A pause is not a
 *  stage of its own: the run keeps the stage it stopped in (its dag, tasks and tail stand as they were), and only its
 *  words and tone change, since nothing in it is moving. Only a top-level run reads paused (its status), and done and
 *  cancelled win over it. */
export const PAUSED_LABEL = "Paused · resumes when memory frees";
/** A run the person paused: Arc never resumes it on its own, not when memory frees and not at a restart. */
export const PAUSED_BY_YOU_LABEL = "Paused · until you resume";

/** A run one of its agents paused at the account's usage limit, when the reset time is not known. */
export const PAUSED_AT_LIMIT_LABEL = "Paused · usage limit, resumes after the reset";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Pure: the local time a run paused at the usage limit resumes after, "05:02", or "Thu 05:02" on another day than
 *  now's. */
export function resumeClock(at: number, now: number): string {
    const d = new Date(at);
    const hhmm = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
    return d.toDateString() === new Date(now).toDateString() ? hhmm : `${WEEKDAYS[d.getDay()]} ${hhmm}`;
}

/** Pure: a paused run's words, by who paused it (its Pause.by: "manual" is the person, "limit" an agent at the usage
 *  limit, which resumes after resumeAt, its Pause.noautoresumeuntil). */
export function pausedLabel(by: string | undefined, resumeAt?: number, now: number = Date.now()): string {
    if (by === "manual") {
        return PAUSED_BY_YOU_LABEL;
    }
    if (by === "limit") {
        return resumeAt ? `Paused · usage limit, resumes ${resumeClock(resumeAt, now)}` : PAUSED_AT_LIMIT_LABEL;
    }
    return PAUSED_LABEL;
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
    // a done run's cancelled dag is not a cancelled run: the engine closes the dag a run left behind when it ended
    // (Land anyway after a failed final leaves it blocked; endedRunSettles), so that run reads by its land below
    if (status === "cancelled" || (dagStatus === "cancelled" && status !== "done")) {
        return "cancelled";
    }
    // a done run on its own branch is not in its base until the branch lands, whatever its dag still says (a human
    // can land a run whose final stage failed, and its dag stays blocked). With no land there is nothing to land,
    // so it is complete, unless its dag is itself unfinished: that run is not over, so it reads by its dag below.
    const land = run.land?.state;
    if (status === "done" && (land != null || run.dag == null || dagStatus === "done" || dagStatus === "cancelled")) {
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
    // a paused run is mid-work, with or without a dag
    if (run.dag != null || status === "executing" || status === "blocked" || status === "paused") {
        return "working";
    }
    return "planning";
}

export function runStage(
    run: Pick<RunInfo, "status" | "land" | "dag" | "pausedBy" | "pausedUntil">,
    asking = false
): RunStageView {
    const key = stageKey(run);
    const status = run.status ?? "";
    const dagStatus = run.dag?.status ?? "";
    const finalState = run.dag?.final?.state ?? "";
    const outcome = finalState === "passed" || finalState === "unverified" || finalState === "failed" ? finalState : "";
    const past = (k: RunStageKey) => key !== "cancelled" && ORDER.indexOf(key) > ORDER.indexOf(k);
    // a paused run's agents are suspended, so a question one left is held for the resume, not waiting on the person
    const paused = status === "paused" && key !== "cancelled";
    const needsYou =
        key !== "cancelled" &&
        !paused &&
        (asking ||
            status === "awaiting-review" ||
            status === "blocked" ||
            dagStatus === "blocked" ||
            dagStatus === "awaiting-review" ||
            (key === "land-held" && run.land?.dismissed !== true));
    const complete = key === "landed" || key === "complete";
    const tone: StageTone =
        key === "cancelled" || paused
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
    return {
        key,
        label: paused ? pausedLabel(run.pausedBy, run.pausedUntil) : stageLabel(key, run.land?.state),
        tone,
        needsYou,
        outcome,
        complete,
        paused,
        tail,
    };
}

// a land in line or being resolved stays the landing stage (run office reads the key union), with its own words
function stageLabel(key: RunStageKey, landState: string | undefined): string {
    if (key === "landing") {
        return landState === "queued"
            ? "Landing · in line"
            : landState === "resolving"
              ? "Landing · resolving conflicts"
              : LABEL.landing;
    }
    return LABEL[key];
}
