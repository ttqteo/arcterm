// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Where a file path link goes (docs/superpowers/specs/2026-10-06-agent-rail-tabs-design.md): an agent's terminal or
// transcript opens it in that agent's panel, a plain terminal in the Code surface. The model is bound at boot,
// because the terminal's link provider lives outside React.

import { pushToast } from "@/app/cockpit/notificationstore";
import { isUnderRoot } from "@/app/cockpit/openfileroute";
import { globalStore } from "@/app/store/jotaiStore";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { fireAndForget } from "@/util/util";
import { resolveCwd } from "./agentcwdresolve";
import { openFileInPanel, openRefInCode } from "./agentrailstore";
import type { FileRef } from "./agentrailtabs";
import type { AgentsViewModel, SurfaceKey } from "./agents";
import type { AgentVM } from "./agentsviewmodel";
import { resolvePath } from "./pathlinks";
import { railStateAtom } from "./railstore";

let boundModel: AgentsViewModel | null = null;

export function setPathLinkModel(model: AgentsViewModel | null): void {
    boundModel = model;
}

// the roster entry with a panel that a terminal block belongs to: an agent's TUI, never a plain terminal
export function panelOwnerOf(roster: AgentVM[], blockId: string): AgentVM | undefined {
    const owner = roster.find((a) => a.blockId === blockId);
    return owner != null && owner.kind !== "terminal" ? owner : undefined;
}

// the agent whose panel a palette pick opens in, or null for the Code surface
export function focusedPanelAgent(input: {
    surface: SurfaceKey;
    focusId: string | null | undefined;
    roster: AgentVM[];
    cwd: string | null | undefined;
    abs: string;
}): string | null {
    if (input.surface !== "agent" || input.focusId == null || input.cwd == null) {
        return null;
    }
    const agent = input.roster.find((a) => a.id === input.focusId);
    if (agent == null || agent.kind === "terminal") {
        return null;
    }
    return isUnderRoot(input.cwd, input.abs) ? agent.id : null;
}

function roster(model: AgentsViewModel): AgentVM[] {
    return [...globalStore.get(model.agentsAtom), ...globalStore.get(model.terminalsAtom)];
}

export function openPathFromTerminal(blockId: string, ref: FileRef): void {
    const model = boundModel;
    if (model == null) {
        return;
    }
    const owner = panelOwnerOf(roster(model), blockId);
    if (owner != null) {
        openFileInPanel(model, owner.id, ref);
        return;
    }
    fireAndForget(() => openRefInCode(model, ref));
}

export async function fileExists(abs: string): Promise<boolean> {
    try {
        const info = await RpcApi.FileInfoCommand(TabRpcClient, { info: { path: abs } });
        return info != null && !info.notfound && !info.isdir;
    } catch {
        return false;
    }
}

// a transcript's link: resolved against the agent's working directory, checked, then opened in its panel
export async function openAgentPath(agent: AgentVM, path: string, line?: number): Promise<void> {
    const model = boundModel;
    if (model == null) {
        return;
    }
    const cwd = await resolveCwd(agent.transcriptPath, agent.blockId);
    const abs = resolvePath(cwd, path);
    if (abs == null || !(await fileExists(abs))) {
        pushToast({ title: `File not found: ${path}`, message: "", level: "warn" });
        return;
    }
    openFileInPanel(model, agent.id, { abs, root: cwd, ...(line != null ? { line } : {}) });
}

// a palette pick: the focused agent's panel when the Agent surface shows it and the file is under its directory
export function openInFocusedPanel(model: AgentsViewModel, abs: string, line?: number): boolean {
    const cwd = globalStore.get(railStateAtom)?.cwd ?? null;
    const agentId = focusedPanelAgent({
        surface: globalStore.get(model.surfaceAtom),
        focusId: globalStore.get(model.focusIdAtom),
        roster: globalStore.get(model.agentsAtom),
        cwd,
        abs,
    });
    if (agentId == null) {
        return false;
    }
    openFileInPanel(model, agentId, { abs, root: cwd, ...(line != null ? { line } : {}) });
    return true;
}
