// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The session sheet's live-reconfiguration logic, as data. Three rules shape everything here, and all
// three are consequences of the same fact — a running plan has already committed to its shape:
//
//   * only an engine orchestrator has a scheduler to reconfigure, and only while it is still live;
//   * the effective settings live on the TaskGroup once a DAG exists, because that is what the scheduler
//     reads, and on the Run before that, because that is what DagSubmit will read;
//   * the plan gate is editable only while nothing has crossed it.
//
// A missing run renders as unavailable rather than as stale controls over a run that no longer exists.

import { MAX_PARALLELISM } from "../agents/runconfig";

export type SheetFace = { kind: "missing" } | { kind: "readonly"; reason: string } | { kind: "editable" };

export type RunSettingsDraft = {
    parallelism: number;
    workerRoute: RoutePin | null;
    // never true beside a worker route: the server refuses the pair
    reviewerPicks: boolean;
    reviewerRoute: RoutePin | null;
};

export type RunSettingsPanelState =
    | { kind: "missing" }
    | { kind: "loading" }
    | { kind: "unavailable"; reason: "missing" | "error" }
    | { kind: "readonly"; reason: string }
    | { kind: "editable" };

// How far the sheet has got with the TaskGroup a run links. "missing" is a loaded read that found nothing
// (the group was deleted); "error" is a read that failed. Neither may fall back to the run's launch
// snapshot — the engine owns these settings once a plan exists, and the snapshot is not what it is running.
export type LinkedGroupRead = "loading" | "ready" | "missing" | "error";

// What the sheet may render, given how far the linked group has got. A run that links a DAG has mutable
// settings, but never from the launch snapshot: until the group arrives the sheet cannot know what the
// scheduler is actually running at, and a save sent from the snapshot would overwrite it. A failed or
// vanished group states that plainly instead of reading as loading forever.
export function runSettingsPanelState(
    run: Run | null | undefined,
    group: TaskGroup | null,
    groupRead: LinkedGroupRead
): RunSettingsPanelState {
    if (run == null) {
        return { kind: "missing" };
    }
    if ((run.dagoref ?? "") !== "") {
        if (groupRead === "loading") {
            return { kind: "loading" };
        }
        if (groupRead === "error") {
            return { kind: "unavailable", reason: "error" };
        }
        if (groupRead === "missing" || group == null) {
            return { kind: "unavailable", reason: "missing" };
        }
    }
    return sheetFace(run);
}

// The machine a run's lead drives. An empty orchestration predates the control slice 5c deleted, where the
// runtime decided and only pi led an engine run; pkg/jarvis.IsEngineRun applies this same rule server-side.
// Both the sheet's receipt and its face read it here, because a receipt saying engine over a face saying
// adaptive is the run contradicting itself on one screen.
export function runMachine(run: Run): string {
    return run.orchestration || (run.runtime === "pi" ? "engine" : "adaptive");
}

export function sheetFace(run: Run | null | undefined): SheetFace {
    if (run == null) {
        return { kind: "missing" };
    }
    if (run.status === "done" || run.status === "cancelled") {
        return { kind: "readonly", reason: `this run is ${run.status}` };
    }
    if (run.mode !== "orchestrator") {
        return { kind: "readonly", reason: `a ${run.mode} run has no scheduler to reconfigure` };
    }
    if (runMachine(run) !== "engine") {
        return { kind: "readonly", reason: "an adaptive lead runs its own subagents" };
    }
    return { kind: "editable" };
}

// The sheet's starting values. After submission the group wins: reading the run there would print the
// launch snapshot beside a scheduler honouring something else.
export function runSettingsDraft(run: Run | null, group: TaskGroup | null): RunSettingsDraft {
    const from = group ?? run;
    return {
        parallelism: (group != null ? group.parallelism : run?.parallelism) ?? 0,
        workerRoute: from?.workerroute ?? null,
        reviewerPicks: from?.reviewerpicks ?? false,
        reviewerRoute: from?.reviewerroute ?? null,
    };
}

export function draftIsDirty(a: RunSettingsDraft, b: RunSettingsDraft): boolean {
    return (
        a.parallelism !== b.parallelism ||
        !sameRoute(a.workerRoute, b.workerRoute) ||
        a.reviewerPicks !== b.reviewerPicks ||
        !sameRoute(a.reviewerRoute, b.reviewerRoute)
    );
}

// The workers picker's three answers: Same as lead (null), a route, or Reviewer picks. Choosing one clears
// the other half of the pair, which the server would refuse together.
export function withWorkers(draft: RunSettingsDraft, choice: RoutePin | null | "picks"): RunSettingsDraft {
    if (choice === "picks") {
        return { ...draft, workerRoute: null, reviewerPicks: true };
    }
    return { ...draft, workerRoute: choice, reviewerPicks: false };
}

// What the sheet re-seeds its draft on: every effective mutable input, from whichever object currently owns
// it (the group after submission, the run before). A key rather than the objects themselves, so a live
// status tick — which changes the object but none of these fields — never wipes what the user has typed.
export function draftSeedKey(run: Run, group: TaskGroup | null): string {
    const draft = runSettingsDraft(run, group);
    const route = draft.workerRoute;
    const reviewer = draft.reviewerRoute;
    return [
        draft.parallelism,
        route?.runtime ?? "",
        route?.model ?? "",
        draft.reviewerPicks,
        reviewer?.runtime ?? "",
        reviewer?.model ?? "",
    ].join("|");
}

function sameRoute(a: RoutePin | null, b: RoutePin | null): boolean {
    if (a == null || b == null) {
        return a == null && b == null;
    }
    return a.runtime === b.runtime && (a.model ?? "") === (b.model ?? "");
}

// A submitted plan already holds a concrete width, so the sheet never offers "let the lead choose".
export function parallelismInvalid(n: number): boolean {
    return !Number.isInteger(n) || n < 1 || n > MAX_PARALLELISM;
}

export function settingsPayload(channelId: string, runId: string, draft: RunSettingsDraft): CommandSetRunSettingsData {
    const payload: CommandSetRunSettingsData = {
        channelid: channelId,
        runid: runId,
        parallelism: draft.parallelism,
        reviewerpicks: draft.reviewerPicks,
    };
    if (draft.workerRoute != null) {
        payload.workerroute = draft.workerRoute;
    }
    if (draft.reviewerRoute != null) {
        payload.reviewerroute = draft.reviewerRoute;
    }
    return payload;
}

// SetRunSettings applies every field it is sent, so a control that changes one dial sends the rest as they
// stand: from the group once a dag exists, else from the run.
export function settingsChangePayload(
    channelId: string,
    runId: string,
    run: Run | null,
    group: TaskGroup | null,
    change: Partial<RunSettingsDraft>
): CommandSetRunSettingsData {
    return settingsPayload(channelId, runId, { ...runSettingsDraft(run, group), ...change });
}

export function routeLabel(route: RoutePin | null | undefined): string {
    if (route == null || (route.runtime ?? "") === "") {
        return "inherit the lead";
    }
    return [route.runtime, route.model || "default"].join(" · ");
}

export function workersLabel(draft: RunSettingsDraft): string {
    return draft.reviewerPicks ? "reviewer picks" : routeLabel(draft.workerRoute);
}
