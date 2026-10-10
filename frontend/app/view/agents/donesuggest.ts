// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// When the cockpit offers to close an agent: its sidebar row's ✓ Close chip and its header's ✓ Close · N tok button
// both read doneSuggestion, so they show and hide together (docs/superpowers/specs/2026-10-08-done-close-suggestion-design.md).

import type { AgentVM } from "./agentsviewmodel";
import { runFinished, type RunInfo } from "./runlineage";

export const DONE_TITLE = "Committed in its last turn: close this agent";

/** Pure: an agent looks finished when it is idle, its last turn ended on a git commit, you have read that turn, it is
 *  not stopped on a part waiting for your reply, no run owns it (the engine closes a run's sessions itself), and no run
 *  it started with `wsh runs start` is still going: a turn that commits a plan and hands it to the engine has not
 *  finished the work, the run nested under it is doing it. `runs` is the lineage's, by lead run id. */
export function doneSuggestion(
    agent: Pick<AgentVM, "id" | "state" | "committed" | "step" | "runId">,
    unreadCount: number,
    runs: Record<string, Pick<RunInfo, "originId" | "dag" | "status" | "land">>
): boolean {
    return (
        agent.state === "idle" &&
        agent.committed === true &&
        unreadCount === 0 &&
        !agent.step &&
        agent.runId == null &&
        !Object.values(runs).some((r) => r.originId === agent.id && !runFinished(r))
    );
}
