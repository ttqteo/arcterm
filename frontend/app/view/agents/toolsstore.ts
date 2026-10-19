// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// The tool library's state and actions: the catalog's statuses, which tools are pinned to the pickers, the "Open a tool"
// picker, and the actions that open a tool as a terminal and install one in a terminal of its own. Module-level atoms:
// every surface but Agent unmounts on a switch. The pure parts are in toolsmodel.ts.

import { createTermTab, launchAgent } from "@/app/cockpit/cockpit-actions";
import { atoms } from "@/app/store/global-atoms";
import { globalStore } from "@/app/store/jotaiStore";
import { WorkspaceService } from "@/app/store/services";
import * as WOS from "@/app/store/wos";
import { waveEventSubscribeSingle } from "@/app/store/wps";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { PLATFORM } from "@/util/platformutil";
import { atom, type PrimitiveAtom } from "jotai";
import { showTerminal } from "./agentcenter";
import type { AgentsViewModel } from "./agents";
import { appCwd, appProjectName, isAppTool } from "./appmodel";
import { adoptApp, probeApp, setAppView, trackApp, whileLaunching } from "./appstore";
import { homeDir } from "./appsuggeststore";
import { HOME_NAME, HOME_PICK } from "./launcher";
import { closeLauncher, type LauncherModel } from "./launcherstore";
import { dockedTerminalAtom, railCwdsAtom } from "./railstore";
import { agentProject } from "./runlineage";
import {
    DEFAULT_PINNED_TOOLS,
    installBlockMeta,
    installCommand,
    installOutcome,
    openToolRefusal,
    parsePinnedTools,
    toolCommandLine,
    toolCwd,
    toolProjectName,
    withPinned,
} from "./toolsmodel";

// the status read is a few PATH lookups; a stalled backend must reject rather than leave the library on "Reading…"
const READ_TIMEOUT_MS = 5000;

// An install block starts with no terminal view to size it, so it gets a size of its own: wide enough that winget's and
// brew's progress lines do not wrap. The view resizes it when the tab is opened.
const INSTALL_TERMSIZE = { rows: 30, cols: 120 };

// ---- status ----

// every tool with whether its command is on PATH; null until the first read
export const toolsStatusAtom = atom<ToolStatus[] | null>(null) as PrimitiveAtom<ToolStatus[] | null>;
export const toolsErrorAtom = atom<string | null>(null) as PrimitiveAtom<string | null>;

async function fetchTools(): Promise<void> {
    try {
        const rtn = await RpcApi.ToolsStatusCommand(TabRpcClient, { timeout: READ_TIMEOUT_MS });
        globalStore.set(toolsStatusAtom, rtn.tools ?? []);
        globalStore.set(toolsErrorAtom, null);
    } catch (e) {
        globalStore.set(toolsErrorAtom, e instanceof Error ? e.message : String(e));
    }
}

let inFlight: Promise<void> | null = null;
let readAgain = false;

// Reads the status. A read asked for while one is under way runs once more when it ends, so the newest ask is never
// answered by a read that began before it (an install that just finished).
export function loadTools(): Promise<void> {
    watchTools();
    if (inFlight != null) {
        readAgain = true;
        return inFlight;
    }
    inFlight = (async () => {
        try {
            do {
                readAgain = false;
                await fetchTools();
            } while (readAgain);
        } finally {
            inFlight = null;
        }
    })();
    return inFlight;
}

let watching = false;

// Once, from the first read on: the status is read again when the window is focused (a tool installed from outside
// arcterm shows up), and when tools.json changes (the reload after addUserTool / removeUserTool is asynchronous, so a
// read made straight after the write can still be the old list).
function watchTools(): void {
    if (watching) {
        return;
    }
    watching = true;
    if (typeof window !== "undefined") {
        window.addEventListener("focus", () => void loadTools());
    }
    let lastTools = globalStore.get(atoms.fullConfigAtom)?.tools;
    globalStore.sub(atoms.fullConfigAtom, () => {
        const tools = globalStore.get(atoms.fullConfigAtom)?.tools;
        if (tools !== lastTools) {
            lastTools = tools;
            void loadTools();
        }
    });
}

// ---- pinned ----

const PINNED_KEY = "tools.pinned";

function readPinned(): string[] {
    try {
        return parsePinnedTools(localStorage.getItem(PINNED_KEY));
    } catch {
        return [...DEFAULT_PINNED_TOOLS];
    }
}

const pinnedBaseAtom = atom<string[]>(readPinned());

