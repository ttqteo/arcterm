// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The plain shells launched beside the agents, as a focused terminal's rail shows them. The Agent tree's Terminals
// section lists every one of them; a focused terminal has no tools, files or run of its own, so its rail is this list
// alone (TerminalRail), its project's terminals first. A row focuses its terminal, which the surface then shows in the
// centre.

import { CollapsibleRail, type RailSection } from "@/app/element/collapsiblerail";
import { ContextMenuModel } from "@/app/store/contextmenu";
import { globalStore } from "@/app/store/jotaiStore";
import { cn } from "@/util/util";
import { useAtomValue } from "jotai";
import { Copy, CopyPlus, Pencil, SquareTerminal, X } from "lucide-react";
import { useMemo } from "react";
import { confirmCloseSession } from "./agentactions";
import { showTerminal } from "./agentcenter";
import { planTerminalRail } from "./agentrailsections";
import type { AgentsViewModel } from "./agents";
import { projectOf, type AgentVM } from "./agentsviewmodel";
import { RAIL_ICON } from "./railicons";
import { RAIL_ROW, RAIL_ROW_ACTION } from "./railrow";
import { railTerminalsAllAtom, railVisibleAtom } from "./railstore";
import { railTerminals, type RailTerminals } from "./railterminals";
import { RenameBox, startRowRename } from "./rowrename";
import { renamingRowAtom } from "./rowrenameatom";
import { agentProject } from "./runlineage";
import { duplicateSession } from "./session-models/sessionsidebarmodel";

// the terminals this rail lists for the focused item: its project's, or all of them on request. Memoized so the rows
// keep their identity across renders that change none of terminals, project and showAll (railTerminals returns a fresh
// array whenever it narrows)
export function useRailTerminals(model: AgentsViewModel, agent: AgentVM): RailTerminals {
    const terminals = useAtomValue(model.terminalsAtom);
    const project = agentProject(useAtomValue(model.lineageAtom), useAtomValue(model.agentsAtom), agent);
    const showAll = useAtomValue(railTerminalsAllAtom);
    return useMemo(() => railTerminals(terminals, project, showAll), [terminals, project, showAll]);
}

// A terminal row's menu, here and in the Agent tree: the actions an agent row offers, minus the agent-only wording (a
// terminal duplicates into a fresh shell in the same cwd). Rename matters more here than on an agent row: a terminal
// has no ai-title to name it, so without a rename it is stuck on the launch-time label it shares with every other
// shell in the repo.
export function showTerminalMenu(model: AgentsViewModel, terminal: AgentVM, e: React.MouseEvent): void {
    const items: ContextMenuItem[] = [
        { label: "Rename", icon: <Pencil size={15} />, click: () => startRowRename(terminal.id) },
        { label: "Duplicate", icon: <CopyPlus size={15} />, click: () => duplicateSession(model, terminal.id) },
        {
            label: "Copy name",
            icon: <Copy size={15} />,
            click: () => void navigator.clipboard.writeText(terminal.name),
        },
        { type: "separator" },
        {
            label: "Close terminal",
            icon: <X size={15} />,
            danger: true,
            click: () => confirmCloseSession(terminal),
        },
    ];
    ContextMenuModel.getInstance().showContextMenu(items, e);
}

function TerminalRailRow({
    model,
    terminal,
    selected,
    showProject,
}: {
    model: AgentsViewModel;
    terminal: AgentVM;
    selected: boolean;
    showProject: boolean;
}) {
    const renaming = useAtomValue(renamingRowAtom) === terminal.id;
    const project = projectOf(terminal);
    // what choosing an agent's tree row does (selectAgentRow in agenttree.tsx): focus it, drop the Cockpit's reply-box
    // flag, and bring the terminal back over any session or History in the centre
    const select = () => {
        globalStore.set(model.focusIdAtom, terminal.id);
        globalStore.set(model.focusReplyAtom, false);
        showTerminal();
    };
    const onContextMenu = (e: React.MouseEvent) => showTerminalMenu(model, terminal, e);
    // Enter and Space act as a click, but only on the row itself: the rename box is a child, and a Space typed in it
    // must not select
    const onKeyDown = (e: React.KeyboardEvent) => {
        if (e.target !== e.currentTarget) {
            return;
        }
        if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            select();
        }
    };
    return (
        <div
            data-rail-terminal={terminal.id}
            // a button while it is a row; while renaming it holds the name's input, and a button must not
            role={renaming ? undefined : "button"}
            tabIndex={renaming ? undefined : 0}
            aria-current={selected ? "true" : undefined}
            onClick={select}
            onKeyDown={onKeyDown}
            onContextMenu={onContextMenu}
            className={cn(
                RAIL_ROW,
                RAIL_ROW_ACTION,
                // selected keeps its fill under the pointer instead of taking the hover one
                selected && "bg-surface-selected text-primary hover:bg-surface-selected"
            )}
        >
            <SquareTerminal size={13} aria-hidden className="shrink-0 text-muted" />
            {renaming ? (
                <RenameBox tabId={terminal.id} />
            ) : (
                <span title={terminal.name} className="min-w-0 flex-1 truncate">
                    {terminal.name}
                </span>
            )}
            {showProject && project ? (
                <span className="max-w-[88px] shrink-0 truncate text-[10.5px] text-muted">{project}</span>
            ) : null}
        </div>
    );
}

export function TerminalsSection({
    model,
    view,
    focusId,
}: {
    model: AgentsViewModel;
    view: RailTerminals;
    focusId?: string;
}) {
    return (
        <div className="flex flex-col gap-[7px]">
            {view.rows.length === 0 ? (
                <div className="text-[11.5px] text-muted">No terminals in this project</div>
            ) : (
                view.rows.map((t) => (
                    <TerminalRailRow
                        key={t.id}
                        model={model}
                        terminal={t}
                        selected={focusId === t.id}
                        showProject={!view.scoped && view.other > 0}
                    />
                ))
            )}
            {/* `scoped` stays true when a project narrowed the list without hiding anything, so the toggle needs
                `other` */}
            {view.other > 0 ? (
                <button
                    type="button"
                    // scoped means the list is narrowed, so the click widens it; widened, it narrows again
                    onClick={() => globalStore.set(railTerminalsAllAtom, view.scoped)}
                    className="w-fit cursor-pointer rounded-[7px] px-[6px] py-[3px] text-[10.5px] font-semibold text-accent-soft hover:bg-surface-hover"
                >
                    {view.scoped ? `Show ${view.other} from other projects` : "Only this project"}
                </button>
            ) : null}
        </div>
    );
}

// The rail of a focused terminal: the Terminals section alone, in the same rail (same aside, same toggle) as an
// agent's, so `d` and the header button behave the same.
export function TerminalRail({ model, agent }: { model: AgentsViewModel; agent: AgentVM }) {
    const view = useRailTerminals(model, agent);
    const sections: RailSection[] = planTerminalRail({
        terminals: view.rows.length,
        terminalsOther: view.other,
    }).map((p) => ({
        id: p.id,
        label: "Terminals",
        icon: RAIL_ICON.terminal,
        header: p.header,
        content: <TerminalsSection model={model} view={view} focusId={agent.id} />,
    }));
    return <CollapsibleRail openAtom={railVisibleAtom} ariaLabel="Agent details" sections={sections} />;
}
