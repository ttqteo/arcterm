// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The Agent surface's grid, persisted (localStorage "agent.grid", the atomWithStorage convention of
// railstore.ts and projectfoldstore.ts), and the operations the drop overlay, the cell bars and the menus
// run. The rules are in agentgrid.ts; this file only reads and writes atoms.
//
// getOnInit is load-bearing: without it the stored value arrives one render after the
// first read and the surface would paint, and reconcile against, an empty grid first.

import { globalStore } from "@/app/store/jotaiStore";
import { atom, type Atom, type PrimitiveAtom } from "jotai";
import { atomWithStorage } from "jotai/utils";
import { showTerminal } from "./agentcenter";
import {
    addCell,
    EMPTY_GRID,
    MAX_CELLS,
    parseGrid,
    reconcileGrid,
    removeCell,
    type DropZone,
    type GridState,
} from "./agentgrid";

// The cast is the one the other getOnInit atoms carry (railstore.ts railVisibleAtom): with `undefined` for the
// storage argument jotai 2.9.3 resolves the async overload, which would type the atom as a promise.
const storedGridAtom = atomWithStorage<unknown>("agent.grid", EMPTY_GRID, undefined, {
    getOnInit: true,
}) as PrimitiveAtom<unknown>;

// Read through parseGrid so whatever is in storage (a hand edit, an older shape) is repaired, not trusted.
export const agentGridAtom = atom(
    (get) => parseGrid(get(storedGridAtom)),
    (_get, set, next: GridState) => set(storedGridAtom, next)
);

// What the operations need of AgentsViewModel; spelled out so they can be tested without one.
export interface GridModel {
    focusIdAtom: PrimitiveAtom<string | undefined>;
    agentsAtom: Atom<ReadonlyArray<{ id: string; blockId?: string }>>;
}

// The agents that can be cells: those with a terminal. The one place that rule lives (the surface reuses it).
export function eligibleIds(agents: ReadonlyArray<{ id: string; blockId?: string }>): Set<string> {
    return new Set(agents.filter((a) => a.blockId != null).map((a) => a.id));
}

function liveIds(model: GridModel): Set<string> {
    return eligibleIds(globalStore.get(model.agentsAtom));
}

// The grid as the surface would show it right now: the stored one pruned against the live roster, with the
// agent in focus applied. Operations start from this, never from the raw stored value.
// `seeded: true` assumes the operations run on a fully loaded roster, which holds: they are user actions on rows
// and cells that are already on screen. Before the roster is seeded they would prune the cells whose agents have
// not arrived yet (the surface itself passes the real flag to reconcileGrid and waits).
export function currentGrid(model: GridModel): GridState {
    return reconcileGrid(globalStore.get(agentGridAtom), {
        focusId: globalStore.get(model.focusIdAtom),
        eligible: liveIds(model),
        seeded: true,
    });
}

// Focus first, then the grid: a reader that sees the grid change while focusIdAtom still names the old focused
// agent would read that agent as "not in the grid" and put it back in a cell. Within one JS turn only a
// synchronous store subscriber could observe the gap, so this order costs nothing and is simply the safe one.
// Choosing an agent also puts the terminal back over History or a transcript (showTerminal), as every route that
// writes focusIdAtom does.
function commit(model: GridModel, next: GridState): void {
    if (next.focused != null) {
        globalStore.set(model.focusIdAtom, next.focused);
        showTerminal();
    }
    globalStore.set(agentGridAtom, next);
}

// A drop on the cell at `targetIndex` of the current grid (drop overlay): an index into the grid as currentGrid
// sees it, which is the grid the surface draws. The dropped agent is focused.
export function dropAgentOnGrid(model: GridModel, id: string, targetIndex: number, zone: DropZone): void {
    if (!liveIds(model).has(id)) {
        return;
    }
    commit(model, addCell(currentGrid(model), id, targetIndex, zone));
}

// The x on a cell's bar: the agent keeps running, it just has no cell. An agent with no cell is left alone, so
// the call neither moves focus nor changes what the centre shows.
export function removeFromGrid(model: GridModel, id: string): void {
    const s = currentGrid(model);
    if (!s.ids.includes(id)) {
        return;
    }
    commit(model, removeCell(s, id));
}

export function canOpenInSplit(model: GridModel, id: string): boolean {
    if (!liveIds(model).has(id)) {
        return false;
    }
    const s = currentGrid(model);
    return !s.ids.includes(id) && s.ids.length < MAX_CELLS;
}

// "Open in split": the agent becomes a new cell right after the focused one. False when it cannot (it already
// has a cell, the grid is full, it is not live); the caller then falls back to plain focus.
export function openInSplit(model: GridModel, id: string): boolean {
    if (!canOpenInSplit(model, id)) {
        return false;
    }
    const s = currentGrid(model);
    const at = s.focused == null ? 0 : s.ids.indexOf(s.focused);
    commit(model, addCell(s, id, at, "right"));
    return true;
}
