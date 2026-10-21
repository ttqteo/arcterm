// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The Agent surface's grids, one per project, persisted (localStorage "agent.grids", the atomWithStorage convention
// of railstore.ts and projectfoldstore.ts), and the operations the drop overlay, the cell bars and the menus run. The
// rules are in agentgrid.ts; this file only reads and writes atoms.
//
// getOnInit is load-bearing: without it the stored value arrives one render after the
// first read and the surface would paint, and reconcile against, an empty grid first.

import { globalStore } from "@/app/store/jotaiStore";
import { atom, type Atom, type PrimitiveAtom } from "jotai";
import { atomWithStorage } from "jotai/utils";
import { showTerminal } from "./agentcenter";
import {
    addCell,
    collapseToFocused,
    EMPTY_PROJECT_GRIDS,
    MAX_CELLS,
    parseProjectGrids,
    reconcileProjectGrids,
    removeCell,
    shownGrid,
    withShownGrid,
    type DropZone,
    type GridState,
    type ProjectGrids,
} from "./agentgrid";
import { HOME_PROJECT } from "./agentsidebarmodel";
import { projectOf, type AgentVM } from "./agentsviewmodel";

// The cast is the one the other getOnInit atoms carry (railstore.ts railVisibleAtom): with `undefined` for the
// storage argument jotai 2.9.3 resolves the async overload, which would type the atom as a promise. The single grid
// every project shared was stored under "agent.grid"; it is not read, so a split saved before goes once.
const storedGridsAtom = atomWithStorage<unknown>("agent.grids", EMPTY_PROJECT_GRIDS, undefined, {
    getOnInit: true,
}) as PrimitiveAtom<unknown>;

// Read through parseProjectGrids so whatever is in storage (a hand edit, an older shape) is repaired, not trusted.
export const projectGridsAtom = atom(
    (get) => parseProjectGrids(get(storedGridsAtom)),
    (_get, set, next: ProjectGrids) => set(storedGridsAtom, next)
);

// The grid on screen: the shown project's. Written, it replaces that project's grid (Home's while none is shown).
export const agentGridAtom = atom(
    (get) => shownGrid(get(projectGridsAtom)),
    (get, set, next: GridState) => set(projectGridsAtom, withShownGrid(get(projectGridsAtom), next, HOME_PROJECT))
);

export type GridTab = { id: string; blockId?: string } & Partial<Pick<AgentVM, "project" | "transcriptPath">>;

// What the operations need of AgentsViewModel; spelled out so they can be tested without one.
export interface GridModel {
    focusIdAtom: PrimitiveAtom<string | undefined>;
    agentsAtom: Atom<ReadonlyArray<GridTab>>;
    terminalsAtom: Atom<ReadonlyArray<GridTab>>;
}

// The tabs that can be cells: agents and plain terminals that have a terminal (pass both rosters, agents first). The
// one place that rule lives (the surface and the tree reuse it).
export function eligibleIds(roster: ReadonlyArray<{ id: string; blockId?: string }>): Set<string> {
    return new Set(roster.filter((a) => a.blockId != null).map((a) => a.id));
}

// Each tab's project, whose grid it can be a cell of: the sidebar folder it sits in, Home for one that names none.
export function gridProjects(roster: ReadonlyArray<GridTab>): Map<string, string> {
    return new Map(roster.map((a) => [a.id, projectOf(a as AgentVM) || HOME_PROJECT]));
}

function roster(model: GridModel): GridTab[] {
    return [...globalStore.get(model.agentsAtom), ...globalStore.get(model.terminalsAtom)];
}

// Every project's grid as the surface would show it right now: pruned against the live roster (agents and
// terminals), the focused tab's project's shown, with the tab in focus applied. Operations start from this, never
// from the raw stored value. `seeded: true` assumes the operations run on a fully loaded roster, which holds: they
// are user actions on rows and cells that are already on screen. Before the roster is seeded they would prune the
// cells whose agents have not arrived yet (the surface itself passes the real flag and waits).
function currentGrids(model: GridModel): ProjectGrids {
    const tabs = roster(model);
    return reconcileProjectGrids(globalStore.get(projectGridsAtom), {
        focusId: globalStore.get(model.focusIdAtom),
        eligible: eligibleIds(tabs),
        projectOf: gridProjects(tabs),
        seeded: true,
    });
}

// The grid on screen as currentGrids has it.
export function currentGrid(model: GridModel): GridState {
    return shownGrid(currentGrids(model));
}

// The grids the sidebar draws its split rows from, as the surface reconciles them: the docked terminal is no cell.
// Takes the values rather than the atoms so the tree (hooks) and activeNavOrder (globalStore) read it alike.
export function treeSplits(
    grids: ProjectGrids,
    input: {
        focusId: string | undefined;
        agents: ReadonlyArray<GridTab>;
        terminals: ReadonlyArray<GridTab>;
        dockedId: string | null | undefined;
        seeded: boolean;
    }
): ProjectGrids {
    const tabs = [...input.agents, ...input.terminals];
    return reconcileProjectGrids(grids, {
        focusId: input.focusId,
        eligible: eligibleIds([...input.agents, ...input.terminals.filter((t) => t.id !== input.dockedId)]),
        projectOf: gridProjects(tabs),
        seeded: input.seeded,
    });
}

