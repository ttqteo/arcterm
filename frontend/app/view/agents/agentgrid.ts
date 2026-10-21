// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The Agent surface's terminal grid as pure data: which live agents hold the (at most four) cells, where each sits
// in a fixed 2x2 template, and which cell is focused. No React and no atoms: gridstore.ts persists it,
// agentsurface.tsx draws it, and every rule that drag and drop, the sidebar and the keyboard share lives here so it
// can be tested.
//
// A cell's place is its own (`places`), not a function of the count: an edge drop splits the target cell in two along
// that edge (the bottom edge stacks the new cell under it, the right edge puts it beside), and a cell that leaves is
// filled by a neighbour sharing a whole side with it. A grid whose cells sit as placementFor has them (1 fills the
// area, 2 side by side, 3 two on top and one spanning the bottom, 4 a 2x2) stores no places. The cells are kept in
// reading order (row, then column), so the list order is the order on screen.
//
// Every function that returns a GridState returns a normalized one (normalizeGrid): ids are unique, non-empty
// and at most MAX_CELLS, `places`, when present, tiles the 2x2 exactly with one place per id, and `focused` is one of
// the ids, or null exactly when there are none. So a stale or hand-edited stored value cannot break a caller.
// Nothing here mutates its input.

export const MAX_CELLS = 4;

export type DropZone = "center" | "left" | "right" | "top" | "bottom";

// A cell's place in the fixed 2x2 template; rows and columns count from 1, spans from 1.
export interface CellPlacement {
    row: number;
    col: number;
    rowSpan: number;
    colSpan: number;
}

export interface GridState {
    ids: string[];
    focused: string | null;
    places?: CellPlacement[]; // one per id, in the same order; left out when the cells sit as placementFor has them
}

export const EMPTY_GRID: GridState = { ids: [], focused: null };

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

// The default placement of each cell for a grid of `count` cells, in reading order. Clamped to 0..4.
export function placementFor(count: number): CellPlacement[] {
    const n = Number.isNaN(count) ? 0 : Math.min(MAX_CELLS, Math.max(0, Math.trunc(count)));
    return PLACEMENTS[n].map((p) => ({ ...p }));
}

const isSpan = (n: unknown): n is 1 | 2 => n === 1 || n === 2;

// Whether `places` covers each of the template's four squares exactly once, with `count` places.
function tiles(places: readonly CellPlacement[], count: number): boolean {
    if (places.length !== count || count === 0) {
        return false;
    }
    const taken = new Set<number>();
    for (const p of places) {
        if (![p.row, p.col, p.rowSpan, p.colSpan].every(isSpan) || p.row + p.rowSpan > 3 || p.col + p.colSpan > 3) {
            return false;
        }
        for (let r = p.row; r < p.row + p.rowSpan; r++) {
            for (let c = p.col; c < p.col + p.colSpan; c++) {
                const sq = r * 3 + c;
                if (taken.has(sq)) {
                    return false;
                }
                taken.add(sq);
            }
        }
    }
    return taken.size === 4;
}

const samePlace = (a: CellPlacement, b: CellPlacement) =>
    a.row === b.row && a.col === b.col && a.rowSpan === b.rowSpan && a.colSpan === b.colSpan;

// Each cell's place: the stored ones, or the default for the count.
export function placesOf(state: GridState): CellPlacement[] {
    return state.places != null && tiles(state.places, state.ids.length)
        ? state.places.map((p) => ({ ...p }))
        : placementFor(state.ids.length);
}

// A grid from ids and their places: put in reading order, the places dropped when they are the default (or do not
// tile, which falls back to the default too). `ids` is already deduplicated and capped.
function withPlaces(
    ids: readonly string[],
    focused: string | null,
    places: readonly CellPlacement[] | undefined
): GridState {
    if (places == null || !tiles(places, ids.length)) {
        return { ids: [...ids], focused };
    }
    const order = ids
        .map((id, i) => ({ id, p: { ...places[i] } }))
        .sort((a, b) => a.p.row - b.p.row || a.p.col - b.p.col);
    const sorted = order.map((o) => o.id);
    const def = placementFor(ids.length);
    if (order.every((o, i) => samePlace(o.p, def[i]))) {
        return { ids: sorted, focused };
    }
    return { ids: sorted, focused, places: order.map((o) => o.p) };
}

