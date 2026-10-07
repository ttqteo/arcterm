// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Where the Agent surface's "Show the project" button goes. Pure.

import { projectOf, type AgentVM } from "./agentsviewmodel";

// The project's first agent, else its first terminal. A project can have terminals and no agent, and the button must
// not be dead for it.
export function projectFocusTarget(agents: AgentVM[], terminals: AgentVM[], project: string): AgentVM | undefined {
    return agents.find((a) => projectOf(a) === project) ?? terminals.find((t) => projectOf(t) === project);
}