// The project whose split (2+ cells) `id` is a cell of, shown or not.
function splitProject(grids: ProjectGrids, id: string): string | undefined {
    return Object.keys(grids.grids).find((p) => grids.grids[p].ids.length > 1 && grids.grids[p].ids.includes(id));
}

// `next` as `project`'s grid when that project is not the one shown: focus and the centre stay as they are.
function commitHidden(grids: ProjectGrids, project: string, next: GridState): void {
    const all = { ...grids.grids };
    if (next.ids.length > 0) {
        all[project] = next;
    } else {
        delete all[project];
    }
    globalStore.set(projectGridsAtom, { project: grids.project, grids: all });
}

// Whether `id` can be a cell of the grid on screen: it is live and of the shown project. Another project's tab is
// chosen instead, which shows its own project's grid.
function fitsShownGrid(model: GridModel, id: string): boolean {
    const tabs = roster(model);
    if (!eligibleIds(tabs).has(id)) {
        return false;
    }
    const project = currentGrids(model).project;
    return project == null || gridProjects(tabs).get(id) === project;
}

// Focus first, then the grid: a reader that sees the grid change while focusIdAtom still names the old focused
// agent would read that agent as "not in the grid" and put it back in a cell. Within one JS turn only a
// synchronous store subscriber could observe the gap, so this order costs nothing and is simply the safe one.
// Choosing an agent also puts the terminal back over History or a transcript (showTerminal), as every route that
// writes focusIdAtom does. `next` is the shown project's grid; the other projects' stay as they are.
function commit(model: GridModel, next: GridState): void {
    const grids = currentGrids(model);
    if (next.focused != null) {
        globalStore.set(model.focusIdAtom, next.focused);
        showTerminal();
    }
    globalStore.set(projectGridsAtom, withShownGrid(grids, next, HOME_PROJECT));
}

// A drop on the cell at `targetIndex` of the current grid (drop overlay): an index into the grid as currentGrid
// sees it, which is the grid the surface draws. The dropped agent is focused. Another project's tab is not dropped:
// a split holds one project's tabs.
export function dropAgentOnGrid(model: GridModel, id: string, targetIndex: number, zone: DropZone): void {
    if (!fitsShownGrid(model, id)) {
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

// Whether `id` is a cell of a split of any project's (a grid of one cell is no split): its row's menu then offers
// Remove from split and End split where it would offer Open in split.
export function isInSplit(model: GridModel, id: string): boolean {
    return splitProject(currentGrids(model), id) != null;
}

// "End split" (a split cell's row menu): the other cells go and the focused agent fills the area. Their agents keep
// running. A grid that is not split is left alone, so the call does not reach for the centre either.
export function endSplit(model: GridModel): void {
    const s = currentGrid(model);
    if (s.ids.length < 2) {
        return;
    }
    commit(model, collapseToFocused(s));
}

// Remove from split, for a cell of any project's split (its row in the sidebar's split row, its menu): on the split on
// screen it is removeFromGrid; on another project's it changes that grid only.
export function removeFromSplit(model: GridModel, id: string): void {
    const grids = currentGrids(model);
    const project = splitProject(grids, id);
    if (project == null) {
        return;
    }
    if (project === grids.project) {
        removeFromGrid(model, id);
        return;
    }
    commitHidden(grids, project, removeCell(grids.grids[project], id));
}

// End split, for the split `id` is a cell of: that project's grid keeps only its focused cell.
export function endSplitOf(model: GridModel, id: string): void {
    const grids = currentGrids(model);
    const project = splitProject(grids, id);
    if (project == null) {
        return;
    }
    if (project === grids.project) {
        endSplit(model);
        return;
    }
    commitHidden(grids, project, collapseToFocused(grids.grids[project]));
}

export function canOpenInSplit(model: GridModel, id: string): boolean {
    if (!fitsShownGrid(model, id)) {
        return false;
    }
    const s = currentGrid(model);
    return !s.ids.includes(id) && s.ids.length < MAX_CELLS;
}

// "Open in split": the agent becomes a new cell right after the focused one. False when it cannot (it already
// has a cell, the grid is full, it is not live, it is another project's); the caller then falls back to plain focus,
// which for another project's tab shows that project's grid.
export function openInSplit(model: GridModel, id: string): boolean {
    if (!canOpenInSplit(model, id)) {
        return false;
    }
    const s = currentGrid(model);
    const at = s.focused == null ? 0 : s.ids.indexOf(s.focused);
    commit(model, addCell(s, id, at, "right"));
    return true;
}
