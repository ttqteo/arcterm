// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The Agent surface's terminal dock as pure data: a plain terminal moved to a panel under the agent stack ("Move to the
// panel"), a place you send a terminal to, not where choosing it goes. Every route that chooses a terminal (the tree,
// the palette, an openref, Ctrl+Tab) only writes focusIdAtom and the terminal takes the centre, as an agent does;
// splitDock only keeps or empties the dock. A terminal in the dock that is chosen leaves it and takes the centre. The
// dock folds to a strip (terminalDockFoldedAtom). No React and no atoms: railstore.ts holds the state, agentsurface.tsx
// draws it.

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
    docked: string | null; // the terminal in the dock (dockedTerminalAtom), an explicit choice
    agents: T[];
    terminals: T[];
}

export interface DockSplit<T extends DockItem> {
    focused: T | undefined; // what to show in the centre (passed on to resolveShownAgent)
    docked: T | undefined; // the terminal to draw in the dock, live and with a block
    dockedId: string | null; // what dockedTerminalAtom should hold
}

export function splitDock<T extends DockItem>(input: DockSplitInput<T>): DockSplit<T> {
    const { focused, agents, terminals } = input;
    // the dock needs an agent above it, and a docked terminal that is chosen takes the centre instead
    const dockedId = agents.length === 0 || focused?.id === input.docked ? null : input.docked;
    const docked = dockedId == null ? undefined : terminals.find((t) => t.id === dockedId && t.blockId != null);
    // a terminal that closed (or lost its block) leaves the dock empty rather than pointing at nothing
    return { focused, docked, dockedId: docked != null ? dockedId : null };
}

// The agent to show above when `terminalId` moves to the panel: the agent in view before the terminal (the recent
// list, newest first, as Ctrl+Tab keeps it), else the first agent with a terminal. Undefined with no agent to dock
// under, so the terminal stays where it is.
export function dockHostId(
    recent: readonly string[],
    agents: readonly { id: string; blockId?: string }[],
    terminalId: string
): string | undefined {
    const live = new Set(agents.filter((a) => a.blockId != null).map((a) => a.id));
    return recent.find((id) => id !== terminalId && live.has(id)) ?? agents.find((a) => a.blockId != null)?.id;
}

// The latest line of a terminal's output: its last line with any text. A TUI's last line is its key bar, a shell's the
// prompt, which is what the folded strip shows. Undefined for a screen with nothing on it.
export function lastOutputLine(lines: readonly string[]): string | undefined {
    for (let i = lines.length - 1; i >= 0; i--) {
        const text = lines[i].trim();
        if (text !== "") {
            return text;
        }
    }
    return undefined;
}
