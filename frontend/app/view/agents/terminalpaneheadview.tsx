// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The slim header over a terminal shown in the centre (AgentSurface renders it where an agent has AgentHeader): its icon
// and name, the folder it runs in, its project, the quick way back to the agent in view before it (Ctrl Tab), and three
// buttons: open it beside that agent (a split), move it to the panel under the agent, close it. A pinned app's terminal
// adds Page | Log, Back, Forward, Reload (Windows), Home and Open in the browser, and its close stops the server arcterm started (appmodel.ts). What it
// says is terminalpanehead.ts's; this only reads the atoms and runs the buttons.

import { getApi } from "@/app/store/global";
import { globalStore } from "@/app/store/jotaiStore";
import { isWindows } from "@/util/platformutil";
import { cn } from "@/util/util";
import { useAtomValue } from "jotai";
import {
    ArrowLeft,
    ArrowRight,
    Columns2,
    ExternalLink,
    GitBranch,
    House,
    PanelBottom,
    RotateCw,
    Square,
    X,
} from "lucide-react";
import { useEffect, useMemo } from "react";
import { confirmCloseSession } from "./agentactions";
import type { AgentsViewModel } from "./agents";
import { projectOf, type AgentVM } from "./agentsviewmodel";
import { appCloseTitle, appFailLine, isAppTool, type AppView } from "./appmodel";
import { adoptApp, appHistory, appStatesAtom, homeApp, reloadAppPage, setAppView } from "./appstore";
import { agentGridAtom, canOpenInSplit, currentGrid, dropAgentOnGrid } from "./gridstore";
import { projectsAtom } from "./projectsstore";
import { moveToDock } from "./railstore";
import { SwapTabs } from "./swapbar";
import { recentTabsAtom } from "./tabswitcherstore";
import { previousTab, terminalPaneHead } from "./terminalpanehead";
import { ToolGlyph } from "./terminalsrail";
import { loadTools, toolsStatusAtom } from "./toolsstore";

const APP_VIEWS: { key: AppView; label: string }[] = [
    { key: "page", label: "Page" },
    { key: "log", label: "Log" },
];

const BUTTON =
    "flex h-[24px] w-[24px] shrink-0 cursor-pointer items-center justify-center rounded-[6px] text-muted hover:bg-surface-hover hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-muted";

const STOP_BUTTON =
    "flex h-[24px] shrink-0 cursor-pointer items-center gap-[5px] rounded-[6px] border border-edge-mid px-[8px] text-[11.5px] font-semibold text-secondary hover:border-error/50 hover:bg-error/15 hover:text-error focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent";

