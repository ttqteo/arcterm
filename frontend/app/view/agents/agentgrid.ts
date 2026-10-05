// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The Agent surface's terminal grid as pure data: which live agents hold the (at most four) cells, in order,
// and which cell is focused. No React and no atoms: gridstore.ts persists it, agentsurface.tsx draws it, and
// every rule that drag and drop, the sidebar and the keyboard share lives here so it can be tested.
//
// The shape depends only on how many cells there are (placementFor): 1 fills the area, 2 sit side by side,
// 3 are two on top and one spanning the bottom, 4 are 2x2. A cell has no place of its own, only a position in
// the list, so adding, removing or swapping one never needs a geometry rule.
//
// Every function returns a normalized state (normalizeGrid): ids are unique, non-empty and at most MAX_CELLS,
// and `focused` is one of them, or null exactly when there are none. So a stale or hand-edited stored value
// cannot break a caller. Nothing here mutates its input.

export const MAX_CELLS = 4;

export type DropZone = "center" | "left" | "right" | "top" | "bottom";

export interface GridState {
    ids: string[];
    focused: string | null;
}

export const EMPTY_GRID: GridState = { ids: [], focused: null };

export function normalizeGrid(state: GridState): GridState {
    const ids: string[] = [];
    for (const id of state.ids) {
        if (typeof id === "string" && id !== "" && !ids.includes(id) && ids.length < MAX_CELLS) {
            ids.push(id);
        }
    }
    const focused = state.focused != null && ids.includes(state.focused) ? state.focused : (ids[0] ?? null);
    return { ids, focused };
}

// What localStorage hands back: anything. Only string ids survive.
export function parseGrid(raw: unknown): GridState {
    if (raw == null || typeof raw !== "object") {
        return { ids: [], focused: null };
    }
    const r = raw as { ids?: unknown; focused?: unknown };
    const ids = Array.isArray(r.ids) ? r.ids.filter((x): x is string => typeof x === "string") : [];
    return normalizeGrid({ ids, focused: typeof r.focused === "string" ? r.focused : null });
}

export function gridEquals(a: GridState, b: GridState): boolean {
    return a.focused === b.focused && a.ids.length === b.ids.length && a.ids.every((id, i) => id === b.ids[i]);
}

// Who is focused once some cells have left: the focused cell if it stayed, else the nearest survivor at or
// after its old position (the cell that slid into its slot), else the last one.
function refocus(oldIds: readonly string[], focused: string | null, kept: readonly string[]): string | null {
    if (kept.length === 0) {
        return null;
    }
    if (focused != null && kept.includes(focused)) {
        return focused;
    }
    const from = focused == null ? 0 : Math.max(0, oldIds.indexOf(focused));
    for (let i = from; i < oldIds.length; i++) {
        if (kept.includes(oldIds[i])) {
            return oldIds[i];
        }
    }
    return kept[kept.length - 1];
}

function clampIndex(i: number, length: number): number {
    return Number.isFinite(i) ? Math.min(length - 1, Math.max(0, Math.trunc(i))) : 0;
}

// Swaps two cells by index. Focus stays on the same agent, wherever it lands.
export function swapCells(state: GridState, a: number, b: number): GridState {
    const s = normalizeGrid(state);
    const valid = (i: number) => Number.isInteger(i) && i >= 0 && i < s.ids.length;
    if (!valid(a) || !valid(b) || a === b) {
        return s;
    }
    const ids = [...s.ids];
    [ids[a], ids[b]] = [ids[b], ids[a]];
    return { ids, focused: s.focused };
}

// Drops a cell from the grid (the agent keeps running; it just has no cell).
export function removeCell(state: GridState, id: string): GridState {
    const s = normalizeGrid(state);
    if (!s.ids.includes(id)) {
        return s;
    }
    const kept = s.ids.filter((x) => x !== id);
    return { ids: kept, focused: refocus(s.ids, s.focused, kept) };
}

