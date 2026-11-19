// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Library → Boards as data: the rows of the list (the app bar's project, or every project), newest first, filtered by
// name, each saying who drew it and whether that agent still runs. Pure: no React, no RPC. The board's own facts and the
// agent-is-alive rule are the split's (boards/boardtalkmodel.ts), so the list and the split read a board the same way.

import { ALL_PROJECTS } from "../agents/agentsidebarmodel";
import { agentAlive, boardFacts, plural } from "../boards/boardtalkmodel";
import type { LibraryBoardSel } from "./librarystore";

export type BoardAgentState = "running" | "ended";

export interface BoardRow {
    key: string; // project/id: a board id is unique within a project
    id: string;
    project: string;
    name: string;
    agent: string; // the agent's title as the roster gave it; "" when the board has none
    alive: boolean; // the agent's tab is in the roster (sleeping counts)
    agentState: BoardAgentState;
    shapes: number; // 0 for a board nothing was drawn on: its thumbnail needs no read
    summary: string; // "2 turns · 9 shapes · drawn 15:20"
    activets: number;
    loaderror: string; // why the file does not open ("" when it does): no thumbnail
}

// the project the board list is read for: the app bar's filter, with "none picked" as the store's every-project ""
export function boardsScope(projectFilter: string): string {
    return projectFilter === ALL_PROJECTS ? "" : projectFilter;
}

// the rows of `list` whose name has `query` in it, newest first. `alive` reads the roster as it is, so a row turns to
// ended the moment its agent's tab closes.
export function boardRows(
    list: readonly BoardInfo[] | null | undefined,
    opts: { query: string; roster: readonly { id: string }[]; now: number }
): BoardRow[] {
    const want = opts.query.trim().toLowerCase();
    return (list ?? [])
        .filter((b) => want === "" || b.name.toLowerCase().includes(want))
        .map((b): BoardRow => {
            const alive = agentAlive(b.agenttabid, opts.roster);
            return {
                key: `${b.project}/${b.id}`,
                id: b.id,
                project: b.project,
                name: b.name,
                agent: b.agenttitle ?? "",
                alive,
                agentState: alive ? "running" : "ended",
                shapes: b.shapes ?? 0,
                summary: `${plural(b.turns ?? 0, "turn")} · ${boardFacts(b, opts.now)}`,
                activets: b.activets,
                loaderror: b.loaderror ?? "",
            };
        })
        .sort((a, b) => b.activets - a.activets);
}

// the open board's row, or null when nothing is open or the list no longer holds it (another project, a search)
export function boardsSelectionIn(rows: readonly BoardRow[], sel: LibraryBoardSel | null): BoardRow | null {
    if (sel == null) {
        return null;
    }
    return rows.find((r) => r.project === sel.project && r.id === sel.boardId) ?? null;
}

const HOW_BOARDS_START = "Boards appear when an agent runs wsh board draw.";

// what the list says when it has no rows: a search that found none, else that the scope holds no boards
export function boardsEmptyText(scope: string, query: string): string {
    const q = query.trim();
    if (q !== "") {
        return `No board named "${q}".`;
    }
    return scope === "" ? `No boards yet. ${HOW_BOARDS_START}` : `No boards in ${scope} yet. ${HOW_BOARDS_START}`;
}
