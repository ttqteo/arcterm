// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// When the cockpit offers to close an agent: its sidebar row's ✓ Close chip and its header's ✓ Close · N tok button
// both read doneSuggestion, so they show and hide together (docs/superpowers/specs/2026-10-08-done-close-suggestion-design.md).

import type { AgentVM } from "./agentsviewmodel";
import { runAgentsOf, runFinished, type Lineage, type RunInfo } from "./runlineage";

export const DONE_TITLE = "Committed in its last turn: close this agent";
export const ORIGIN_DONE_TITLE = "A run it started landed: close this agent and the run's sessions";
export const LANDED_TITLE = "The run landed: close its sessions";

/** Pure: a run offers ✓ Close once it landed and still holds open sessions (its lead, workers, reviewers): the engine
 *  leaves them for you to read, and they hold RAM until closed. Drawn on the ✓ row Chat folds the run's card into, and
 *  on the run's tree row when no open session started it (originHoldsClose). */
export function landedCloseSuggestion(run: Pick<RunInfo, "land"> | null | undefined, openTabs: number): boolean {
    return run?.land?.state === "landed" && openTabs > 0;
}

/** Pure: whether a session that started a run with `wsh runs start` is open and awake in the roster: its row then
 *  carries the landed run's ✓ (doneSuggestion, startedRunTabIds), so the run's own row does not. */
export function originHoldsClose(
    run: Pick<RunInfo, "originId"> | null | undefined,
    agents: readonly Pick<AgentVM, "id" | "sleeping">[]
): boolean {
    const origin = run?.originId;
    return origin != null && agents.some((a) => a.id === origin && a.sleeping == null);
}

/** Pure: whether a run the agent started has landed: its work is in, so the agent offers ✓ Close as one whose last
 *  turn committed does. */
export function startedRunLanded(agentId: string, runs: Record<string, Pick<RunInfo, "originId" | "land">>): boolean {
    return Object.values(runs).some((r) => r.originId === agentId && r.land?.state === "landed");
}

/** Pure: the tabs the landed runs an agent started still hold (lead, workers, reviewers), which closing that agent
 *  offers to close with it. Never the agent itself. */
export function startedRunTabIds<T extends { id: string }>(lineage: Lineage, agents: T[], agentId: string): string[] {
    return Object.entries(lineage.runs)
        .filter(([, r]) => r.originId === agentId && r.land?.state === "landed")
        .flatMap(([runId]) => runAgentsOf(lineage, agents, runId).map((a) => a.id))
        .filter((id, i, all) => id !== agentId && all.indexOf(id) === i);
}

/** Pure: an agent looks finished when it is idle, its last turn ended on a git commit (or a run it started has landed,
 *  startedRunLanded), you have read that turn, it is
 *  not stopped on a part waiting for your reply, no run owns it (the engine closes a run's sessions itself), no run
 *  it started with `wsh runs start` is still going (a turn that commits a plan and hands it to the engine has not
 *  finished the work, the run nested under it is doing it), and none of its background tasks still runs: they are
 *  children of its process, so closing it would end a build it left running. It holds back too while a plan it queued
 *  (`wsh runs start --queue`) still waits, or is blocked, in wavesrv's queue: no run holds the Close back yet, and
 *  closing the session would leave nobody to tell when that run lands. `runs` is the lineage's, by lead run id;
 *  `backgroundRunning` is how many of its background tasks still run (runningBackgroundTasks); `queued` is the run
 *  queue's entries (runQueueAtom). */
export function doneSuggestion(
    agent: Pick<AgentVM, "id" | "state" | "committed" | "step" | "runId">,
    unreadCount: number,
    runs: Record<string, Pick<RunInfo, "originId" | "dag" | "status" | "land">>,
    backgroundRunning: number,
    queued: readonly Pick<RunQueueEntry, "data">[]
): boolean {
    return (
        agent.state === "idle" &&
        backgroundRunning === 0 &&
        (agent.committed === true || startedRunLanded(agent.id, runs)) &&
        unreadCount === 0 &&
        !agent.step &&
        agent.runId == null &&
        !Object.values(runs).some((r) => r.originId === agent.id && !runFinished(r)) &&
        !queued.some((e) => e.data.origintabid === agent.id)
    );
}
