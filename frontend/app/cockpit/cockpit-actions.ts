// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
import { atoms } from "@/app/store/global-atoms";
import { globalStore } from "@/app/store/jotaiStore";
import { WorkspaceService } from "@/app/store/services";
import { RpcApi } from "@/app/store/wshclientapi";
import * as WOS from "@/app/store/wos";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { showTerminal } from "@/app/view/agents/agentcenter";
import { AgentsViewModel } from "@/app/view/agents/agents";
import type { PendingLaunch } from "@/app/view/agents/agentsviewmodel";
import { resolveCwd } from "@/app/view/agents/agentcwdresolve";
import { buildLaunchMeta, runtimeCreatesAgentPanel, runtimeStartupCommand, type Runtime } from "@/app/view/agents/launch";
import { projectsAtom } from "@/app/view/agents/projectsstore";
import { openLauncher } from "@/app/view/agents/launcherstore";

export interface LaunchAgentOpts {
    runtime: Runtime;
    startupCommand: string;
    startupArgs?: string[]; // exact argv (pi resume path); forwarded verbatim when present
    task: string;
    extraArgs?: string[]; // argv after the task (codex --image); forwarded to buildLaunchMeta
    projectPath: string;
    projectName: string; // labels the roster row + carries project scope
    branch?: string;
    resumePath?: string; // pi transcript path; preflighted before any worktree/tab is created
    label?: string; // the session's name in the roster (session:label), e.g. the initiative it works on
    effortORef?: string; // the initiative it works on (session:effort), "effort:<oid>"
}

// Launch a runtime as its OWN session tab. Agent runtimes get a pending roster row; terminals only
// open in the Agent surface focus pane. We do NOT setActiveTab — the cockpit stays on the
// Agents tab; the agent's process starts when its terminal mounts in the focus pane. The new tab's
// default term block is reconfigured via SetMeta before it renders, so meta is honored at controller
// start (the backend starts controllers lazily on the first terminal-view resync).
export async function launchAgent(model: AgentsViewModel, opts: LaunchAgentOpts): Promise<string> {
    // Pi --session creates a session when the path is missing; a stale archived entry must never reach
    // that behavior, so a resumePath that no longer exists on disk aborts before anything is created.
    if (opts.resumePath) {
        try {
            await RpcApi.FileInfoCommand(TabRpcClient, { info: { path: opts.resumePath } });
        } catch {
            throw new Error(`Pi session no longer exists: ${opts.resumePath}`);
        }
    }
    const isTerminal = opts.runtime === "terminal";
    let cwd = opts.projectPath;
    if (!isTerminal && opts.branch?.trim()) {
        const rtn = await RpcApi.CreateWorktreeCommand(TabRpcClient, {
            projectpath: opts.projectPath,
            branch: opts.branch.trim(),
        });
        cwd = rtn.worktreepath;
    }
    // A terminal needs a cmd:cwd so the session sidebar detects it as a term session (buildLaunchMeta
    // only sets cmd:cwd when cwd is truthy); "~" falls back to the home dir on the backend.
    if (isTerminal && !cwd) {
        cwd = "~";
    }
    const ws = globalStore.get(atoms.workspace);
    if (ws?.oid == null) {
        throw new Error("no active workspace");
    }
    const tabId = await WorkspaceService.CreateTab(ws.oid, opts.projectName, false);
    const tab = globalStore.get(WOS.getWaveObjectAtom<Tab>(WOS.makeORef("tab", tabId)));
    const blockId = tab?.blockids?.[0];
    if (blockId == null) {
        throw new Error("new tab has no block");
    }
    const blockORef = WOS.makeORef("block", blockId);
    await RpcApi.SetMetaCommand(TabRpcClient, {
        oref: blockORef,
        meta: buildLaunchMeta({
            runtime: opts.runtime,
            startupCommand: opts.startupCommand,
            startupArgs: opts.startupArgs,
            task: opts.task,
            extraArgs: opts.extraArgs,
            cwd,
        }),
    });
    // Refresh the frontend's cached block object. getWaveObjectAtom does a one-time fetch and does
    // NOT subscribe, so the session sidebar's read of this block stays pinned to the pre-SetMeta
    // shell meta — leaving it without cmd:cwd, so the tab never enters the agent roster (the agent
    // renders as a bare terminal and the cockpit panel stays empty). Reload so the roster sees cmd.
    await WOS.reloadWaveObject(blockORef);
    // steering and skills are launch-time, for every runtime: a harness must never start against
    // a stale region. fire-and-forget — a sync failure must not block the launch.
    void RpcApi.AgentSyncApplyCommand(TabRpcClient, { dryrun: false }).catch(() => {});
    const agentPanel = runtimeCreatesAgentPanel(opts.runtime);
    const tabMeta: MetaType = agentPanel
        ? { "session:agent": opts.runtime, "session:project": opts.projectName }
        : { "session:project": opts.projectName };
    if (opts.label) {
        tabMeta["session:label"] = opts.label;
    }
    if (opts.effortORef) {
        tabMeta["session:effort"] = opts.effortORef;
    }
    await RpcApi.SetMetaCommand(TabRpcClient, { oref: WOS.makeORef("tab", tabId), meta: tabMeta });
    if (agentPanel) {
        const pending: PendingLaunch = {
            tabId,
            blockId,
            name: opts.label || opts.projectName,
            project: opts.projectName,
            ts: Date.now(),
        };
        globalStore.set(model.pendingLaunchesAtom, [...globalStore.get(model.pendingLaunchesAtom), pending]);
    }
    // Terminals launch in the background: leave the user where they are (no focus/surface change). The
    // terminal appears in the details rail's Terminals section and starts when first opened. Agents
    // foreground into the Agent surface so their booting terminal mounts (which starts the process).
    if (!isTerminal) {
        globalStore.set(model.focusIdAtom, tabId);
        globalStore.set(model.surfaceAtom, "agent");
        // a resumed session opens its new tab over the transcript it was resumed from
        showTerminal();
        // and its terminal takes the keyboard: from the Agent surface itself nothing else moves focus there (the
        // arrival hand-off only runs on a surface switch), and the New agent dialog's restore lands on the old
        // cell's hidden xterm or the button that opened it
        globalStore.set(model.typingFollowsAtom, tabId);
    }
    return tabId;
}

