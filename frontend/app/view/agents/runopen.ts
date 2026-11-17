// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Opening a run from an agent (a brainstorm's tree line, its pane's Open run, Chat's run card): the run shows in the
// Agent tree first, under its lead's row with its lanes unfolded, the lead selected, rather than sending the person to
// Jarvis. A run with no tab in the tree (its lead closed, every task queued or done) opens in Jarvis as before.

import { globalStore } from "@/app/store/jotaiStore";
import { openTarget } from "@/app/view/jarvis/openref";
import type { AgentsViewModel } from "./agents";
import { runTreeAgent } from "./runlineage";
import { openRunFold } from "./runlineagestore";

export async function openRunFromAgent(model: AgentsViewModel, runId: string): Promise<void> {
    const agent = runTreeAgent(globalStore.get(model.lineageAtom), globalStore.get(model.agentsAtom), runId);
    if (agent == null) {
        await openTarget(model, { kind: "run", runId });
        return;
    }
    openRunFold(runId);
    await openTarget(model, { kind: "agent", tabId: agent.id });
}
