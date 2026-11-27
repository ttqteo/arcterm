// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The split's snap layouts, as Windows offers them on its maximize button: a few ready arrangements of the 2x2 grid,
// each a set of zones and the shares of the sashes. The agent header's layout button (gridlayoutmenu.tsx) draws them
// and the palette lists them; picking a zone puts the focused cell there and the other cells fill the rest in their
// order on screen (agentgrid.arrangeCells). A layout fits only a grid with as many cells as it has zones. Pure.

import { arrangeCells, normalizeGrid, placesOf, type CellPlacement, type GridState } from "./agentgrid";
import type { GridSizes } from "./gridsplit";

export type GridLayoutId = "1-1" | "7-3" | "3-7" | "1-2" | "2x2";

export interface GridLayout {
    id: GridLayoutId;
    label: string; // the palette's row and the thumbnail's title
    places: readonly CellPlacement[]; // the zones, in reading order
    sizes: Partial<GridSizes>; // the shares it sets; an axis it leaves out stays as it is
}

const LEFT: CellPlacement = { row: 1, col: 1, rowSpan: 2, colSpan: 1 };
const RIGHT: CellPlacement = { row: 1, col: 2, rowSpan: 2, colSpan: 1 };

export const GRID_LAYOUTS: readonly GridLayout[] = [
    { id: "1-1", label: "Layout: 1 | 1", places: [LEFT, RIGHT], sizes: { col: 0.5 } },
    { id: "7-3", label: "Layout: 7 | 3", places: [LEFT, RIGHT], sizes: { col: 0.7 } },
    { id: "3-7", label: "Layout: 3 | 7", places: [LEFT, RIGHT], sizes: { col: 0.3 } },
    {
        id: "1-2",
        label: "Layout: 1 | 2 stacked",
        places: [LEFT, { row: 1, col: 2, rowSpan: 1, colSpan: 1 }, { row: 2, col: 2, rowSpan: 1, colSpan: 1 }],
        sizes: { col: 0.5, row: 0.5 },
    },
    {
        id: "2x2",
        label: "Layout: 2 × 2",
        places: [
            { row: 1, col: 1, rowSpan: 1, colSpan: 1 },
            { row: 1, col: 2, rowSpan: 1, colSpan: 1 },
            { row: 2, col: 1, rowSpan: 1, colSpan: 1 },
            { row: 2, col: 2, rowSpan: 1, colSpan: 1 },
        ],
        sizes: { col: 0.5, row: 0.5 },
    },
];

export function gridLayout(id: GridLayoutId): GridLayout {
    return GRID_LAYOUTS.find((l) => l.id === id)!;
}

// Whether a layout can take a grid of `count` cells: one zone per cell.
export function layoutFits(layout: GridLayout, count: number): boolean {
    return layout.places.length === count;
}

// The grid after picking `zone` of `layout` for the focused cell; the grid as it was when the layout does not fit.
export function layoutGrid(grid: GridState, layout: GridLayout, zone: number): GridState {
    const s = normalizeGrid(grid);
    if (s.focused == null || !layoutFits(layout, s.ids.length)) {
        return s;
    }
    return arrangeCells(s, layout.places, s.focused, zone);
}

// The cell each zone would hold after picking `zone`, in the layout's zone order: the thumbnail's labels while the
// pointer is over a zone. Empty when the layout does not fit.
export function zoneCells(grid: GridState, layout: GridLayout, zone: number): string[] {
    const s = normalizeGrid(grid);
    if (!layoutFits(layout, s.ids.length)) {
        return [];
    }
    // arrangeCells keeps reading order, and a layout lists its zones in reading order: ids[i] sits in zone i
    return layoutGrid(s, layout, zone).ids;
}

// The shares after a layout, the axes it leaves out kept.
export function layoutSizes(now: GridSizes, layout: GridLayout): GridSizes {
    return { ...now, ...layout.sizes };
}

const samePlace = (a: CellPlacement, b: CellPlacement) =>
    a.row === b.row && a.col === b.col && a.rowSpan === b.rowSpan && a.colSpan === b.colSpan;

// Whether the grid is laid out as `layout` now: the same zones and its shares (within half a percent), so the thumbnail
// shows as the current one. A sash dragged since reads as none.
export function isLayout(grid: GridState, sizes: GridSizes, layout: GridLayout): boolean {
    const s = normalizeGrid(grid);
    if (!layoutFits(layout, s.ids.length)) {
        return false;
    }
    const places = placesOf(s);
    if (!layout.places.every((p, i) => samePlace(p, places[i]))) {
        return false;
    }
    return (Object.keys(layout.sizes) as (keyof GridSizes)[]).every(
        (axis) => Math.abs(sizes[axis] - layout.sizes[axis]!) < 0.005
    );
}
