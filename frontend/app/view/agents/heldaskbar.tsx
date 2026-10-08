// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import type { AgentsViewModel } from "./agents";
import type { AgentVM } from "./agentsviewmodel";
import { AskRow } from "./channelsprimitives";

// A held command's card (`wsh memgate`'s Low RAM) above the agent's terminal. The terminal shows only the shell
// command waiting, so without this the card could be answered only from the Cockpit or Jarvis.
export function HeldAskBar({ model, agent }: { model: AgentsViewModel; agent: AgentVM }) {
    if (agent.state !== "asking" || !agent.ask?.hold) {
        return null;
    }
    return (
        <div data-held-ask={agent.id} className="mx-1 mb-2 shrink-0">
            <AskRow model={model} agent={agent} />
        </div>
    );
}
