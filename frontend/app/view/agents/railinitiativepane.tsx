// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The Agent panel's Initiative tab: the agent's linked initiative, its plan to review and its chunks
// (docs/superpowers/specs/2026-11-20-agent-rail-brainstorm-initiative-tabs-design.md). A stub for now: the rail's strip
// and body already reach it, and its body is the initiative-pane task's.

import type { AgentsViewModel } from "./agents";
import type { AgentVM } from "./agentsviewmodel";

export function RailInitiativePane({ agent }: { model: AgentsViewModel; agent: AgentVM }) {
    return <div data-rail-initiative={agent.id} className="flex min-h-0 flex-1 flex-col" />;
}
