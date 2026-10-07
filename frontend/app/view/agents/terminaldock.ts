// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The Agent surface's terminal dock as pure data: a plain terminal chosen while there is an agent to show opens in a
// panel under the agent stack instead of taking the centre from it. Every route that chooses a terminal (the tree, the
// palette, an openref) only writes focusIdAtom; the surface runs it through splitDock, which keeps the agent that was
// showing above and docks the terminal below, then writes focusIdAtom back to that agent. So focusIdAtom stays the one
// selected agent and no route needs to know about the dock. With no agent at all a terminal still fills the centre.
// No React and no atoms: railstore.ts holds the state, agentsurface.tsx draws it.

// the dock's height bounds: never shorter than a few lines of shell, never more than this share of the column, so the
// agent above always keeps the larger part
export const DOCK_MIN_PX = 120;
export const DOCK_MAX_FRACTION = 0.6;
export const DOCK_DEFAULT_PX = 260;

// The dock height to draw for a stored (or dragged) `px` in a column `available` px tall. Before the column is measured
// (available 0) only the floor applies. A column too short for the floor gives the dock its share and no more.
export function clampDockHeight(px: number, available: number): number {
    const want = Number.isFinite(px) ? Math.round(px) : DOCK_DEFAULT_PX;
    if (!(available > 0)) {
        return Math.max(DOCK_MIN_PX, want);
    }
    const max = Math.floor(available * DOCK_MAX_FRACTION);
    const min = Math.min(DOCK_MIN_PX, max);
    return Math.min(max, Math.max(min, want));
}

interface DockItem {
    id: string;
    kind?: string;
    blockId?: string;
}

export interface DockSplitInput<T extends DockItem> {
    focused: T | undefined; // what focusIdAtom names, if it is on the roster
    docked: string | null; // the terminal in the dock (dockedTerminalAtom)
    host: string | null; // the agent shown above before this render, which a newly chosen terminal docks under
    agents: T[];
    terminals: T[];
}

export interface DockSplit<T extends DockItem> {
    // what to show above (passed on to resolveShownAgent); undefined lets it default, which with any agent on the
    // roster is an agent
    focused: T | undefined;
    docked: T | undefined; // the terminal to draw in the dock, live and with a block
    dockedId: string | null; // what dockedTerminalAtom should hold
}

export function splitDock<T extends DockItem>(input: DockSplitInput<T>): DockSplit<T> {
    const { focused, agents, terminals } = input;
    let dockedId = input.docked;
    let shown = focused;
    if (focused?.kind === "terminal" && agents.length > 0) {
        dockedId = focused.id;
        shown = agents.find((a) => a.id === input.host);
    }
    const docked = dockedId == null ? undefined : terminals.find((t) => t.id === dockedId && t.blockId != null);
    // a terminal that closed (or lost its block) leaves the dock empty rather than pointing at nothing
    return { focused: shown, docked, dockedId: docked != null ? dockedId : null };
}