// the tools "Open a tool" lists first (localStorage tools.pinned); lazygit, yazi and btop until the user changes it
export const pinnedToolsAtom = atom(
    (get) => get(pinnedBaseAtom),
    (_get, set, next: string[]) => {
        set(pinnedBaseAtom, next);
        try {
            localStorage.setItem(PINNED_KEY, JSON.stringify(next));
        } catch {
            // storage unavailable: the pin holds for this session
        }
    }
);

export function setToolPinned(id: string, on: boolean): void {
    globalStore.set(pinnedToolsAtom, withPinned(globalStore.get(pinnedToolsAtom), id, on));
}

// ---- the picker ----

export interface ToolPickerState {
    open: boolean;
    project?: string; // opened from a folder's tool button: the project root rather than the focused agent's folder
}

export const toolPickerAtom = atom<ToolPickerState>({ open: false }) as PrimitiveAtom<ToolPickerState>;

// Opens "Open a tool". The New dialog closes (its draft is kept) so two dialogs never stack, and the status is read
// fresh: a tool installed since the last read should be in the list.
export function openToolPicker(model: LauncherModel, project?: string): void {
    if (globalStore.get(model.launcherAtom) != null) {
        closeLauncher(model);
    }
    globalStore.set(toolPickerAtom, { open: true, project });
    void loadTools();
}

export function closeToolPicker(): void {
    globalStore.set(toolPickerAtom, { open: false });
}

// ---- opening a tool ----

export interface ToolContext {
    project?: string;
    projectRoot?: string;
    agentCwd?: string;
}

// Where a tool would open from. A project named by the caller (a folder's tool button, the New dialog) is its root and
// nothing more; otherwise the focused agent or terminal, which gives its project and the folder it is in: its worktree
// when it has one (the rail's resolved cwd, else the block's cmd:cwd). Nothing in focus gives nothing, which opens Home.
// The picker reads it too, so the line it shows is where the tool opens.
export function toolContext(model: AgentsViewModel, project?: string): ToolContext {
    const registry = globalStore.get(atoms.fullConfigAtom)?.projects ?? {};
    if (project) {
        return { project, projectRoot: registry[project]?.path || undefined };
    }
    const id = globalStore.get(model.focusIdAtom);
    const agents = globalStore.get(model.agentsAtom);
    const focused = [...agents, ...globalStore.get(model.terminalsAtom)].find((a) => a.id === id);
    if (focused == null) {
        return {};
    }
    const name = agentProject(globalStore.get(model.lineageAtom), agents, focused) || undefined;
    const blockMeta = focused.blockId
        ? WOS.getObjectValue<Block>(WOS.makeORef("block", focused.blockId))?.meta
        : undefined;
    const blockCwd = blockMeta?.["cmd:cwd"];
    return {
        project: name,
        projectRoot: (name && registry[name]?.path) || undefined,
        agentCwd: globalStore.get(railCwdsAtom)[focused.id] || (typeof blockCwd === "string" ? blockCwd : undefined),
    };
}

export type OpenToolPlace = "centre" | "panel";

export type OpenToolResult = { ok: true; tabId: string } | { ok: false; reason: string };

// Opens a tool as a terminal: a plain shell that types the tool's command line at its first prompt (launch.ts), in the
// folder toolCwd picks, stamped with the project toolProjectName picks. "centre" takes the Agent surface's focus, as an
// agent launch does; "panel" keeps the agent focused and docks the terminal under it. A tool whose command was not
// found is not opened (openToolRefusal): the result carries why, for the caller to show, and nothing is spawned.
export async function openTool(
    model: AgentsViewModel,
    tool: ToolStatus,
    opts: { project?: string; place: OpenToolPlace }
): Promise<OpenToolResult> {
    const reason = openToolRefusal(tool);
    if (reason != null) {
        return { ok: false, reason };
    }
    if (isAppTool(tool)) {
        return openApp(model, tool, opts.project);
    }
    const ctx = toolContext(model, opts.project);
    const tabId = await launchAgent(model, {
        runtime: "terminal",
        startupCommand: toolCommandLine(tool),
        task: "",
        projectPath: toolCwd(tool, { agentCwd: ctx.agentCwd, projectRoot: ctx.projectRoot, home: HOME_PICK }),
        projectName: toolProjectName(tool, ctx.project, HOME_NAME),
        toolId: tool.id,
        focus: opts.place === "centre",
    });
    if (opts.place === "panel") {
        // the panel is under the Agent surface's agent: a tool opened from Setup lands where it can be seen
        globalStore.set(model.surfaceAtom, "agent");
        globalStore.set(dockedTerminalAtom, tabId);
    }
    return { ok: true, tabId };
}