export function TerminalPaneHead({ model, terminal }: { model: AgentsViewModel; terminal: AgentVM }) {
    const agents = useAtomValue(model.agentsAtom);
    const terminals = useAtomValue(model.terminalsAtom);
    const recent = useAtomValue(recentTabsAtom);
    const projects = useAtomValue(projectsAtom);
    const tools = useAtomValue(toolsStatusAtom);
    // the tree reads the library on mount, but it is not mounted while the terminal is full screen
    useEffect(() => {
        if (tools == null) {
            void loadTools();
        }
    }, [tools]);
    // a pinned app (appmodel.ts): its page or its log, and a terminal that outlived a reload of the page picks its app up
    const tool = terminal.toolId != null ? tools?.find((t) => t.id === terminal.toolId) : undefined;
    const app = useAtomValue(appStatesAtom)[terminal.id];
    const appTool = tool != null && isAppTool(tool) ? tool : undefined;
    // Back and Forward only while the page is what shows: from the log they would move a page no one sees
    const onPage = app != null && app.phase === "open" && app.view === "page";
    useEffect(() => {
        if (appTool != null && terminal.blockId != null && app == null) {
            adoptApp(terminal.id, terminal.blockId, appTool);
        }
    }, [appTool, terminal.id, terminal.blockId, app]);
    const roots = useMemo(() => {
        const out = new Map<string, string>();
        for (const [name, project] of Object.entries(projects)) {
            if (project?.path) {
                out.set(name, project.path);
            }
        }
        return out;
    }, [projects]);
    // read for the render it forces: canOpenInSplit below reads the grid from the store, so a cell added or taken
    // away must repaint this header
    useAtomValue(agentGridAtom);
    const previous = previousTab(recent, terminal.id, [...agents, ...terminals]);
    const head = terminalPaneHead(terminal, previous, roots, tools ?? []);
    const back = head.backTo != null ? previous : undefined;
    const project = projectOf(terminal);
    // the agent the terminal opens beside: the one in view before it, while it can still take a cell
    // an app's page stands in the terminal's place, so it neither opens beside an agent nor moves to the panel
    const beside =
        app == null && back != null && back.blockId != null && canOpenInSplit(model, back.id) ? back : undefined;

    // The agent goes in a cell on the terminal's left and the terminal keeps the focus (an add focuses the new cell, but
    // the button sits on the terminal's header: you stay where you are).
    const openBeside = () => {
        if (beside == null) {
            return;
        }
        const at = Math.max(0, currentGrid(model).ids.indexOf(terminal.id));
        dropAgentOnGrid(model, beside.id, at, "left");
        globalStore.set(model.focusIdAtom, terminal.id);
    };

    return (
        <div
            data-terminal-pane-head={terminal.id}
            data-app-phase={app?.phase}
            data-app-owned={app != null ? String(app.owned) : undefined}
            className="flex h-[34px] shrink-0 items-center gap-[8px] border-b border-border bg-surface pl-[12px] pr-[8px]"
        >
            <ToolGlyph name={head.icon} className="text-muted" />
            <span title={head.name} className="min-w-0 truncate text-[13px] font-semibold text-primary">
                {head.name}
            </span>
            {head.place != null ? (
                <span
                    data-terminal-pane-place
                    className="flex min-w-0 shrink items-center gap-[3px] rounded-[5px] border border-edge-mid px-[6px] py-px text-[11px] text-muted"
                >
                    <GitBranch size={10} aria-hidden className="shrink-0" />
                    <span className="truncate">{head.place}</span>
                </span>
            ) : null}
            {project ? <span className="min-w-0 shrink truncate text-[11px] text-ink-faint">{project}</span> : null}
            {app != null ? (
                <SwapTabs
                    ariaLabel={`${head.name}: page or log`}
                    value={app.view === "log" || app.phase === "failed" ? "log" : "page"}
                    options={APP_VIEWS}
                    onChange={(v) => setAppView(terminal.id, v)}
                    className="mb-[-1px] mt-0 ml-[6px]"
                />
            ) : null}
            {app?.phase === "failed" ? (
                <span data-app-failed className="min-w-0 truncate text-[11.5px] text-warning-soft">
                    {appFailLine(app)}
                </span>
            ) : null}
            <span className="flex-1" />
            {head.backTo != null ? (
                <span
                    data-terminal-back-hint
                    className="flex min-w-0 items-center gap-[6px] whitespace-nowrap text-[11.5px] text-muted"
                >
                    <span className="shrink-0 rounded-[5px] border border-edge-mid px-[6px] py-px font-mono text-[10.5px]">
                        Ctrl Tab
                    </span>
                    <span className="truncate">back to {head.backTo}</span>
                </span>
            ) : null}
            {beside != null ? (
                <button
                    type="button"
                    data-terminal-open-split
                    aria-label={`Open beside ${beside.name}`}
                    title={`Open beside ${beside.name}`}
                    onClick={openBeside}
                    className={BUTTON}
                >
                    <Columns2 size={14} aria-hidden />
                </button>
            ) : null}
            {app == null ? (
                <button
                    type="button"
                    data-terminal-to-dock
                    aria-label="Move to the panel"
                    title="Move to the panel"
                    onClick={() => moveToDock(model, terminal.id)}
                    disabled={agents.every((a) => a.blockId == null)}
                    className={BUTTON}
                >
                    <PanelBottom size={14} aria-hidden />
                </button>
            ) : null}
            {app != null ? (
                <>
                    <button
                        type="button"
                        data-app-back
                        aria-label="Back"
                        title="Back"
                        disabled={!onPage}
                        onClick={() => appHistory(-1)}
                        className={BUTTON}
                    >
                        <ArrowLeft size={14} aria-hidden />
                    </button>
                    <button
                        type="button"
                        data-app-forward
                        aria-label="Forward"
                        title="Forward"
                        disabled={!onPage}
                        onClick={() => appHistory(1)}
                        className={BUTTON}
                    >
                        <ArrowRight size={14} aria-hidden />
                    </button>
                    {isWindows() ? (
                        // the host reloads the frame where it is (pagekeys.rs), which a Mac's webview cannot yet
                        <button
                            type="button"
                            data-app-reload
                            aria-label="Reload the page (Ctrl+R in it)"
                            title="Reload the page (Ctrl+R in it)"
                            disabled={!onPage}
                            onClick={() => void reloadAppPage(terminal.id)}
                            className={BUTTON}
                        >
                            <RotateCw size={14} aria-hidden />
                        </button>
                    ) : null}
                    <button
                        type="button"
                        data-app-home
                        aria-label="Home: the app's start page, loaded afresh"
                        title="Home: the app's start page, loaded afresh"
                        disabled={app.phase !== "open"}
                        onClick={() => homeApp(terminal.id)}
                        className={BUTTON}
                    >
                        <House size={14} aria-hidden />
                    </button>
                    <button
                        type="button"
                        data-app-browser
                        aria-label="Open in the browser"
                        title="Open in the browser"
                        onClick={() => getApi().openExternal(app.url)}
                        className={BUTTON}
                    >
                        <ExternalLink size={14} aria-hidden />
                    </button>
                </>
            ) : null}
            {app?.owned ? (
                // a word, not an icon: a square reads as the window's maximize
                <button
                    type="button"
                    data-terminal-close
                    aria-label={appCloseTitle(head.name, true)}
                    title={appCloseTitle(head.name, true)}
                    onClick={() => confirmCloseSession(terminal)}
                    className={STOP_BUTTON}
                >
                    <Square size={10} aria-hidden />
                    Stop
                </button>
            ) : (
                <button
                    type="button"
                    data-terminal-close
                    aria-label={app != null ? appCloseTitle(head.name, false) : `Close ${head.name}`}
                    title={app != null ? appCloseTitle(head.name, false) : `Close ${head.name}`}
                    onClick={() => confirmCloseSession(terminal)}
                    className={cn(BUTTON, "hover:bg-error/15 hover:text-error")}
                >
                    <X size={14} aria-hidden />
                </button>
            )}
        </div>
    );
}
