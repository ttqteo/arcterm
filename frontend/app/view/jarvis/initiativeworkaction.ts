// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Work on an initiative: go to the agent already open on it, else start one in the initiative's project with
// the "where are we" prompt, named after the initiative and linked to it. The Brief row, its `w` key and the
// palette's ctrl+enter all run this, so they cannot disagree about which of the two happens.

import { launchAgent } from "@/app/cockpit/cockpit-actions";
import { pushToast } from "@/app/cockpit/notificationstore";
import { globalStore } from "@/app/store/jotaiStore";
import type { AgentsViewModel } from "@/app/view/agents/agents";
import { harnessesAtom, harnessPreferenceAtom, resolveDefaultRuntime } from "@/app/view/agents/harnessstore";
import { composeStartupCommand, runtimeStartupCommand, type Runtime } from "@/app/view/agents/launch";
import { naFlagsAtom } from "@/app/view/agents/naflagsstore";
import { projectsAtom } from "@/app/view/agents/projectsstore";
import { openAgentFor, planIdeaPrompt, projectPathFor, workOnPrompt } from "./initiativework";
import { openTarget } from "./openref";

// the harness a Brief launch falls back to when none is preferred and the catalog has not loaded yet
const FALLBACK_RUNTIME: Runtime = "claude";

export interface WorkOnTarget {
    oref: string; // "effort:<oid>"
    title: string;
    project?: string;
    lastnote?: EffortLastNote;
}

// "plan" is an idea's Plan it: the same launch, asking for chunks instead of where things stand
export async function workOnInitiative(
    model: AgentsViewModel,
    e: WorkOnTarget,
    ask: "work" | "plan" = "work"
): Promise<void> {
    const oid = e.oref.replace(/^effort:/, "");
    const open = openAgentFor(oid, globalStore.get(model.agentsAtom));
    if (open != null) {
        await openTarget(model, { kind: "agent", tabId: open.id });
        return;
    }
    const projectPath = projectPathFor(e.project, globalStore.get(projectsAtom));
    if (projectPath === "") {
        pushToast({
            title: e.project ? `No folder for the project “${e.project}”` : `“${e.title}” has no project`,
            message: e.project
                ? "Register the project so an agent knows where to start."
                : "Set one with `wsh effort project`, so an agent knows where to start.",
            level: "error",
        });
        return;
    }
    const pref = globalStore.get(harnessPreferenceAtom).route?.runtime ?? "";
    const runtime = (resolveDefaultRuntime(pref, globalStore.get(harnessesAtom)) || FALLBACK_RUNTIME) as Runtime;
    try {
        await launchAgent(model, {
            runtime,
            // the flags New Agent remembers (e.g. skip permissions) apply here too
            startupCommand: composeStartupCommand(
                runtimeStartupCommand(runtime),
                runtime,
                globalStore.get(naFlagsAtom)[runtime] ?? {}
            ),
            task: ask === "plan" ? planIdeaPrompt(e.title, oid) : workOnPrompt(e.title, oid, e.lastnote),
            projectPath,
            projectName: e.project!,
            label: e.title,
            effortORef: e.oref,
        });
    } catch (err) {
        pushToast({
            title: `Couldn't start an agent on “${e.title}”`,
            message: err instanceof Error ? err.message : String(err),
            level: "error",
        });
    }
}