export function normalizeGrid(state: GridState): GridState {
    const ids: string[] = [];
    for (const id of state.ids) {
        if (typeof id === "string" && id !== "" && !ids.includes(id) && ids.length < MAX_CELLS) {
            ids.push(id);
        }
    }
    const focused = state.focused != null && ids.includes(state.focused) ? state.focused : (ids[0] ?? null);
    // places follow the ids one to one, so a list that lost an id has lost which place was whose
    return withPlaces(ids, focused, ids.length === state.ids.length ? state.places : undefined);
}

function parsePlace(raw: unknown): CellPlacement | null {
    if (raw == null || typeof raw !== "object") {
        return null;
    }
    const r = raw as Record<string, unknown>;
    const p = { row: r.row, col: r.col, rowSpan: r.rowSpan, colSpan: r.colSpan };
    return Object.values(p).every(isSpan) ? (p as CellPlacement) : null;
}

// What localStorage hands back: anything. Only string ids survive, and places only when every one reads.
export function parseGrid(raw: unknown): GridState {
    if (raw == null || typeof raw !== "object") {
        return { ids: [], focused: null };
    }
    const r = raw as { ids?: unknown; focused?: unknown; places?: unknown };
    const allIds = Array.isArray(r.ids) ? r.ids : [];
    const ids = allIds.filter((x): x is string => typeof x === "string");
    const places = Array.isArray(r.places) && ids.length === allIds.length ? r.places.map(parsePlace) : null;
    return normalizeGrid({
        ids,
        focused: typeof r.focused === "string" ? r.focused : null,
        places: places != null && places.every((p) => p != null) ? (places as CellPlacement[]) : undefined,
    });
}

