// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// What a terminal block is, to a drop of Worktree files paths (pathdrop.ts): an agent's TUI, which takes `@path`
// mentions, or a plain shell, which takes the bare path. Pure; the lookup of the rows and their cwd is
// focus-pane.tsx's.

import type { DropTarget } from "./pathdrop";

// the part of a cockpit agent row the target is read from
export interface DropAgentRow {
    blockId?: string;
    // the agent's resolved working directory
    cwd?: string | null;
}

// An agent row with this block id makes the block an agent, and its resolved cwd the one paths are made relative to
// (null when it has none: every path stays absolute). Any other block is a plain terminal, whose cwd is its `cmd:cwd`
// meta as stored: a "~" is not expanded, so a path under the home directory stays absolute there too.
export function dropTargetFor(blockId: string, agents: readonly DropAgentRow[], blockCwd: string | null): DropTarget {
    const row = agents.find((a) => a.blockId === blockId);
    if (row != null) {
        return { agent: true, cwd: row.cwd ? row.cwd : null };
    }
    return { agent: false, cwd: blockCwd ? blockCwd : null };
}