// A pinned app (appmodel.ts) always takes the centre, as its page shows there. One already open is shown again. A page
// that already answers gets a shell in the app's folder and nothing is run, so closing it leaves that server alone;
// otherwise the command runs in the app's terminal and the page shows once it answers.
async function openApp(model: AgentsViewModel, tool: ToolStatus, project?: string): Promise<OpenToolResult> {
    const open = globalStore.get(model.terminalsAtom).find((t) => t.toolId === tool.id && t.blockId != null);
    if (open != null) {
        adoptApp(open.id, open.blockId!, tool);
        setAppView(open.id, "page");
        globalStore.set(model.focusIdAtom, open.id);
        globalStore.set(model.surfaceAtom, "agent");
        showTerminal();
        return { ok: true, tabId: open.id };
    }
    return whileLaunching(tool.id, () => launchApp(model, tool, project));
}

async function launchApp(model: AgentsViewModel, tool: ToolStatus, project?: string): Promise<OpenToolResult> {
    const answered = await probeApp(tool.url!);
    const ctx = toolContext(model, project);
    const projects = globalStore.get(atoms.fullConfigAtom)?.projects ?? {};
    const projectName = tool.dir?.trim()
        ? appProjectName(tool.dir, projects, await homeDir(), HOME_NAME)
        : toolProjectName(tool, ctx.project, HOME_NAME);
    const tabId = await launchAgent(model, {
        runtime: "terminal",
        startupCommand: answered ? "" : toolCommandLine(tool),
        task: "",
        projectPath: appCwd(tool, { agentCwd: ctx.agentCwd, projectRoot: ctx.projectRoot, home: HOME_PICK }),
        projectName,
        toolId: tool.id,
        focus: true,
    });
    const blockId = (await WOS.reloadWaveObject<Tab>(WOS.makeORef("tab", tabId)))?.blockids?.[0];
    if (blockId != null) {
        trackApp(tabId, blockId, tool, !answered);
        if (!answered) {
            // kept on the block, so a reload of the page still knows closing this terminal stops the server
            await RpcApi.SetMetaCommand(TabRpcClient, {
                oref: WOS.makeORef("block", blockId),
                meta: { "tool:appowned": true },
            });
        }
        // started now: the page or its waiting card covers the terminal, so no pane mounts to start its shell
        await RpcApi.ControllerResyncCommand(TabRpcClient, {
            tabid: tabId,
            blockid: blockId,
            rtopts: { termsize: INSTALL_TERMSIZE },
        });
    }
    globalStore.set(model.surfaceAtom, "agent");
    return { ok: true, tabId };
}

// ---- installing a tool ----

// tool id -> the tab of its install terminal, while it runs
export const installingAtom = atom<Record<string, string>>({}) as PrimitiveAtom<Record<string, string>>;
// tool id -> the tab of its install terminal that exited non-zero: kept open with its output until closed or retried
export const failedAtom = atom<Record<string, string>>({}) as PrimitiveAtom<Record<string, string>>;

// the project each install terminal was opened in, so Try again opens the retry there
const installProjects = new Map<string, string | undefined>();

export type InstallResult = { ok: true; tabId: string } | { ok: false; reason: string };

function without(rec: Record<string, string>, toolId: string, tabId: string): Record<string, string> {
    if (rec[toolId] !== tabId) {
        return rec;
    }
    const next = { ...rec };
    delete next[toolId];
    return next;
}

// An install terminal is gone (exit 0 closed it, or the user did): the tool leaves both lists and its status is read
// again, to find the command it installed.
function installEnded(toolId: string, tabId: string): void {
    globalStore.set(installingAtom, without(globalStore.get(installingAtom), toolId, tabId));
    globalStore.set(failedAtom, without(globalStore.get(failedAtom), toolId, tabId));
    void loadTools();
}

// The install block's exit, from its runtime status. Exit 0: cmd:closeonexit closes the tab, and the status is read
// again. Non-zero: the tab stays with its output and the tool moves to the failed list. The block is also released from
// its controller: a terminal view mounting on an exited command block would start the command again, and opening the
// tab to read the output must not run an install a second time.
function watchInstall(toolId: string, tabId: string, blockId: string): () => void {
    const oref = WOS.makeORef("block", blockId);
    let unsubStatus = () => {};
    let unsubClose = () => {};
    const stop = () => {
        unsubStatus();
        unsubClose();
    };
    unsubClose = waveEventSubscribeSingle({
        eventType: "blockclose",
        scope: oref,
        handler: () => {
            stop();
            installEnded(toolId, tabId);
        },
    });
    unsubStatus = waveEventSubscribeSingle({
        eventType: "controllerstatus",
        scope: oref,
        handler: (event) => {
            const outcome = installOutcome(event.data);
            if (outcome === "running") {
                return;
            }
            unsubStatus();
            if (outcome === "ok") {
                stop();
                installEnded(toolId, tabId);
                return;
            }
            globalStore.set(installingAtom, without(globalStore.get(installingAtom), toolId, tabId));
            globalStore.set(failedAtom, { ...globalStore.get(failedAtom), [toolId]: tabId });
            void RpcApi.SetMetaCommand(TabRpcClient, { oref, meta: { controller: "" } }).catch(() => {});
            void loadTools();
        },
    });
    return stop;
}