export function gridEquals(a: GridState, b: GridState): boolean {
    if (a.focused !== b.focused || a.ids.length !== b.ids.length || !a.ids.every((id, i) => id === b.ids[i])) {
        return false;
    }
    const pa = placesOf(a);
    const pb = placesOf(b);
    return pa.every((p, i) => samePlace(p, pb[i]));
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

// A target index pinned to 0..length-1: a fraction is truncated, +/-Infinity pin to the ends, NaN reads as 0.
function clampIndex(i: number, length: number): number {
    return Number.isNaN(i) ? 0 : Math.min(length - 1, Math.max(0, Math.trunc(i)));
}

// Swaps two cells by index: the agents trade places, the places stay. Focus stays on the same agent, wherever it lands.
export function swapCells(state: GridState, a: number, b: number): GridState {
    const s = normalizeGrid(state);
    const valid = (i: number) => Number.isInteger(i) && i >= 0 && i < s.ids.length;
    if (!valid(a) || !valid(b) || a === b) {
        return s;
    }
    const ids = [...s.ids];
    [ids[a], ids[b]] = [ids[b], ids[a]];
    return withPlaces(ids, s.focused, placesOf(s));
}

// The places once the cell at `i` leaves: a neighbour sharing a whole side with it grows over it (one beside it in
// the same row first); when none does, it spanned the whole height or width and the cells beside it each grow across.
function placesWithout(places: readonly CellPlacement[], i: number): CellPlacement[] {
    const p = places[i];
    const rest = places.filter((_, j) => j !== i).map((q) => ({ ...q }));
    const beside = rest.find(
        (q) =>
            q.row === p.row && q.rowSpan === p.rowSpan && (q.col + q.colSpan === p.col || p.col + p.colSpan === q.col)
    );
    if (beside != null) {
        beside.col = Math.min(beside.col, p.col);
        beside.colSpan += p.colSpan;
        return rest;
    }
    const over = rest.find(
        (q) =>
            q.col === p.col && q.colSpan === p.colSpan && (q.row + q.rowSpan === p.row || p.row + p.rowSpan === q.row)
    );
    if (over != null) {
        over.row = Math.min(over.row, p.row);
        over.rowSpan += p.rowSpan;
        return rest;
    }
    for (const q of rest) {
        if (p.rowSpan === 2) {
            q.col = 1;
            q.colSpan = 2;
        } else {
            q.row = 1;
            q.rowSpan = 2;
        }
    }
    return rest;
}

// Drops every cell in `gone` (their agents keep running; they just have no cell), its neighbours filling the space.
function removeIds(s: GridState, gone: (id: string) => boolean): GridState {
    let ids = [...s.ids];
    let places = placesOf(s);
    for (let i = ids.length - 1; i >= 0; i--) {
        if (gone(ids[i])) {
            places = placesWithout(places, i);
            ids = ids.filter((_, j) => j !== i);
        }
    }
    return withPlaces(ids, refocus(s.ids, s.focused, ids), places);
}

// Drops a cell from the grid (the agent keeps running; it just has no cell).
export function removeCell(state: GridState, id: string): GridState {
    const s = normalizeGrid(state);
    if (!s.ids.includes(id)) {
        return s;
    }
    return removeIds(s, (x) => x === id);
}

// Drops every cell whose agent is not live any more.
export function pruneMissing(state: GridState, existing: Iterable<string>): GridState {
    const s = normalizeGrid(state);
    const live = new Set(existing);
    return s.ids.every((id) => live.has(id)) ? s : removeIds(s, (id) => !live.has(id));
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
    return withPlaces(ids, id, placesOf(s));
}

// The one rule for "this agent was selected" (a sidebar click, Ctrl+Tab, an arrow, the palette): if it already
// has a cell, focus that cell; otherwise it replaces the focused cell and the other cells stay put.
export function focusAgent(state: GridState, id: string): GridState {
    const s = normalizeGrid(state);
    if (id === "") {
        return s;
    }
    if (s.ids.includes(id)) {
        return s.focused === id ? s : { ...s, focused: id };
    }
    return replaceFocused(s, id);
}

// The two halves of `p` split along an edge zone, the zone's own half first; null when `p` is one square wide (left,
// right) or tall (top, bottom) and has nothing to split.
function splitPlace(p: CellPlacement, zone: DropZone): [CellPlacement, CellPlacement] | null {
    if (zone === "left" || zone === "right") {
        if (p.colSpan !== 2) {
            return null;
        }
        const left = { ...p, col: 1, colSpan: 1 };
        const right = { ...p, col: 2, colSpan: 1 };
        return zone === "left" ? [left, right] : [right, left];
    }
    if (zone === "top" || zone === "bottom") {
        if (p.rowSpan !== 2) {
            return null;
        }
        const top = { ...p, row: 1, rowSpan: 1 };
        const bottom = { ...p, row: 2, rowSpan: 1 };
        return zone === "top" ? [top, bottom] : [bottom, top];
    }
    return null;
}

// The edge zones the cell at `index` can be split along: left and right when it is two squares wide, top and bottom
// when it is two tall. A full grid splits nothing.
export function splitZones(state: GridState, index: number): DropZone[] {
    const s = normalizeGrid(state);
    const p = placesOf(s)[index];
    if (p == null || s.ids.length >= MAX_CELLS) {
        return [];
    }
    const zones: DropZone[] = [];
    if (p.colSpan === 2) {
        zones.push("left", "right");
    }
    if (p.rowSpan === 2) {
        zones.push("top", "bottom");
    }
    return zones;
}

const ACROSS: Record<DropZone, DropZone> = {
    left: "top",
    right: "bottom",
    top: "left",
    bottom: "right",
    center: "center",
};

// A new cell for `id` (not in `s`, which has room) split off the cell at `t` along `zone`. A cell too narrow for that
// edge is split along the other axis instead (right becomes bottom), and when the target cannot split at all (a
// one-square cell) the first cell that can gives up its second half: the agent always gets a cell, never replaces one.
function splitOff(s: GridState, id: string, t: number, zone: DropZone): GridState {
    const places = placesOf(s);
    const tries: [number, DropZone][] = [
        [t, zone],
        [t, ACROSS[zone]],
        ...places.map((p, i): [number, DropZone] => [i, p.colSpan === 2 ? "right" : "bottom"]),
    ];
    for (const [i, z] of tries) {
        const halves = splitPlace(places[i], z);
        if (halves != null) {
            const next = [...places];
            next[i] = halves[1];
            return withPlaces([...s.ids, id], id, [...next, halves[0]]);
        }
    }
    // unreachable while the grid has room: a tiling of fewer than four cells always has a two-square one
    const ids = [...s.ids];
    ids[t] = id;
    return withPlaces(ids, id, places);
}

// An agent already in the grid is moved: centre swaps it with the target; an edge zone takes it out (its neighbours
// fill its space) and splits it off the target along that edge. `t` is the target's index in the list as it was.
function moveCell(s: GridState, id: string, t: number, zone: DropZone): GridState {
    const from = s.ids.indexOf(id);
    if (from === t) {
        return { ...s, focused: id };
    }
    if (zone === "center") {
        return { ...swapCells(s, from, t), focused: id };
    }
    const target = s.ids[t];
    const rest = removeCell(s, id);
    return splitOff(rest, id, rest.ids.indexOf(target), zone);
}

// A drop of `id` on the cell at `targetIndex`. A new agent: centre replaces the target (which leaves the grid), an
// edge splits the target in two along that edge, the agent taking that edge's half (splitOff); on a full grid there is
// no room, so an edge acts as the centre. An agent already in the grid is moved (moveCell). The dropped agent becomes
// the focused cell.
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
    if (zone === "center" || s.ids.length >= MAX_CELLS) {
        const ids = [...s.ids];
        ids[t] = id;
        return withPlaces(ids, id, placesOf(s));
    }
    return splitOff(s, id, t, zone);
}