// Attach = resume a detached background agent inside a fresh Wave terminal block. `claude --resume
// <sessionId>` is the primitive; for a session the Claude Code daemon still runs it turns into
// `claude attach`, so the tab only holds the client and closing it stops the session by id
// (WorkspaceService.CloseTab -> bgagents.Stop). Task is empty so resume reattaches without replaying
// a prompt. Once it boots, the hook reporter registers it and the session-id dedup collapses the
// background-lane entry into the now-live agent.
export async function attachBackgroundAgent(
    model: AgentsViewModel,
    bg: { sessionId: string; cwd: string; project: string }
): Promise<void> {
    await launchAgent(model, {
        runtime: "claude",
        startupCommand: `claude --resume ${bg.sessionId}`,
        task: "",
        projectPath: bg.cwd,
        projectName: bg.project || "background",
    });
}

// launchPiTab launches a Pi tab at the focused agent's cwd (fallback: first registered project),
// mirroring the new-agent modal's launch shape. No resolvable cwd -> open the modal instead.
export async function launchPiTab(model: AgentsViewModel): Promise<void> {
    const focused = globalStore.get(model.agentsAtom).find((a) => a.id === globalStore.get(model.focusIdAtom)) ?? null;
    let cwd: string | null = null;
    if (focused?.transcriptPath) {
        cwd = await resolveCwd(focused.transcriptPath, focused.blockId);
    }
    if (!cwd) {
        const projects = globalStore.get(projectsAtom);
        cwd = Object.values(projects).find((p) => p.path)?.path ?? null;
    }
    if (!cwd) {
        openLauncher(model, "agent");
        return;
    }
    const projectName = cwd.split(/[\\/]/).filter(Boolean).pop() ?? cwd;
    await launchAgent(model, {
        runtime: "pi",
        startupCommand: runtimeStartupCommand("pi"),
        task: "",
        projectPath: cwd,
        projectName,
    });
}
