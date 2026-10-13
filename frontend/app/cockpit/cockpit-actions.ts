// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
import { pushToast } from "@/app/cockpit/notificationstore";
import { atoms } from "@/app/store/global-atoms";
import { globalStore } from "@/app/store/jotaiStore";
import { WorkspaceService } from "@/app/store/services";
import { RpcApi } from "@/app/store/wshclientapi";
import * as WOS from "@/app/store/wos";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { showTerminal } from "@/app/view/agents/agentcenter";
import { AgentsViewModel } from "@/app/view/agents/agents";
import { asleepLaunchMeta, wakeAgent, wakeErrorToast, type AsleepLaunch } from "@/app/view/agents/agentsleep";
import type { AgentVM, PendingLaunch } from "@/app/view/agents/agentsviewmodel";
import { buildLaunchMeta, runtimeCreatesAgentPanel, type Runtime } from "@/app/view/agents/launch";
import { sessionHolder } from "@/app/view/agents/sessionsarchivestore";
import { stringToBase64 } from "@/util/util";

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
    // the transcript of the session this launch resumes: when a tab already holds it, awake or asleep, the launch goes
    // to that tab instead of opening a second one (goToHolder)
    resumeOf?: string;
    label?: string; // the session's name in the roster (session:label), e.g. the initiative it works on
    effortORef?: string; // the initiative it works on (session:effort), "effort:<oid>"
    // open asleep: the tab is made with its resume command and marked asleep, so it shows the session's transcript and
    // starts on Wake or a message (asleepLaunchMeta). Its process never starts here.
    asleep?: AsleepLaunch;
    toolId?: string; // a terminal opened from the tool library (block meta tool:id); startupCommand is its command line
    // take the Agent surface's focus on launch, as an agent does. A plain Terminal launch leaves it in the background
    // (see below); a tool opened into the centre sets this.
    focus?: boolean;
}

// A new tab and the id of the term block it opens with, for the caller to configure with SetMeta before the block
// renders. Used for every launch, and by an install, which starts its own block (toolsstore.ts installTool).
export async function createTermTab(tabName: string): Promise<{ tabId: string; blockId: string }> {
    const ws = globalStore.get(atoms.workspace);
    if (ws?.oid == null) {
        throw new Error("no active workspace");
    }
    const tabId = await WorkspaceService.CreateTab(ws.oid, tabName, false);
    const tab = globalStore.get(WOS.getWaveObjectAtom<Tab>(WOS.makeORef("tab", tabId)));
    const blockId = tab?.blockids?.[0];
    if (blockId == null) {
        throw new Error("new tab has no block");
    }
    return { tabId, blockId };
}

// Launch a runtime as its OWN session tab. Agent runtimes get a pending roster row; terminals only
// open in the Agent surface focus pane. We do NOT setActiveTab — the cockpit stays on the
// Agents tab; the agent's process starts when its terminal mounts in the focus pane. The new tab's
// default term block is reconfigured via SetMeta before it renders, so meta is honored at controller
// start (the backend starts controllers lazily on the first terminal-view resync).
export async function launchAgent(model: AgentsViewModel, opts: LaunchAgentOpts): Promise<string> {
    const holder = sessionHolder(globalStore.get(model.agentsAtom), opts.resumeOf);
    if (holder) {
        await goToHolder(model, holder, opts.task.trim());
        return holder.id;
    }
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
    const { tabId, blockId } = await createTermTab(opts.projectName);
    const blockORef = WOS.makeORef("block", blockId);
    await RpcApi.SetMetaCommand(TabRpcClient, {
        oref: blockORef,
        meta: {
            ...buildLaunchMeta({
                runtime: opts.runtime,
                startupCommand: opts.startupCommand,
                startupArgs: opts.startupArgs,
                task: opts.task,
                extraArgs: opts.extraArgs,
                cwd,
                toolId: opts.toolId,
            }),
            ...(opts.asleep ? asleepLaunchMeta(opts.asleep) : {}),
        },
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
    // an agent opened asleep is on the roster at once (sleepingStatus): it never reports in, so no pending row waits on it
    if (agentPanel && !opts.asleep) {
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
    // foreground into the Agent surface so their booting terminal mounts (which starts the process), and so
    // does a terminal asked to take the focus (a tool opened into the centre).
    if (!isTerminal || opts.focus) {
        globalStore.set(model.focusIdAtom, tabId);
        globalStore.set(model.surfaceAtom, "agent");
        // a resumed session opens its new tab over the transcript it was resumed from
        showTerminal();
        // and its terminal takes the keyboard: from the Agent surface itself nothing else moves focus there (the
        // arrival hand-off only runs on a surface switch), and the New agent dialog's restore lands on the old
        // cell's hidden xterm or the button that opened it. Not one opened asleep: it has no process to type into.
        if (!opts.asleep) {
            globalStore.set(model.typingFollowsAtom, tabId);
        }
    }
    return tabId;
}

// A resume of a session a tab already holds: two tabs on it would run two processes writing one transcript, so the
// launch takes that tab's focus instead, as a new agent's would. A message given with it wakes a sleeping agent with
// it, or is typed into an awake one, as the agent's composer sends it. A failed wake toasts, as everywhere else.
async function goToHolder(model: AgentsViewModel, holder: AgentVM, message: string): Promise<void> {
    globalStore.set(model.focusIdAtom, holder.id);
    globalStore.set(model.surfaceAtom, "agent");
    showTerminal();
    if (!holder.sleeping) {
        globalStore.set(model.typingFollowsAtom, holder.id);
    }
    pushToast({
        title: `${holder.name} is already open`,
        message: "Went to its tab rather than open the conversation a second time.",
        level: "info",
    });
    if (message === "") {
        return;
    }
    if (holder.sleeping) {
        try {
            await wakeAgent(holder.id, { message });
        } catch (e) {
            wakeErrorToast(holder.name, e);
        }
    } else if (holder.blockId) {
        await RpcApi.ControllerInputCommand(TabRpcClient, {
            blockid: holder.blockId,
            inputdata64: stringToBase64(message + "\r"),
        });
    }
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
