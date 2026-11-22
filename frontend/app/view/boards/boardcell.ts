// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// A board as a cell of the Agent surface's grid: the third kind of cell beside agents and terminals, id
// `board:<project>/<boardId>`, a cell of its own that any number of boards can have. Pure: the id encoding and the rule
// that adds the cell to a grid. Which boards are open is boardentries.ts's list. A board cell is a rider
// (agentgrid.ts settleRiders): it never holds focus, and a grid with no tab in it drops it.

import { addCell, MAX_CELLS, normalizeGrid, placesOf, removeCell, type GridState } from "../agents/agentgrid";
import { boardKey, parseBoardKey, type BoardSplit } from "./boardentries";

export const BOARD_CELL_PREFIX = "board:";

export function boardCellId(ref: BoardSplit): string {
    return `${BOARD_CELL_PREFIX}${boardKey(ref)}`;
}

// The board a cell shows; undefined for an agent or terminal id, and for a board cell saved before boards were cells
// of their own (`board:<agentId>`), which no open board matches.
export function boardCellRef(id: string): BoardSplit | undefined {
    return id.startsWith(BOARD_CELL_PREFIX) ? parseBoardKey(id.slice(BOARD_CELL_PREFIX.length)) : undefined;
}

// Whether `id` is a board cell's, an old one included: never a tab.
export function isBoardCell(id: string): boolean {
    return id.startsWith(BOARD_CELL_PREFIX);
}

// The board cells that can exist: one for each open board.
export function boardCellIds(open: Iterable<BoardSplit>): string[] {
    return [...open].map(boardCellId);
}

// Opening a board cell on the grid on screen, right of `beside` (the chat it was opened from, or the board's own chat)
// when that is a cell here, else right of the focused cell. Nothing changes when the cell is already there. A full
// grid gives up the last cell in reading order that is neither `beside` nor the focused one, in its place; that tab
// keeps running. Focus stays where it was (a board cell is never focused), and goes to `beside` when the grid starts
// with it: a tab with no cell here starts a grid of its own, [beside | board].
export function openBoardCellIn(grid: GridState, cellId: string, beside: string | undefined): GridState {
    const s = normalizeGrid(grid);
    if (s.ids.includes(cellId)) {
        return s;
    }
    const anchor = beside != null && s.ids.includes(beside) ? beside : (s.focused ?? undefined);
    const at = anchor != null ? s.ids.indexOf(anchor) : -1;
    if (at < 0) {
        return beside != null ? { ids: [beside, cellId], focused: beside } : s;
    }
    if (s.ids.length < MAX_CELLS) {
        return { ...addCell(s, cellId, at, "right"), focused: s.focused };
    }
    const give = [...s.ids].reverse().find((id) => id !== anchor && id !== s.focused);
    if (give == null) {
        // unreachable in a grid of four (the anchor and the focused cell are at most two of them)
        return s;
    }
    const ids = s.ids.map((id) => (id === give ? cellId : id));
    // same ids order, same places: the board takes the given-up cell's square
    return normalizeGrid({ ids, focused: s.focused, places: placesOf(s) });
}

// A cell switched to another board: the new board takes the old one's square. When the new board already has a cell
// here, the old cell goes instead.
export function replaceBoardCellIn(grid: GridState, from: string, to: string): GridState {
    const s = normalizeGrid(grid);
    if (!s.ids.includes(from)) {
        return s;
    }
    if (s.ids.includes(to)) {
        return removeCell(s, from);
    }
    return normalizeGrid({ ids: s.ids.map((id) => (id === from ? to : id)), focused: s.focused, places: placesOf(s) });
}
