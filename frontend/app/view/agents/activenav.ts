// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The order the Agent surface's agent keys (j/k, the arrows) and Ctrl+Tab step through: the Active section's, read
// from the same atoms AgentTree renders it from, so it holds while the sidebar is hidden (fullscreen) too.

import { globalStore } from "@/app/store/jotaiStore";
import { reconcileGrid } from "./agentgrid";
import type { AgentsViewModel } from "./agents";
import { activeAgentIds, activeView, splitActive } from "./agentsidebarmodel";
import { buildAgentTree } from "./agenttreemodel";
import { agentGridAtom, eligibleIds } from "./gridstore";
import { rosterSeededAtom } from "./liveagents";
import { collapsedProjectsAtom } from "./projectfoldstore";
import { treeFoldsAtom } from "./runlineagestore";

export function activeNavOrder(model: AgentsViewModel): string[] {
    const agents = globalStore.get(model.agentsAtom);
    const focusId = globalStore.get(model.focusIdAtom);
    const tree = buildAgentTree(
        agents,
        globalStore.get(model.orderAtom),
        globalStore.get(model.lineageAtom),
        globalStore.get(treeFoldsAtom),
        focusId
    );
    const cells = reconcileGrid(globalStore.get(agentGridAtom), {
        focusId,
        eligible: eligibleIds(agents),
        seeded: globalStore.get(rosterSeededAtom),
    }).ids;
    const { split, rows } = splitActive(tree, cells, agents);
    const active = activeView(
        rows,
        globalStore.get(model.projectFilterAtom),
        new Set(globalStore.get(collapsedProjectsAtom))
    );
    return activeAgentIds(split, active.rows);
}
