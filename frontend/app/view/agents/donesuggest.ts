// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// When the cockpit offers to close an agent: its sidebar row's ✓ Close chip and its header's Done — Close button
// both read doneSuggestion, so they show and hide together (docs/superpowers/specs/2026-10-08-done-close-suggestion-design.md).

import type { AgentVM } from "./agentsviewmodel";

export const DONE_TITLE = "Committed in its last turn: close this agent";

/** Pure: an agent looks finished when it is idle, its last turn ended on a git commit, you have read that turn, it is
 *  not stopped on a part waiting for your reply, and no run owns it (the engine closes a run's sessions itself). */
export function doneSuggestion(
    agent: Pick<AgentVM, "state" | "committed" | "step" | "runId">,
    unreadCount: number
): boolean {
    return (
        agent.state === "idle" && agent.committed === true && unreadCount === 0 && !agent.step && agent.runId == null
    );
}
