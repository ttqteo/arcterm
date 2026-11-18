// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { launchAgent } from "@/app/cockpit/cockpit-actions";
import { globalStore } from "@/app/store/jotaiStore";
import { showTerminal } from "./agentcenter";
import type { AgentsViewModel } from "./agents";
import { HOME_NAME, HOME_PICK } from "./launcher";
import { moveToDock } from "./railstore";
import { toolContext } from "./toolsstore";

// The cockpit's model, bound by the shell (cockpit-root.tsx) as path links bind theirs: a code block sits deep in a
// transcript's markdown, out of reach of the props that carry it.
let boundModel: AgentsViewModel | null = null;

export function setCodeRunModel(model: AgentsViewModel | null): void {
    boundModel = model;
}

// A code block's Run: a new plain terminal that types the command at its first prompt (launch.ts), in the folder the
// agent whose Chat shows the block works in (its worktree, else its project's root, else home), stamped with its
// project. It docks in the panel under that agent, so the reply and the command's output show together; with no agent
// to dock under it takes the centre. False when the cockpit is not up.
export async function runInTerminal(command: string): Promise<boolean> {
    const model = boundModel;
    if (model == null) {
        return false;
    }
    const ctx = toolContext(model);
    const tabId = await launchAgent(model, {
        runtime: "terminal",
        startupCommand: command,
        task: "",
        projectPath: ctx.agentCwd || ctx.projectRoot || HOME_PICK,
        projectName: ctx.project || HOME_NAME,
        focus: false,
    });
    if (!moveToDock(model, tabId)) {
        globalStore.set(model.focusIdAtom, tabId);
        globalStore.set(model.surfaceAtom, "agent");
        showTerminal();
    }
    return true;
}