// The grid as one cell, which is what fullscreen shows. The other centre modes (History and the like) hide the
// grid rather than collapse it, so they do not come through here.
export function collapseToFocused(state: GridState): GridState {
    const s = normalizeGrid(state);
    return s.focused == null ? s : { ids: [s.focused], focused: s.focused };
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
    if (!opts.focusId) {
        return [];
    }
    const s = normalizeGrid(state);
    const shown: GridState = s.ids.includes(opts.focusId)
        ? { ...s, focused: opts.focusId }
        : { ids: [opts.focusId], focused: opts.focusId };
    const cells = opts.collapsed ? collapseToFocused(shown) : shown;
    const spots = placesOf(cells);
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
// grid's focused cell if it is live, else the first live cell in list order. That is not the neighbour that
// pruneMissing/removeCell hand focus to (the survivor that slides into the old slot). Once the roster is complete
// pass the pruned grid (pruneMissing first), whose focused cell is already live, so this returns the same agent
// the prune chose; on a raw grid it deliberately falls to the first live cell.
export function gridFallbackFocus(state: GridState, eligible: ReadonlySet<string>): string | undefined {
    const s = normalizeGrid(state);
    const order = s.focused == null ? s.ids : [s.focused, ...s.ids.filter((id) => id !== s.focused)];
    return order.find((id) => eligible.has(id));
}

// True while the roster is still loading and the saved focused cell has not arrived: resuming on the roster's first
// agent now would have the focus rule swap it into a saved cell once the roster is complete, and resuming on another
// saved cell would make that the focused agent, which the focused cell arriving after it cannot take back. A grid
// with cells always has a focused one (normalizeGrid).
export function gridHold(state: GridState, eligible: ReadonlySet<string>, seeded: boolean): boolean {
    const s = normalizeGrid(state);
    return !seeded && s.focused != null && !eligible.has(s.focused);
}

// Each project keeps a grid of its own: a split holds one project's agents and terminals, and choosing a tab of
// another project shows that project's grid, the first one staying as it was for when its project comes back.
// `project` is whose grid is shown; a project with no cells has no entry. Every function here returns a normalized
// value, as the GridState ones do.
export interface ProjectGrids {
    project: string | null;
    grids: Readonly<Record<string, GridState>>;
}

export const EMPTY_PROJECT_GRIDS: ProjectGrids = { project: null, grids: {} };

// What localStorage hands back: anything. Each grid is repaired (parseGrid), and one with no cells dropped.
export function parseProjectGrids(raw: unknown): ProjectGrids {
    if (raw == null || typeof raw !== "object") {
        return { project: null, grids: {} };
    }
    const r = raw as { project?: unknown; grids?: unknown };
    const grids: Record<string, GridState> = {};
    if (r.grids != null && typeof r.grids === "object" && !Array.isArray(r.grids)) {
        for (const [project, value] of Object.entries(r.grids)) {
            const grid = parseGrid(value);
            if (grid.ids.length > 0) {
                grids[project] = grid;
            }
        }
    }
    return { project: typeof r.project === "string" ? r.project : null, grids };
}

export function shownGrid(state: ProjectGrids): GridState {
    return state.project != null && state.grids[state.project] != null
        ? normalizeGrid(state.grids[state.project])
        : { ids: [], focused: null };
}

// `next` as the shown project's grid, the others left as they are. With no project shown yet it is filed under
// `fallback` (the project of a tab that names none), which becomes the shown one.
export function withShownGrid(state: ProjectGrids, next: GridState, fallback?: string): ProjectGrids {
    const project = state.project ?? fallback ?? null;
    if (project == null) {
        return state;
    }
    const grids = { ...state.grids };
    const grid = normalizeGrid(next);
    if (grid.ids.length > 0) {
        grids[project] = grid;
    } else {
        delete grids[project];
    }
    return { project, grids };
}

export function projectGridsEquals(a: ProjectGrids, b: ProjectGrids): boolean {
    const keys = Object.keys(a.grids);
    return (
        a.project === b.project &&
        keys.length === Object.keys(b.grids).length &&
        keys.every((k) => b.grids[k] != null && gridEquals(a.grids[k], b.grids[k]))
    );
}

export interface ProjectReconcileInput extends ReconcileInput {
    projectOf: ReadonlyMap<string, string>; // each tab's project, as the sidebar's folders file it
}

// reconcileGrid for every project: the focused tab's project's grid is shown and follows the focus, each grid keeps
// only the live tabs of its own project, and a grid left with no cells goes. A focus that is no cell (an ended worker, a
// tab with no terminal) keeps the shown project. Nothing changes until the roster has been read, as in reconcileGrid.
export function reconcileProjectGrids(state: ProjectGrids, input: ProjectReconcileInput): ProjectGrids {
    const s = parseProjectGrids(state);
    if (!input.seeded) {
        return s;
    }
    const focusProject =
        input.focusId != null && input.eligible.has(input.focusId) ? input.projectOf.get(input.focusId) : undefined;
    const project = focusProject ?? s.project;
    const grids: Record<string, GridState> = {};
    const projects = new Set(Object.keys(s.grids));
    if (project != null) {
        projects.add(project);
    }
    for (const p of projects) {
        const mine = new Set([...input.eligible].filter((id) => input.projectOf.get(id) === p));
        const grid = s.grids[p] ?? EMPTY_GRID;
        const next =
            p === project
                ? reconcileGrid(grid, { focusId: input.focusId, eligible: mine, seeded: true })
                : pruneMissing(grid, mine);
        if (next.ids.length > 0) {
            grids[p] = next;
        }
    }
    return { project, grids };
}