// Drops every cell whose agent is not live any more.
export function pruneMissing(state: GridState, existing: Iterable<string>): GridState {
    const s = normalizeGrid(state);
    const live = new Set(existing);
    const kept = s.ids.filter((id) => live.has(id));
    return { ids: kept, focused: refocus(s.ids, s.focused, kept) };
}

// Puts `id` in the focused cell. An agent that is already another cell trades places with the focused one, so
// the list never holds it twice.
export function replaceFocused(state: GridState, id: string): GridState {
    const s = normalizeGrid(state);
    if (id === "") {
        return s;
    }
    if (s.focused == null) {
        return { ids: [id], focused: id };
    }
    if (s.focused === id) {
        return s;
    }
    const ids = [...s.ids];
    const focusedAt = ids.indexOf(s.focused);
    const at = ids.indexOf(id);
    if (at >= 0) {
        ids[at] = s.focused;
    }
    ids[focusedAt] = id;
    return { ids, focused: id };
}

// The one rule for "this agent was selected" (a sidebar click, Ctrl+Tab, an arrow, the palette): if it already
// has a cell, focus that cell; otherwise it replaces the focused cell and the other cells stay put.
export function focusAgent(state: GridState, id: string): GridState {
    const s = normalizeGrid(state);
    if (id === "") {
        return s;
    }
    if (s.ids.includes(id)) {
        return s.focused === id ? s : { ids: s.ids, focused: id };
    }
    return replaceFocused(s, id);
}

// An agent already in the grid is moved: centre swaps it with the target, an edge zone puts it before (left, top)
// or after (right, bottom) the target. `t` is the target's index in the list as it was.
function moveCell(s: GridState, id: string, t: number, zone: DropZone): GridState {
    const from = s.ids.indexOf(id);
    if (from === t) {
        return { ids: s.ids, focused: id };
    }
    if (zone === "center") {
        return { ids: swapCells(s, from, t).ids, focused: id };
    }
    const target = s.ids[t];
    const rest = s.ids.filter((x) => x !== id);
    const at = rest.indexOf(target) + (zone === "left" || zone === "top" ? 0 : 1);
    const ids = [...rest];
    ids.splice(at, 0, id);
    return { ids, focused: id };
}

// A drop of `id` on the cell at `targetIndex`. A new agent: centre replaces the target (which leaves the grid),
// left/top insert before it, right/bottom after it; on a full grid there is no room, so an edge acts as the
// centre. An agent already in the grid is moved (moveCell). The dropped agent becomes the focused cell.
export function addCell(state: GridState, id: string, targetIndex: number, zone: DropZone): GridState {
    const s = normalizeGrid(state);
    if (id === "") {
        return s;
    }
    if (s.ids.length === 0) {
        return { ids: [id], focused: id };
    }
    const t = clampIndex(targetIndex, s.ids.length);
    if (s.ids.includes(id)) {
        return moveCell(s, id, t, zone);
    }
    const ids = [...s.ids];
    if (zone === "center" || ids.length >= MAX_CELLS) {
        ids[t] = id;
    } else {
        ids.splice(zone === "left" || zone === "top" ? t : t + 1, 0, id);
    }
    return { ids, focused: id };
}

// The grid as one cell: fullscreen, History and the other modes that show a single thing.
export function collapseToFocused(state: GridState): GridState {
    const s = normalizeGrid(state);
    return s.focused == null ? s : { ids: [s.focused], focused: s.focused };
}

// A cell's place in the fixed 2x2 template; rows and columns count from 1, spans from 1.
export interface CellPlacement {
    row: number;
    col: number;
    rowSpan: number;
    colSpan: number;
}

