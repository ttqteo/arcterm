// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// What the Agent header's Split menu offers. Dragging a sidebar row onto the terminal has no mark on screen until the
// drag starts, and with one agent running there is nothing to drag, so this menu is the visible way to a second cell:
// every other live agent that is not already in the grid, and whether the grid still has room. Pure; agentheader.tsx
// builds the menu from it and gridstore.ts does the opening.

import { MAX_CELLS } from "./agentgrid";

export interface SplitAgent {
    id: string;
    name: string;
    blockId?: string;
    project?: string;
}

export interface SplitTarget {
    id: string;
    name: string;
    project?: string;
}

export interface SplitMenuState {
    targets: SplitTarget[]; // agents that can become a cell now, in roster order
    cells: number; // how many cells the grid has
    full: boolean; // no room for another
}

/** Pure: the agents a split can add (live, with a terminal, not already a cell), given the grid's cell ids. */
export function splitMenuState(
    agents: ReadonlyArray<SplitAgent>,
    cellIds: readonly string[],
    max: number = MAX_CELLS
): SplitMenuState {
    const inGrid = new Set(cellIds);
    return {
        targets: agents
            .filter((a) => a.blockId != null && !inGrid.has(a.id))
            .map((a) => ({ id: a.id, name: a.name, project: a.project })),
        cells: cellIds.length,
        full: cellIds.length >= max,
    };
}