// Installs a tool with the OS's package manager, in a terminal of its own named "Install <name>": the line is run, not
// typed into a shell, so its exit is seen (installBlockMeta). The terminal is in the project the install was asked from
// (the focused agent's when none is named), or Home. Nothing is installed silently: the output is there to read.
export async function installTool(model: AgentsViewModel, tool: ToolStatus, project?: string): Promise<InstallResult> {
    const line = installCommand(tool, PLATFORM);
    if (line == null) {
        return { ok: false, reason: `${tool.name} has no install command for this system` };
    }
    if (globalStore.get(installingAtom)[tool.id] != null) {
        return { ok: false, reason: `${tool.name} is already installing` };
    }
    const ctx = toolContext(model, project);
    const projectName = ctx.project || HOME_NAME;
    const { tabId, blockId } = await createTermTab(projectName);
    let stop = () => {};
    try {
        const blockORef = WOS.makeORef("block", blockId);
        await RpcApi.SetMetaCommand(TabRpcClient, {
            oref: blockORef,
            meta: installBlockMeta(line, ctx.projectRoot || HOME_PICK),
        });
        await WOS.reloadWaveObject(blockORef);
        await RpcApi.SetMetaCommand(TabRpcClient, {
            oref: WOS.makeORef("tab", tabId),
            meta: { "session:project": projectName, "session:label": `Install ${tool.name}` },
        });
        installProjects.set(tool.id, ctx.project);
        globalStore.set(installingAtom, { ...globalStore.get(installingAtom), [tool.id]: tabId });
        stop = watchInstall(tool.id, tabId, blockId);
        // started now, with no view mounted: the backend starts a block's controller on a resync, and a terminal left in
        // the background would not resync until someone opened it
        await RpcApi.ControllerResyncCommand(TabRpcClient, {
            tabid: tabId,
            blockid: blockId,
            rtopts: { termsize: INSTALL_TERMSIZE },
        });
    } catch (e) {
        stop();
        globalStore.set(installingAtom, without(globalStore.get(installingAtom), tool.id, tabId));
        const ws = globalStore.get(atoms.workspace);
        if (ws?.oid != null) {
            void WorkspaceService.CloseTab(ws.oid, tabId).catch(() => {});
        }
        throw e;
    }
    return { ok: true, tabId };
}

// Try again on a failed install: the failed terminal is closed and the install runs again where it did.
export async function retryInstall(model: AgentsViewModel, tool: ToolStatus): Promise<InstallResult> {
    const failedTab = globalStore.get(failedAtom)[tool.id];
    if (failedTab != null) {
        globalStore.set(failedAtom, without(globalStore.get(failedAtom), tool.id, failedTab));
        const ws = globalStore.get(atoms.workspace);
        if (ws?.oid != null) {
            await WorkspaceService.CloseTab(ws.oid, failedTab);
        }
    }
    return installTool(model, tool, installProjects.get(tool.id));
}

// Open output / Show: the install terminal, running or failed, in the centre. false when the tool has none.
export function showInstall(model: AgentsViewModel, toolId: string): boolean {
    const tabId = globalStore.get(installingAtom)[toolId] ?? globalStore.get(failedAtom)[toolId];
    if (tabId == null) {
        return false;
    }
    globalStore.set(model.focusIdAtom, tabId);
    globalStore.set(model.surfaceAtom, "agent");
    showTerminal();
    return true;
}

// ---- the user's own tools ----

// Writes (or, with removeUserTool, deletes) the tool's entry in tools.json, then reads the status. The file's reload is
// asynchronous, so this read can still be the old list: watchTools reads again when the config arrives.
export async function addUserTool(id: string, keywords: ToolKeywords): Promise<void> {
    await RpcApi.ToolsSetUserCommand(TabRpcClient, { id, tool: keywords });
    await loadTools();
}

export async function removeUserTool(id: string): Promise<void> {
    await RpcApi.ToolsSetUserCommand(TabRpcClient, { id });
    await loadTools();
}
