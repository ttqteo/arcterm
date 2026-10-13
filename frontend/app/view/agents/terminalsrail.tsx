// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// What a plain terminal's row in the Agent tree shares with its other faces: the glyph a terminal or tool wears (the
// row, the centre's pane head), the menu of its row, and the mark a row of a split cell wears (an agent's as well).

import { ContextMenuModel } from "@/app/store/contextmenu";
import { globalStore } from "@/app/store/jotaiStore";
import { cn } from "@/util/util";
import {
    Activity,
    BookOpen,
    Columns2,
    Container,
    Copy,
    CopyPlus,
    Folder,
    GitBranch,
    PanelBottom,
    Pencil,
    SquareTerminal,
    Wrench,
    X,
    type LucideIcon,
} from "lucide-react";
import { confirmCloseSession } from "./agentactions";
import type { AgentsViewModel } from "./agents";
import type { AgentVM } from "./agentsviewmodel";
import { canOpenInSplit, endSplit, isInSplit, openInSplit, removeFromGrid } from "./gridstore";
import { rosterSeededAtom } from "./liveagents";
import { dockedTerminalAtom, moveToDock, undock } from "./railstore";
import { startRowRename } from "./rowrename";
import { duplicateSession } from "./session-models/sessionsidebarmodel";
import type { ToolIconName } from "./toolsmodel";

// the lucide icon of each toolIcon name; the palette's rows take the component itself, the tree draws ToolGlyph
export const TOOL_GLYPHS: Record<ToolIconName, LucideIcon> = {
    "git-branch": GitBranch,
    folder: Folder,
    activity: Activity,
    container: Container,
    "book-open": BookOpen,
    wrench: Wrench,
    terminal: SquareTerminal,
};

/** The glyph for a terminal or tool: `name` is toolIcon's (the tool's category icon, "terminal" for a plain shell). */
export function ToolGlyph({ name, size = 13, className }: { name: ToolIconName; size?: number; className?: string }) {
    const Icon = TOOL_GLYPHS[name];
    return <Icon size={size} aria-hidden className={cn("shrink-0", className)} />;
}

/** The mark an Agent tree row wears while its agent or terminal is a cell of the split on screen: the row stays in its
 *  folder, so this is how the tree says which rows the split shows. */
export function SplitMark() {
    return (
        <span
            data-row-in-split
            title="In the split"
            aria-label="in the split"
            className="flex flex-none text-ink-faint"
        >
            <Columns2 size={11} aria-hidden />
        </span>
    );
}

// Open a terminal beside the agent in view: the panel gives up a terminal it holds first (the grid prunes the docked
// one), then it becomes a cell; plain focus when it can no longer be split (the grid changed after the menu opened)
function openTerminalInSplit(model: AgentsViewModel, id: string): void {
    undock(model, id);
    if (!openInSplit(model, id)) {
        model.openTerminal(id);
    }
}

// What a split cell's row menu offers for the split, an agent's or a terminal's: take this cell out (it keeps running),
// or keep only the focused one
export function splitCellMenuItems(model: AgentsViewModel, id: string): ContextMenuItem[] {
    return [
        { label: "Remove from split", icon: <X size={15} />, click: () => removeFromGrid(model, id) },
        { label: "End split", icon: <Columns2 size={15} />, click: () => endSplit(model) },
    ];
}

// A terminal row's menu in the Agent tree: the actions an agent row offers, minus the agent-only wording (a
// terminal duplicates into a fresh shell in the same cwd), plus where it shows: beside the agent in a split cell, or in
// the panel under it. Rename matters more here than on an agent row: a terminal has no ai-title to name it, so without a
// rename it is stuck on the launch-time label it shares with every other shell in the repo. `name` is what the row
// reads (a tool's name rather than the shell's launch label).
export function terminalMenuItems(
    model: AgentsViewModel,
    terminal: AgentVM,
    name: string = terminal.name
): ContextMenuItem[] {
    const docked = globalStore.get(dockedTerminalAtom) === terminal.id;
    const canDock = globalStore.get(model.agentsAtom).some((a) => a.blockId != null);
    return [
        ...(isInSplit(model, terminal.id)
            ? splitCellMenuItems(model, terminal.id)
            : [
                  {
                      label: "Open in split",
                      icon: <Columns2 size={15} />,
                      enabled: globalStore.get(rosterSeededAtom) && canOpenInSplit(model, terminal.id),
                      click: () => openTerminalInSplit(model, terminal.id),
                  },
              ]),
        // a terminal already in the panel has nowhere to move to but a split
        ...(docked
            ? []
            : [
                  {
                      label: "Move to the panel",
                      icon: <PanelBottom size={15} />,
                      enabled: canDock,
                      click: () => void moveToDock(model, terminal.id),
                  },
              ]),
        { type: "separator" },
        { label: "Rename", icon: <Pencil size={15} />, click: () => startRowRename(terminal.id) },
        { label: "Duplicate", icon: <CopyPlus size={15} />, click: () => duplicateSession(model, terminal.id) },
        {
            label: "Copy name",
            icon: <Copy size={15} />,
            click: () => void navigator.clipboard.writeText(name),
        },
        { type: "separator" },
        {
            label: "Close terminal",
            icon: <X size={15} />,
            danger: true,
            click: () => confirmCloseSession(terminal),
        },
    ];
}

export function showTerminalMenu(model: AgentsViewModel, terminal: AgentVM, e: React.MouseEvent, name?: string): void {
    ContextMenuModel.getInstance().showContextMenu(terminalMenuItems(model, terminal, name), e);
}
