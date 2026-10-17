// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Work on an initiative: go to the agent already open on it, else start one in the initiative's project with
// the "where are we" prompt, named after the initiative and linked to it. The Brief row, its `w` key and the
// palette's ctrl+enter all run this, so they cannot disagree about which of the two happens. An initiative with
// no project asks for one first (initiativeprojectpicker.tsx), keeps it, then goes on with the same launch.

import { launchAgent } from "@/app/cockpit/cockpit-actions";
import { pushToast } from "@/app/cockpit/notificationstore";
import { globalStore } from "@/app/store/jotaiStore";
import type { AgentsViewModel } from "@/app/view/agents/agents";
import { harnessesAtom, harnessPreferenceAtom, resolveDefaultRuntime } from "@/app/view/agents/harnessstore";
import { composeStartupCommand, runtimeStartupCommand, type Runtime } from "@/app/view/agents/launch";
import { naFlagsAtom } from "@/app/view/agents/naflagsstore";
import { projectsAtom } from "@/app/view/agents/projectsstore";
import { atom, type PrimitiveAtom } from "jotai";
import { effortDetailAtom, loadEffortDetail } from "./effortstore";
import {
    chunkPrompt,
    dueChunkPrompt,
    openAgentFor,
    planIdeaPrompt,
    projectPathFor,
    workOnPrompt,
} from "./initiativework";
import { openTarget } from "./openref";

// the harness a Brief launch falls back to when none is preferred and the catalog has not loaded yet
const FALLBACK_RUNTIME: Runtime = "claude";

export interface WorkOnTarget {
    oref: string; // "effort:<oid>"
    title: string;
    project?: string;
    lastnote?: EffortLastNote;
}

// "plan" is an idea's Plan it: the same launch, asking for chunks instead of where things stand; { due } asks
// for what a chunk that came due says to do; { chunk } is the chunk panel's Work on this chunk
export type WorkAsk = "work" | "plan" | { due: string } | { chunk: string };

// the launch waiting on a project: set when Work on meets an initiative with none, read by the picker the cockpit
// root mounts, since the palette and Needs you start a launch from any surface
type ProjectAsk = { target: WorkOnTarget; ask: WorkAsk };
export const projectAskAtom = atom<ProjectAsk | null>(null) as PrimitiveAtom<ProjectAsk | null>;

export async function workOnInitiative(model: AgentsViewModel, e: WorkOnTarget, ask: WorkAsk = "work"): Promise<void> {
    const oid = e.oref.replace(/^effort:/, "");
    const open = openAgentFor(oid, globalStore.get(model.agentsAtom));
    if (open != null) {
        await openTarget(model, { kind: "agent", tabId: open.id });
        return;
    }
    const projectPath = projectPathFor(e.project, globalStore.get(projectsAtom));
    if (projectPath === "" && !e.project) {
        globalStore.set(projectAskAtom, { target: e, ask });
        return;
    }
    if (projectPath === "") {
        pushToast({
            title: `No folder for the project “${e.project}”`,
            message: "Register the project so an agent knows where to start.",
            level: "error",
            action: { label: "Register project", run: () => globalStore.set(model.newProjectOpenAtom, true) },
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
            task:
                ask === "plan"
                    ? planIdeaPrompt(e.title, oid)
                    : ask === "work"
                      ? workOnPrompt(e.title, oid, e.lastnote)
                      : "chunk" in ask
                        ? chunkPrompt(e.title, oid, ask.chunk)
                        : dueChunkPrompt(e.title, oid, ask.due),
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

// Work on from a due chunk's row in Needs you. The row carries only the initiative's oref and the chunk, so the
// initiative is read for its title and project first; the rest is workOnInitiative's, an open agent included.
export async function workOnDueChunk(model: AgentsViewModel, effortORef: string, chunk: string): Promise<void> {
    try {
        await loadEffortDetail(effortORef);
    } catch (err) {
        pushToast({
            title: "Couldn't read the initiative",
            message: err instanceof Error ? err.message : String(err),
            level: "error",
        });
        return;
    }
    const e = globalStore.get(effortDetailAtom).get(effortORef);
    if (e == null) {
        return;
    }
    await workOnInitiative(model, { oref: effortORef, title: e.title, project: e.project }, { due: chunk });
}
