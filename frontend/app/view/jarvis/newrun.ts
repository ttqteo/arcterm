// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The pure half of starting a run from the New run window. A project is the only thing the user names: the
// channel a run needs is storage (CreateRunCommand requires a channelid, and copies the worker cwd and the
// resolved profile off it), so it is resolved by path or minted on the spot rather than created by hand.
// That is why this is a decision and not a create call — a create call cannot be unit-tested, and getting
// "does this project already have a channel" wrong is how you end up with the duplicates we are removing.

import { fuzzyScore } from "@/app/cockpit/palette-match";
import { resolveTargetChannel } from "@/app/view/agents/channelderive";
import type { RunShape, StartFrom } from "@/app/view/agents/runconfig";

export type ChannelTarget = { kind: "existing"; oid: string } | { kind: "create"; name: string; path: string };

// Null means the channel list has not arrived. That is not the same as "this project has no channel", and
// the difference is load-bearing: minting one on an unread list creates a duplicate of a channel we simply
// could not see yet, which is the exact state this modal exists to stop producing.
export function resolveChannelTarget(
    channels: Channel[] | null,
    projectName: string,
    projectPath: string
): ChannelTarget | null {
    if (channels == null) {
        return null;
    }
    const existing = resolveTargetChannel(channels, projectPath);
    if (existing != null) {
        return { kind: "existing", oid: existing.oid };
    }
    // named after the project, because the project is the only name for it a user will ever see
    return { kind: "create", name: projectName, path: projectPath };
}

// Where a Radar "Start investigation" draft lands on the Brief. Its project may have no channel yet (channels
// are minted on demand since one-per-project), and a find-only landing silently dropped those drafts.
// "wait": the channel list has not arrived, and the landing is one-shot, so it must not spend its attempt.
export function radarDraftLanding(
    channels: Channel[] | null,
    draft: { projectName?: string; projectPath?: string }
): ChannelTarget | "wait" | "none" {
    if (!draft.projectName || !draft.projectPath) {
        return "none";
    }
    return resolveChannelTarget(channels, draft.projectName, draft.projectPath) ?? "wait";
}

export interface RunConfig {
    shape: RunShape;
    parallelism: number;
    workerRoute: RoutePin | null;
    start: StartFrom;
    planPath: string;
    reviewerPicks: boolean;
    reviewerRoute: RoutePin | null;
    // a canvas's board, from Build this…; absolute, since a run's worktree has no copy of the design folder
    prototype?: string;
}

export interface LaunchOpts {
    mode: string;
    parallelism?: number;
    workerRoute?: RoutePin;
    planPath?: string;
    reviewerPicks?: boolean;
    reviewerRoute?: RoutePin;
    prototype?: string;
}

// What the launcher's controls mean as CreateRun's arguments. The mode cannot simply be omitted: the server
// reads an unset mode as `quick` (resolveRunPlan). Every orchestrator run is an engine run, so the machine
// is the server's to set. reviewerPicks goes out even when false: the server reads an unset one as the
// profile's, and the launcher has already shown the user the profile's answer and let them change it.
export function launchOptsFromConfig(config: RunConfig): LaunchOpts {
    const { shape, parallelism, workerRoute, start, planPath, reviewerPicks, reviewerRoute, prototype } = config;
    if (shape !== "orchestrator") {
        return { mode: shape };
    }
    return {
        mode: shape,
        parallelism,
        ...(workerRoute != null ? { workerRoute } : {}),
        ...(start === "plan" ? { planPath: planPath.trim() } : {}),
        reviewerPicks,
        ...(reviewerRoute != null ? { reviewerRoute } : {}),
        ...(prototype ? { prototype } : {}),
    };
}

// The goal a launch sends. A plan start sends none: the server names the run by its plan, and a goal typed
// before switching to the plan is hidden, so it must not name a run the user can no longer see it on.
export function launchGoal(config: Pick<RunConfig, "shape" | "start">, goal: string): string {
    return config.shape === "orchestrator" && config.start === "plan" ? "" : goal.trim();
}

// Which project + Run opens on. The modal is rebuilt on every open (NewRunControl unmounts it on close),
// so the remembered name is checked against the registry as it stands now: a project unregistered since
// must not preselect a row that is no longer there. One project is not a choice, so it preselects either
// way — which is also the answer before anything has been remembered.
export function initialPick(names: string[], remembered: string | null): string | null {
    if (remembered != null && names.includes(remembered)) {
        return remembered;
    }
    return names.length === 1 ? names[0] : null;
}

export type NewRunPrefill = { projectName: string; goal: string; shape: RunShape; prototype?: string };

// What the window opens on when something filled it (a canvas's Build this…, the palette's Quick and Orchestrate):
// a goal start in the prefill's shape, except that a prototype only rides an orchestrator run, so one that
// came with a prototype is corrected to orchestrator. The project is picked only if it is registered, as
// initialPick does.
export function prefillToLaunch(
    prefill: NewRunPrefill,
    projectNames: string[]
): { picked: string | null; shape: RunShape; start: "goal"; goal: string; prototype: string } {
    const { projectName, goal } = prefill;
    const prototype = prefill.prototype ?? "";
    return {
        picked: projectName !== "" && projectNames.includes(projectName) ? projectName : null,
        shape: prototype !== "" ? "orchestrator" : prefill.shape,
        start: "goal",
        goal,
        prototype,
    };
}

// Which projects a typed query leaves, best first. Reuses the palette's scorer so one query language
// covers both places a project is picked by name. An empty query is not a filter: the registry's own
// order stands rather than being re-sorted into a ranking the user never asked for.
export function rankProjects(names: string[], query: string): string[] {
    const q = query.trim();
    if (q === "") {
        return names;
    }
    return names
        .map((name, index) => ({ name, index, score: fuzzyScore(q, name) }))
        .filter((row): row is { name: string; index: number; score: number } => row.score != null)
        .sort((a, b) => b.score - a.score || a.index - b.index)
        .map((row) => row.name);
}
