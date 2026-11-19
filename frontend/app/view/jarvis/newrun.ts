// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The pure half of starting a run from the New dialog's run pick. A project is the only thing the user names: the
// channel a run needs is storage (CreateRunCommand requires a channelid, and copies the worker cwd and the
// resolved profile off it), so it is resolved by path or minted on the spot rather than created by hand.
// That is why this is a decision and not a create call — a create call cannot be unit-tested, and getting
// "does this project already have a channel" wrong is how you end up with the duplicates we are removing.

import { fuzzyScore } from "@/app/cockpit/palette-match";
import { resolveTargetChannel } from "@/app/view/agents/channelderive";
import { appendAttachments, type Attachment } from "@/app/view/agents/composerattachments";
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

export interface RunConfig {
    shape: RunShape;
    // null is auto: CreateRun leaves the width to the profile, then the lead
    parallelism: number | null;
    workerRoute: RoutePin | null;
    start: StartFrom;
    planPath: string;
    reviewerPicks: boolean;
    reviewerRoute: RoutePin | null;
    lightReviewerRoute: RoutePin | null;
    autonomous: boolean;
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
    lightReviewerRoute?: RoutePin;
    prototype?: string;
    autonomous?: boolean;
}

// What the launcher's controls mean as CreateRun's arguments. The mode cannot simply be omitted: the server
// reads an unset mode as `quick` (resolveRunPlan). Every orchestrator run is an engine run, so the machine
// is the server's to set. reviewerPicks goes out even when false: the server reads an unset one as the
// profile's, and the launcher has already shown the user the profile's answer and let them change it. autonomous
// goes out the same way, and never on quick, which the server refuses it on.
export function launchOptsFromConfig(config: RunConfig): LaunchOpts {
    const {
        shape,
        parallelism,
        workerRoute,
        start,
        planPath,
        reviewerPicks,
        reviewerRoute,
        lightReviewerRoute,
        prototype,
        autonomous,
    } = config;
    if (shape !== "orchestrator") {
        return { mode: shape };
    }
    return {
        mode: shape,
        ...(parallelism != null ? { parallelism } : {}),
        ...(workerRoute != null ? { workerRoute } : {}),
        ...(start === "plan" ? { planPath: planPath.trim() } : {}),
        reviewerPicks,
        ...(reviewerRoute != null ? { reviewerRoute } : {}),
        ...(lightReviewerRoute != null ? { lightReviewerRoute } : {}),
        ...(prototype ? { prototype } : {}),
        autonomous,
    };
}

// The goal a launch sends. A plan start sends none: the server names the run by its plan, and a goal typed
// before switching to the plan is hidden, so it must not name a run the user can no longer see it on. The
// goal's attachments hide with it, and otherwise reach the run as paths appended to the goal text.
export function launchGoal(
    config: Pick<RunConfig, "shape" | "start">,
    goal: string,
    attachments: Attachment[] = []
): string {
    return config.shape === "orchestrator" && config.start === "plan"
        ? ""
        : appendAttachments(goal.trim(), attachments);
}

// What filled the window hears of the run its launch starts, so it can follow it: handedOff when the dialog closes on
// its Start (CreateRun can take a minute to return), then started with the run's id, or stopped when the start fails or
// is cancelled before the run exists. A failed start's Try again hands it off again.
//
// `queued` is the other way a start can go: the person chose After or Queue in the When row, so the start is a queue
// entry (its id), and the run follows when its turn comes.
export type RunHandback = {
    handedOff?: () => void;
    started: (runId: string) => void;
    queued?: (entryId: string) => void;
    stopped?: () => void;
};

export type NewRunPrefill = {
    projectName: string;
    goal: string;
    shape: RunShape;
    prototype?: string;
    // the spec the goal builds (absolute), so the When row can compare its files with the live runs'
    specPath?: string;
    // a brainstorm waiting for the run: its tab and brainstorm.json, kept on the queue entry so wavesrv can tell it the
    // run's id when the entry starts
    brainstorm?: RunQueueBrainstorm;
    handback?: RunHandback;
    // the To review chunks this start works: the launcher keeps them for that open and sends them on both its start
    // paths (start now and queue), and a prefill-less open clears them
    chunks?: RunEffortRef[];
};

// What the window opens on when something filled it (a canvas's Build this…, the palette's Quick and Orchestrate):
// a goal start in the prefill's shape, except that a prototype only rides an orchestrator run, so one that
// came with a prototype is corrected to orchestrator. The project is picked only if it is registered: one
// unregistered since must not preselect a row that is no longer there.
export function prefillToLaunch(
    prefill: NewRunPrefill,
    projectNames: string[]
): {
    picked: string | null;
    shape: RunShape;
    start: "goal";
    goal: string;
    prototype: string;
    specPath?: string;
    brainstorm?: RunQueueBrainstorm;
} {
    const { projectName, goal } = prefill;
    const prototype = prefill.prototype ?? "";
    return {
        picked: projectName !== "" && projectNames.includes(projectName) ? projectName : null,
        shape: prototype !== "" ? "orchestrator" : prefill.shape,
        start: "goal",
        goal,
        prototype,
        specPath: prefill.specPath,
        brainstorm: prefill.brainstorm,
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
