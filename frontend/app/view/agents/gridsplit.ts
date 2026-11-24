// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// How the split divides its room. The grid is a fixed 2x2 template (agentgrid.ts); a sash between its columns and one
// between its rows move the line between the two tracks. Each project's grid keeps its own shares (localStorage
// "agent.gridSizes", gridsash.tsx), as it keeps its own cells.

import type { CellPlacement } from "./agentgrid";

// The first column's share of the width and the first row's share of the height (the dock row aside).
export interface GridSizes {
    col: number;
    row: number;
}

export const EVEN_SIZES: GridSizes = { col: 0.5, row: 0.5 };

const MIN_SHARE = 0.15;
// a cell narrower than this cannot show its bar's name and buttons, nor a terminal of any use
export const MIN_TRACK_PX = 200;

// A share kept inside MIN_SHARE..1-MIN_SHARE, and wide enough for both tracks to keep MIN_TRACK_PX of `spanPx` (the
// two tracks together, gap left out). A span too small for both keeps them even.
export function clampShare(share: number, spanPx: number): number {
    if (!Number.isFinite(share)) {
        return 0.5;
    }
    const byPx = spanPx > 0 ? MIN_TRACK_PX / spanPx : 0;
    const lo = Math.max(MIN_SHARE, byPx);
    const hi = 1 - lo;
    if (lo >= hi) {
        return 0.5;
    }
    return Math.min(hi, Math.max(lo, share));
}

// The two tracks of a share. Flex factors that add up to 100, not 1: below a sum of 1 a grid leaves the remainder of
// the free space empty, and a share like 0.3 + 0.7 can sum to just under 1 in floating point.
export function tracks(share: number): string {
    const a = Math.round(share * 1000) / 10;
    const b = Math.round((100 - a) * 10) / 10;
    return `minmax(0, ${a}fr) minmax(0, ${b}fr)`;
}

// The share the pointer at `pos` makes: `start` is where the first track begins, `first` and `second` the two tracks'
// sizes as laid out now and `gap` the gap between them; the line is the middle of the gap.
export function shareAt(pos: number, start: number, first: number, second: number, gap: number): number {
    const span = first + second;
    if (span <= 0) {
        return 0.5;
    }
    return clampShare((pos - start - gap / 2) / span, span);
}

// Where each sash sits, as grid lines: the column sash on the left edge of column 2 across the rows where the cells
// are split left and right, the row sash on the top edge of row 2 across the columns split above and below. A grid
// with no such split has no sash for it.
export interface SashSpans {
    col: { row: number; rowSpan: number } | null;
    row: { col: number; colSpan: number } | null;
}

export function sashSpans(places: readonly CellPlacement[]): SashSpans {
    const splitRows = new Set<number>();
    const splitCols = new Set<number>();
    for (const p of places) {
        if (p.colSpan === 1) {
            for (let r = p.row; r < p.row + p.rowSpan; r++) {
                splitRows.add(r);
            }
        }
        if (p.rowSpan === 1) {
            for (let c = p.col; c < p.col + p.colSpan; c++) {
                splitCols.add(c);
            }
        }
    }
    const span = (set: Set<number>) => {
        if (set.size === 0) {
            return null;
        }
        const lo = Math.min(...set);
        return { from: lo, count: Math.max(...set) - lo + 1 };
    };
    const rows = span(splitRows);
    const cols = span(splitCols);
    return {
        col: rows != null ? { row: rows.from, rowSpan: rows.count } : null,
        row: cols != null ? { col: cols.from, colSpan: cols.count } : null,
    };
}

// What localStorage hands back: anything. Each project's entry is kept only with both shares in range.
export function parseGridSizes(raw: unknown): Record<string, GridSizes> {
    const out: Record<string, GridSizes> = {};
    if (raw == null || typeof raw !== "object" || Array.isArray(raw)) {
        return out;
    }
    const ok = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && n > 0 && n < 1;
    for (const [project, value] of Object.entries(raw)) {
        const v = value as { col?: unknown; row?: unknown } | null;
        if (v != null && ok(v.col) && ok(v.row)) {
            out[project] = { col: v.col, row: v.row };
        }
    }
    return out;
}
