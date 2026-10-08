// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// A claude agent redraws its spinner every second while it works, so a working agent with a silent terminal is hung,
// not busy. Derived here, never published: hook state stays the one source of an agent's state.

import type { AgentVM } from "./agentsviewmodel";

export const HUNG_AFTER_MS = 3 * 60_000;

// only runtimes whose working output was measured. pi does not qualify: it renders nothing between a
// tool returning and the model replying, and a minimal turn measured 142.8s of silence against the
// ~150s this really fires at. why, and what covering pi would take:
// docs/superpowers/specs/2026-09-17-backlog-cleanup-design.md (chunk 2, F25).
const PTY_HEARTBEAT_AGENTS = new Set(["claude"]);

/** Pure: how long a working agent's terminal has been silent once that silence means hung, else null. */
export function hungSilenceMs(
    agent: Pick<AgentVM, "agent" | "state">,
    lastOutputTs: number | undefined,
    now: number
): number | null {
    if (agent.state !== "working" || !PTY_HEARTBEAT_AGENTS.has(agent.agent ?? "") || !lastOutputTs) {
        return null;
    }
    const silent = now - lastOutputTs;
    return silent >= HUNG_AFTER_MS ? silent : null;
}