const PLACEMENTS: readonly (readonly CellPlacement[])[] = [
    [],
    [{ row: 1, col: 1, rowSpan: 2, colSpan: 2 }],
    [
        { row: 1, col: 1, rowSpan: 2, colSpan: 1 },
        { row: 1, col: 2, rowSpan: 2, colSpan: 1 },
    ],
    [
        { row: 1, col: 1, rowSpan: 1, colSpan: 1 },
        { row: 1, col: 2, rowSpan: 1, colSpan: 1 },
        { row: 2, col: 1, rowSpan: 1, colSpan: 2 },
    ],
    [
        { row: 1, col: 1, rowSpan: 1, colSpan: 1 },
        { row: 1, col: 2, rowSpan: 1, colSpan: 1 },
        { row: 2, col: 1, rowSpan: 1, colSpan: 1 },
        { row: 2, col: 2, rowSpan: 1, colSpan: 1 },
    ],
];

// The placement of each cell for a grid of `count` cells, in order. Clamped to 0..4.
export function placementFor(count: number): CellPlacement[] {
    const n = Number.isFinite(count) ? Math.min(MAX_CELLS, Math.max(0, Math.trunc(count))) : 0;
    return PLACEMENTS[n].map((p) => ({ ...p }));
}

// The inline style a cell carries: gridRow/gridColumn with spans, over a template that never changes.
export function placementStyle(p: CellPlacement): { gridRow: string; gridColumn: string } {
    return { gridRow: `${p.row} / span ${p.rowSpan}`, gridColumn: `${p.col} / span ${p.colSpan}` };
}

export interface GridCell {
    id: string;
    placement: CellPlacement;
    focused: boolean;
}

// The cells on screen. `focusId` is the agent actually shown (it may be a terminal or something else that is
// not a cell, which is then shown alone and leaves the saved grid untouched). `collapsed` shows only the focused
// one, filling the area (fullscreen). No focus, no cells.
export function visibleCells(state: GridState, opts: { focusId: string | undefined; collapsed: boolean }): GridCell[] {
    if (opts.focusId == null) {
        return [];
    }
    const s = normalizeGrid(state);
    const shown: GridState = s.ids.includes(opts.focusId)
        ? { ids: s.ids, focused: opts.focusId }
        : { ids: [opts.focusId], focused: opts.focusId };
    const cells = opts.collapsed ? collapseToFocused(shown) : shown;
    const spots = placementFor(cells.ids.length);
    return cells.ids.map((id, i) => ({ id, placement: spots[i], focused: id === cells.focused }));
}

export interface ReconcileInput {
    focusId: string | undefined; // what the surface shows: model.focusIdAtom after its own defaulting
    eligible: ReadonlySet<string>; // live agents that have a terminal
    seeded: boolean; // the roster has been read once (rosterSeededAtom)
}

// The saved grid brought up to date with the roster and the focus. Until the roster has been read nothing is
// pruned and the focus rule is not applied: a half-loaded roster would otherwise throw away a saved layout.
// Pure and idempotent, so the surface can compute it every render and write it back only when it differs.
export function reconcileGrid(state: GridState, input: ReconcileInput): GridState {
    const s = normalizeGrid(state);
    if (!input.seeded) {
        return s;
    }
    const pruned = pruneMissing(s, input.eligible);
    return input.focusId != null && input.eligible.has(input.focusId) ? focusAgent(pruned, input.focusId) : pruned;
}

// Where focus resumes when nothing is explicitly in focus (a launch, a focused agent that just exited): the
// grid's focused cell if it is live, else the first live cell.
export function gridFallbackFocus(state: GridState, eligible: ReadonlySet<string>): string | undefined {
    const s = normalizeGrid(state);
    const order = s.focused == null ? s.ids : [s.focused, ...s.ids.filter((id) => id !== s.focused)];
    return order.find((id) => eligible.has(id));
}

// True while the roster is still loading and none of the saved cells has arrived: resuming on the roster's
// first agent now would have the focus rule swap it into a saved cell once the roster is complete.
export function gridHold(state: GridState, eligible: ReadonlySet<string>, seeded: boolean): boolean {
    const s = normalizeGrid(state);
    return !seeded && s.ids.length > 0 && !s.ids.some((id) => eligible.has(id));
}
