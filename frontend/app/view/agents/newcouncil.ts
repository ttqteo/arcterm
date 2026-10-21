// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// New council from outside the Agent tree: the palette's New council… row and the `new-council` binding (so
// `wsh ui do new-council` too). The tree's own New council row knows its project and calls showCouncilSetup itself.

import { pushToast } from "@/app/cockpit/notificationstore";
import { globalStore } from "@/app/store/jotaiStore";
import { showCouncilSetup } from "./agentcenter";
import type { AgentsViewModel } from "./agents";
import { newCouncilRoot } from "./agentsidebarmodel";
import { projectsAtom } from "./projectsstore";

/** Opens the council Setup in the Agent surface for the project of the agent or terminal in focus, else the first
 *  registered project. With no project registered there is nowhere to start one, which a toast says. */
export function openNewCouncil(
    model: Pick<AgentsViewModel, "surfaceAtom" | "agentsAtom" | "terminalsAtom" | "focusIdAtom">
): void {
    const focusId = globalStore.get(model.focusIdAtom);
    const roster = [...globalStore.get(model.agentsAtom), ...globalStore.get(model.terminalsAtom)];
    const root = newCouncilRoot(
        roster.find((a) => a.id === focusId),
        globalStore.get(projectsAtom)
    );
    if (root === "") {
        pushToast({ title: "No project to start a council in", message: "Add a project first.", level: "warn" });
        return;
    }
    showCouncilSetup(root, undefined, model);
}
