// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The order the Agent surface's agent keys (j/k, the arrows) and Ctrl+Tab step through: the project tree's, agents and
// terminals together, read from the same atoms AgentTree renders it from, so it holds while the sidebar is hidden
// (fullscreen) too.

import { globalStore } from "@/app/store/jotaiStore";
import type { AgentsViewModel } from "./agents";
import { projectTree, treeNavIds } from "./agentsidebarmodel";
import { buildAgentTree } from "./agenttreemodel";
import { waitMap } from "./agentwaits";
import { collapsedProjectsAtom } from "./projectfoldstore";
import { projectsAtom } from "./projectsstore";
import { treeFoldsAtom } from "./runlineagestore";
import { treeServiceInput } from "./servicesmodel";
import { servicesAtom } from "./servicesstore";
import { backgroundTasksByIdAtom } from "./subagentsstore";

export function activeNavOrder(model: AgentsViewModel): string[] {
    const agents = globalStore.get(model.agentsAtom);
    const terminals = globalStore.get(model.terminalsAtom);
    const focusId = globalStore.get(model.focusIdAtom);
    const tree = buildAgentTree(
        agents,
        globalStore.get(model.orderAtom),
        globalStore.get(model.lineageAtom),
        globalStore.get(treeFoldsAtom),
        focusId,
        waitMap(agents, globalStore.get(backgroundTasksByIdAtom))
    );
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
            filter: globalStore.get(model.projectFilterAtom),
            collapsed: globalStore.get(collapsedProjectsAtom),
            roots,
            ...treeServiceInput(globalStore.get(servicesAtom) ?? [], focusId),
        })
    );
}
