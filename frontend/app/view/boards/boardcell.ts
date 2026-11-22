// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// A board as a cell of the Agent surface's grid: the third kind of cell beside agents and terminals, id
// `board:<agentId>`, one per agent. Pure: the id encoding and the rule that adds the cell to a grid. Which board the cell
// shows is boardsplitstore.ts's entry; that a board cell lives only beside its agent is agentgrid.ts's settleCompanions
// (gridstore.ts passes boardCellAgent as `companionOf`).

import { addCell, MAX_CELLS, normalizeGrid, placesOf, type GridState } from "../agents/agentgrid";

export const BOARD_CELL_PREFIX = "board:";

export function boardCellId(agentId: string): string {
    return `${BOARD_CELL_PREFIX}${agentId}`;
}

// The agent a board cell belongs to; undefined for any id that is not a board cell (an agent or a terminal).
export function boardCellAgent(id: string): string | undefined {
    return id.startsWith(BOARD_CELL_PREFIX) && id.length > BOARD_CELL_PREFIX.length
        ? id.slice(BOARD_CELL_PREFIX.length)
        : undefined;
}

export function isBoardCell(id: string): boolean {
    return boardCellAgent(id) != null;
}

// The board cells that can exist: one for each agent that is eligible (live, has a terminal) and has a board open.
export function boardCellIds(eligibleAgents: ReadonlySet<string>, open: ReadonlySet<string>): string[] {
    return [...eligibleAgents].filter((id) => open.has(id)).map(boardCellId);
}

// Opening a board on the grid on screen: the agent's board cell goes right of the agent's cell. Nothing changes when the
// cell is already there (the cell switches board on its own). A full grid gives up the last cell in reading order that
// is neither the agent nor the focused one, in its place; that tab keeps running. The agent stays the focused cell, the
// board cell never is. An agent with no cell here starts a grid of its own, [agent | board].
export function openBoardCellIn(grid: GridState, agentId: string): GridState {
    const s = normalizeGrid(grid);
    const board = boardCellId(agentId);
    if (s.ids.includes(board)) {
        return s;
    }
    const at = s.ids.indexOf(agentId);
    if (at < 0) {
        return { ids: [agentId, board], focused: agentId };
    }
    if (s.ids.length < MAX_CELLS) {
        return { ...addCell(s, board, at, "right"), focused: agentId };
    }
    const give = [...s.ids].reverse().find((id) => id !== agentId && id !== s.focused);
    if (give == null) {
        // unreachable in a grid of four (the agent and the focused cell are at most two of them)
        return s;
    }
    const ids = s.ids.map((id) => (id === give ? board : id));
    const places = placesOf(s);
    // same ids order, same places: the board takes the given-up cell's square
    const next = normalizeGrid({ ids, focused: agentId, places });
    return next;
}
