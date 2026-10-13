// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// What the slim header over a terminal in the centre or in a grid cell says (terminalpaneheadview.tsx): the terminal's
// name and icon (a tool's own while it runs one, as the tree's row names it), the folder it runs in when that is not its
// project's root, and the agent a quick Ctrl+Tab goes back to. Pure: the component reads the atoms and passes the rows in.

import { terminalPlace } from "./agentsidebarmodel";
import { projectOf, type AgentVM } from "./agentsviewmodel";
import { toolIcon, toolTerminalName, type ToolIconName } from "./toolsmodel";

export interface TerminalPaneHead {
    name: string;
    // the lucide icon the header and the tree's row draw: the tool's category icon, "terminal" for a plain shell
    icon: ToolIconName;
    // the last folder of the terminal's cwd when it is not the project's root (terminalPlace): the chip beside the name
    place: string | undefined;
    // the agent in view before this terminal, which Ctrl+Tab returns to; undefined when that was a terminal or nothing
    backTo: string | undefined;
}

/** Pure: the header of `terminal`. `previous` is the tab in view before it (previousTab); `roots` maps a project name to
 *  its root path, as projectTree takes it; `tools` is the tool library's status (toolsStatusAtom, [] until it loads),
 *  which names a terminal opened from it and picks its icon. */
export function terminalPaneHead(
    terminal: AgentVM,
    previous: AgentVM | undefined,
    roots: ReadonlyMap<string, string>,
    tools: ToolStatus[] = []
): TerminalPaneHead {
    const tool = terminal.toolId ? tools.find((t) => t.id === terminal.toolId) : undefined;
    return {
        name: toolTerminalName(terminal, tools),
        icon: toolIcon(tool),
        place: terminalPlace(terminal.cwd, roots.get(projectOf(terminal))),
        backTo: previous != null && previous.kind !== "terminal" ? previous.name : undefined,
    };
}

/** Pure: the tab in view before `currentId`: the first entry of the recent list (newest first, as Ctrl+Tab keeps it)
 *  that is not the current one and is still on the roster. */
export function previousTab(
    recent: readonly string[],
    currentId: string,
    roster: readonly AgentVM[]
): AgentVM | undefined {
    for (const id of recent) {
        if (id === currentId) {
            continue;
        }
        const found = roster.find((a) => a.id === id);
        if (found != null) {
            return found;
        }
    }
    return undefined;
}

/** Pure: whose header and details rail the Agent surface shows. The focused item's own, except a terminal focused in a
 *  split that also holds an agent: then that agent (of several, the one in view most recently, `recent` newest first,
 *  else the first in cell order), so moving the focus between the cells of a split never swaps the header or drops the
 *  rail. `cells` are the visible cells' ids; one cell is no split. */
export function headSubject(
    focused: AgentVM,
    cells: readonly string[],
    recent: readonly string[],
    roster: readonly AgentVM[]
): AgentVM {
    if (focused.kind !== "terminal" || cells.length < 2 || !cells.includes(focused.id)) {
        return focused;
    }
    const agents = cells.flatMap((id) => roster.find((a) => a.id === id && a.kind !== "terminal") ?? []);
    if (agents.length === 0) {
        return focused;
    }
    return recent.flatMap((id) => agents.find((a) => a.id === id) ?? [])[0] ?? agents[0];
}
