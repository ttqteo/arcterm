// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// What an agent whose turn ended shows while background work it started still runs: a command at work reads as
// working, one that only watches (a Monitor, a loop that sleeps between checks) as waiting, and a dev server it left
// listening as nothing, since the agent is done and the server just runs (a green server glyph, statusdot.tsx
// ServerMark, says it is still up). Only what is drawn changes: agent.state stays
// the turn's state, which unread, Close and sleep read.

import type { AgentState } from "./agentsviewmodel";
import { matchLauncherTask } from "./devserversmodel";
import { runningBackgroundTasks, type BackgroundTask } from "./transcriptprojection";

export type ShownState = AgentState | "waiting";

// a shell loop that sleeps between checks: `while …; do …; sleep 20; done`, `until [ -f x ]; do sleep 5; done`
const WAIT_LOOP = /\b(?:while|until)\b[\s\S]*\bsleep\b/;
// waiting for another agent to stop working
const AGENT_WAIT = /\bwsh\s+agents\s+wait\b/;

/** Pure: the task only watches: a Monitor, a loop that sleeps between checks, or a `wsh agents wait`. */
export function onlyWatches(task: BackgroundTask): boolean {
    const command = task.command ?? "";
    return task.monitor === true || WAIT_LOOP.test(command) || AGENT_WAIT.test(command);
}

/** Pure: the servers in `servers` (the Servers poll's listening processes) one of the agent's running background
 *  tasks launched: the dev servers it left listening. */
export function launchedServers<S extends { launchercmdline?: string }>(
    tasks: BackgroundTask[] | undefined,
    servers: S[] | null
): S[] {
    const running = runningBackgroundTasks(tasks);
    return running.length === 0
        ? []
        : (servers ?? []).filter((s) => matchLauncherTask(s.launchercmdline, running) != null);
}

/** Pure: "working" when a running background task is at work, "waiting" when every one only watches, null when none
 *  runs or each is a server one of `servers` (the Servers poll's listening processes) was launched by. */
export function backgroundActivity(
    tasks: BackgroundTask[] | undefined,
    servers: { launchercmdline?: string }[] | null
): "working" | "waiting" | null {
    const running = runningBackgroundTasks(tasks).filter(
        (t) => !(servers ?? []).some((s) => matchLauncherTask(s.launchercmdline, [t]) != null)
    );
    if (running.length === 0) {
        return null;
    }
    return running.every(onlyWatches) ? "waiting" : "working";
}

/** Pure: the state to draw: an idle agent takes its background activity, a working or asking one keeps its own. */
export function shownState(state: AgentState, activity: "working" | "waiting" | null): ShownState {
    return state === "idle" && activity != null ? activity : state;
}
