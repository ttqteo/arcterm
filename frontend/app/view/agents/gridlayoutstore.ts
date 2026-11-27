// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Picking a snap layout (gridlayouts.ts) for the split on screen: the cells move to its zones (gridstore.relayoutGrid)
// and the sashes take its shares (gridsash.gridSizesAtom), clamped as a drag would be. The header's layout menu and the
// palette's Layout rows both come here.

import { globalStore } from "@/app/store/jotaiStore";
import { swapCells } from "./agentgrid";
import { gridLayout, layoutFits, layoutGrid, layoutSizes, type GridLayoutId } from "./gridlayouts";
import { gridSizesAtom, sizesOf } from "./gridsash";
import { clampShare, type GridSizes } from "./gridsplit";
import { agentGridAtom, currentGrid, projectGridsAtom, relayoutGrid, type GridModel } from "./gridstore";

// The grid's width and height, read off the stack (agentsurface.tsx data-agent-grid), for the clamp the sash applies;
// 0 (no clamp by pixels) when it is not on screen.
function gridSpan(): { col: number; row: number } {
    const el = globalThis.document?.querySelector<HTMLElement>("[data-agent-grid]");
    const r = el?.getBoundingClientRect();
    return { col: r?.width ?? 0, row: r?.height ?? 0 };
}

// Whether a layout can take the split on screen, cheaply: the shown grid as stored, with the agent in focus a cell of
// it. Bindings' `when` (the palette, the footer) run this on every read, so it skips the roster reconcile that
// applyGridLayout does; a stored cell whose tab has gone makes applyGridLayout a no-op, never a wrong layout.
function shownCount(model: GridModel): number {
    const grid = globalStore.get(agentGridAtom);
    const focus = globalStore.get(model.focusIdAtom);
    return focus != null && grid.ids.includes(focus) ? grid.ids.length : 0;
}

export function canApplyLayout(model: GridModel, id: GridLayoutId): boolean {
    const n = shownCount(model);
    return n > 1 && layoutFits(gridLayout(id), n);
}

// Lays the split out as `id`, the focused cell in `zone`. With no zone (the palette) the focused cell keeps its place
// in the reading order, so a ratio row changes only the shares.
export function applyGridLayout(model: GridModel, id: GridLayoutId, zone?: number): boolean {
    const layout = gridLayout(id);
    const grid = currentGrid(model);
    if (grid.ids.length < 2 || !layoutFits(layout, grid.ids.length) || grid.focused == null) {
        return false;
    }
    const at = zone ?? Math.max(0, grid.ids.indexOf(grid.focused));
    if (!relayoutGrid(model, (g) => layoutGrid(g, layout, at))) {
        return false;
    }
    const project = globalStore.get(projectGridsAtom).project ?? "";
    const next = layoutSizes(sizesOf(globalStore.get(gridSizesAtom), project), layout);
    const span = gridSpan();
    const clamped: GridSizes = {
        col: layout.sizes.col != null ? clampShare(next.col, span.col) : next.col,
        row: layout.sizes.row != null ? clampShare(next.row, span.row) : next.row,
    };
    globalStore.set(gridSizesAtom, project, clamped);
    return true;
}

// A split of two: the cells trade places, the shares stay (so 7 | 3 keeps the wide side on the left).
export function swapGridCells(model: GridModel): boolean {
    return relayoutGrid(model, (g) => (g.ids.length === 2 ? swapCells(g, 0, 1) : g));
}

export function canSwapCells(model: GridModel): boolean {
    return shownCount(model) === 2;
}
