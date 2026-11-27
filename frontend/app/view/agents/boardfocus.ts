// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Focus board: one press of the agent header's button gives a board split the room. The agent tree folds, the rail
// hides, and the board's track of the split takes 7 parts of 10 (chat 3 : board 7). A second press puts back the
// layout the first one found. The button shows only while the grid on screen is a board split (boardFocusTarget).

import { placesOf, type GridState } from "./agentgrid";
import type { GridSizes } from "./gridsplit";

// the board cells' id prefix (boardcell.BOARD_CELL_PREFIX), kept here so this module stays free of the board stores
const BOARD_CELL_PREFIX = "board:";

// the share of the track beside the board: chat 3 : board 7
export const BOARD_FOCUS_OTHER_SHARE = 0.3;

// The sash the focus moves and the first track's share it sets.
export interface BoardFocusTarget {
    axis: "col" | "row";
    share: number;
}

// What the button changes, as it was before the press or as the press leaves it.
export interface FocusLayout {
    treeFolded: boolean;
    railVisible: boolean;
    sizes: GridSizes;
}

// Where the focus would act on a grid: its first board cell's column when the board is beside another cell, else its
// row when the board is above or below one; null when no board shares the grid with another cell.
export function boardFocusTarget(grid: GridState): BoardFocusTarget | null {
    if (grid.ids.length < 2) {
        return null;
    }
    const places = placesOf(grid);
    const i = grid.ids.findIndex((id) => id.startsWith(BOARD_CELL_PREFIX));
    if (i < 0) {
        return null;
    }
    const p = places[i];
    const boardShare = 1 - BOARD_FOCUS_OTHER_SHARE;
    if (p.colSpan === 1) {
        return { axis: "col", share: p.col === 1 ? boardShare : BOARD_FOCUS_OTHER_SHARE };
    }
    if (p.rowSpan === 1) {
        return { axis: "row", share: p.row === 1 ? boardShare : BOARD_FOCUS_OTHER_SHARE };
    }
    return null;
}

// The layout a press leaves: the tree folded, the rail hidden, the target's share on its axis (the other axis as it was).
export function focusedLayout(before: FocusLayout, axis: BoardFocusTarget["axis"], share: number): FocusLayout {
    return { treeFolded: true, railVisible: false, sizes: { ...before.sizes, [axis]: share } };
}

// Whether the layout is the focused one: tree folded, rail hidden and the share where the press put it. A sash moved
// or the tree or rail opened by hand since then reads as not focused, so the next press focuses again.
export function isBoardFocused(now: FocusLayout, axis: BoardFocusTarget["axis"], share: number): boolean {
    return now.treeFolded && !now.railVisible && Math.abs(now.sizes[axis] - share) < 0.005;
}

// What a second press puts back: the layout the first press found, or, with none kept (the app restarted while
// focused), the defaults of each part: tree open, rail shown, the split even.
export function unfocusedLayout(
    now: FocusLayout,
    before: FocusLayout | null,
    axis: BoardFocusTarget["axis"]
): FocusLayout {
    if (before != null) {
        return before;
    }
    return { treeFolded: false, railVisible: true, sizes: { ...now.sizes, [axis]: 0.5 } };
}
