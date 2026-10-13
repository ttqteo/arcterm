// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The slim header over a terminal shown in the centre (AgentSurface renders it where an agent has AgentHeader): its icon
// and name, the folder it runs in, its project, the quick way back to the agent in view before it (Ctrl Tab), and three
// buttons: open it beside that agent (a split), move it to the panel under the agent, close it. What it says is
// terminalpanehead.ts's; this only reads the atoms and runs the buttons.

import { globalStore } from "@/app/store/jotaiStore";
import { cn } from "@/util/util";
import { useAtomValue } from "jotai";
import { Columns2, GitBranch, PanelBottom, X } from "lucide-react";
import { useEffect, useMemo } from "react";
import { confirmCloseSession } from "./agentactions";
import type { AgentsViewModel } from "./agents";
import { projectOf, type AgentVM } from "./agentsviewmodel";
import { agentGridAtom, canOpenInSplit, currentGrid, dropAgentOnGrid } from "./gridstore";
import { projectsAtom } from "./projectsstore";
import { moveToDock } from "./railstore";
import { recentTabsAtom } from "./tabswitcherstore";
import { previousTab, terminalPaneHead } from "./terminalpanehead";
import { ToolGlyph } from "./terminalsrail";
import { loadTools, toolsStatusAtom } from "./toolsstore";

const BUTTON =
    "flex h-[24px] w-[24px] shrink-0 cursor-pointer items-center justify-center rounded-[6px] text-muted hover:bg-surface-hover hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-muted";

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
    const beside = back != null && back.blockId != null && canOpenInSplit(model, back.id) ? back : undefined;

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
            <button
                type="button"
                data-terminal-close
                aria-label={`Close ${head.name}`}
                title={`Close ${head.name}`}
                onClick={() => confirmCloseSession(terminal)}
                className={cn(BUTTON, "hover:bg-error/15 hover:text-error")}
            >
                <X size={14} aria-hidden />
            </button>
        </div>
    );
}
