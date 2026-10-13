// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The order the Agent surface's agent keys (j/k, the arrows) and Ctrl+Tab step through: the project tree's, agents and
// terminals together, read from the same atoms AgentTree renders it from, so it holds while the sidebar is hidden
// (fullscreen) too.

import { globalStore } from "@/app/store/jotaiStore";
import { reconcileGrid } from "./agentgrid";
import type { AgentsViewModel } from "./agents";
import { projectTree, treeNavIds } from "./agentsidebarmodel";
import { buildAgentTree } from "./agenttreemodel";
import { agentGridAtom, eligibleIds } from "./gridstore";
import { rosterSeededAtom } from "./liveagents";
import { collapsedProjectsAtom } from "./projectfoldstore";
import { projectsAtom } from "./projectsstore";
import { treeFoldsAtom } from "./runlineagestore";

export function activeNavOrder(model: AgentsViewModel): string[] {
    const agents = globalStore.get(model.agentsAtom);
    const terminals = globalStore.get(model.terminalsAtom);
    const focusId = globalStore.get(model.focusIdAtom);
    const tree = buildAgentTree(
        agents,
        globalStore.get(model.orderAtom),
        globalStore.get(model.lineageAtom),
        globalStore.get(treeFoldsAtom),
        focusId
    );
    const roster = [...agents, ...terminals];
    const cells = reconcileGrid(globalStore.get(agentGridAtom), {
        focusId,
        eligible: eligibleIds(roster),
        seeded: globalStore.get(rosterSeededAtom),
    }).ids;
    const roots = new Map<string, string>();
    for (const [name, project] of Object.entries(globalStore.get(projectsAtom))) {
        if (project?.path) {
            roots.set(name, project.path);
        }
    }
    return treeNavIds(
        projectTree({
            tree,
            terminals,
            cells,
            roster,
            filter: globalStore.get(model.projectFilterAtom),
            collapsed: globalStore.get(collapsedProjectsAtom),
            roots,
        })
    );
}
