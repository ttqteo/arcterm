// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Starting a run from the New launcher: the channel, the route and the run, in that order. Moved out of the old New
// run window's start handler so the dialog stays thin; what a launch dispatches is unchanged.

import { globalStore } from "@/app/store/jotaiStore";
import { launchGoal, launchOptsFromConfig, type ChannelTarget, type RunConfig } from "@/app/view/jarvis/newrun";
import { createChannel } from "./channelsstore";
import { noteRecentProject } from "./projectsstore";
import { createRun, resolveChannelLaunchRoute, resolvedProfileAtom } from "./runactions";
import { endRunConfigDraft } from "./runconfigstore";

export interface LauncherRunInput {
    target: ChannelTarget;
    projectName: string;
    config: RunConfig;
    goal: string;
    // a lead route picked by hand in the Models row; null lets the project's own resolve
    pickedRoute: RoutePin | null;
}

export async function startLauncherRun(input: LauncherRunInput): Promise<{ channelId: string; run: Run }> {
    // a channel minted here and then orphaned by a failed launch is the project's channel either way, so there is
    // nothing to roll back: the next run finds it
    const channelId =
        input.target.kind === "existing" ? input.target.oid : await createChannel(input.target.name, input.target.path);
    // resolving also checks that the project's route is available right now
    const route = input.pickedRoute ?? (await resolveChannelLaunchRoute(channelId));
    const run = await createRun(
        channelId,
        launchGoal(input.config, input.goal),
        route,
        launchOptsFromConfig(input.config)
    );
    noteRecentProject(input.projectName);
    // the launch consumed this draft, so the next one starts from the project's saved defaults
    endRunConfigDraft(globalStore.get(resolvedProfileAtom)[channelId]);
    return { channelId, run };
}
