// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Starting a run from the New launcher: the channel, the route and the run, in that order. Moved out of the old New
// run window's start handler so the dialog stays thin; what a launch dispatches is unchanged.

import { globalStore } from "@/app/store/jotaiStore";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import {
    launchGoal,
    launchOptsFromConfig,
    type ChannelTarget,
    type RunConfig,
    type RunHandback,
} from "@/app/view/jarvis/newrun";
import { createChannel } from "./channelsstore";
import { noteRecentProject } from "./projectsstore";
import {
    buildCreateRunData,
    createRun,
    resolveChannelLaunchRoute,
    resolvedProfileAtom,
    type CreateRunOpts,
} from "./runactions";
import { endRunConfigDraft } from "./runconfigstore";

export interface LauncherRunInput {
    target: ChannelTarget;
    projectName: string;
    config: RunConfig;
    goal: string;
    // a lead route picked by hand in the Models row; null lets the project's own resolve
    pickedRoute: RoutePin | null;
    // the spec the goal builds (absolute); the run keeps it
    specPath?: string;
}

// The steps a start and a queued start share: the project's channel, the route the run leads on, and what the run is
// made of. Whichever goes on to create the run or to queue it sends the same data, so they cannot drift.
async function prepareLauncherRun(
    input: LauncherRunInput
): Promise<{ channelId: string; route: RoutePin; goal: string; opts: CreateRunOpts }> {
    // a channel minted here and then orphaned by a failed launch is the project's channel either way, so there is
    // nothing to roll back: the next run finds it
    const channelId =
        input.target.kind === "existing" ? input.target.oid : await createChannel(input.target.name, input.target.path);
    // resolving also checks that the project's route is available right now
    const route = input.pickedRoute ?? (await resolveChannelLaunchRoute(channelId));
    return {
        channelId,
        route,
        goal: launchGoal(input.config, input.goal),
        opts: { ...launchOptsFromConfig(input.config), ...(input.specPath ? { specPath: input.specPath } : {}) },
    };
}

// the launch consumed this draft, so the next one starts from the project's saved defaults
function settleLauncherRun(input: LauncherRunInput, channelId: string): void {
    noteRecentProject(input.projectName);
    endRunConfigDraft(globalStore.get(resolvedProfileAtom)[channelId]);
}

export async function startLauncherRun(input: LauncherRunInput): Promise<{ channelId: string; run: Run }> {
    const { channelId, route, goal, opts } = await prepareLauncherRun(input);
    const run = await createRun(channelId, goal, route, opts);
    settleLauncherRun(input, channelId);
    return { channelId, run };
}

/** What RunQueueAddCommand is sent. The wire holds one run to wait for today (`after` is a string), so a list sends its
 *  first id; the queue's After becomes a list in a later task, and this is the one place that then sends the whole list.
 *  An empty list sends none. */
export function queueAddPayload(
    data: CommandCreateRunData,
    after: string[],
    brainstorm: RunQueueBrainstorm | undefined
): CommandRunQueueAddData {
    return {
        data,
        ...(after.length > 0 ? { after: after[0] } : {}),
        ...(brainstorm != null ? { brainstorm } : {}),
    };
}

/** Queues the start instead of making the run: the same data a start would send, held by the queue until the run's turn
 *  comes (the cap has room and every run in `after` has landed). `brainstorm` is the brainstorm waiting for the run, so
 *  wavesrv can tell it the run's id once the entry starts. Resolves to the entry. */
export async function queueLauncherRun(
    input: LauncherRunInput & { after: string[]; brainstorm?: RunQueueBrainstorm }
): Promise<{ channelId: string; entry: RunQueueEntry }> {
    const { channelId, route, goal, opts } = await prepareLauncherRun(input);
    const entry = await RpcApi.RunQueueAddCommand(
        TabRpcClient,
        queueAddPayload(buildCreateRunData(channelId, goal, route, opts), input.after, input.brainstorm)
    );
    settleLauncherRun(input, channelId);
    return { channelId, entry };
}

/** Tells the caller that filled the dialog (a brainstorm's Approve, through the prefill's handback) how its run's start
 *  went: handed off, started with the run's id, queued with its entry's id, or stopped. A throwing handback is logged and
 *  goes no further: the start goes on either way. */
export function handBack(
    handback: RunHandback | null | undefined,
    event:
        | { kind: "handedOff" }
        | { kind: "started"; runId: string }
        | { kind: "queued"; entryId: string }
        | { kind: "stopped" }
): void {
    if (handback == null) {
        return;
    }
    try {
        if (event.kind === "started") {
            handback.started(event.runId);
        } else if (event.kind === "queued") {
            handback.queued?.(event.entryId);
        } else {
            handback[event.kind]?.();
        }
    } catch (e) {
        console.warn("the caller that filled the launcher failed to take its run's start", event, e);
    }
}
