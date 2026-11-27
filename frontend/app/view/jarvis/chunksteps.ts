// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Where a chunk stands in the list the chunk view steps through (chunkview.tsx's head: `chunk n / total`, ↑/↓, and the
// j/k keys). The list is the plan: a chunk saved for later has no place in it (laterchunk.ts), a proposed chunk is not
// part of it yet, and a chunk waiting out its delete is gone. Pure, so the list logic is tested without a render.

import { isLater, planChunks } from "./laterchunk";

/** What the list is built from: a chunk's label, status and later mark. */
export interface StepRow {
    label: string;
    status: string;
    later?: boolean;
}

export interface ChunkSteps {
    /** the chunk's place in the plan from 1; 0 when it has none (a proposed or a later chunk) */
    n: number;
    /** how many chunks the plan has to step through */
    total: number;
    /** the label ↑ and k open, or null */
    prev: string | null;
    /** the label ↓ and j open, or null */
    next: string | null;
    /** the chunk is saved for later: it shows no position and steps nowhere */
    later: boolean;
}

/**
 * The plan's chunks in the server's order, and where `label` stands among them. `rows` is every chunk the server lists
 * (later ones included); `gone` says which labels wait out an undoable delete. A later chunk opened from the Later group
 * has no place in the plan: no position, no prev and no next. A proposed chunk, or a label the list does not hold,
 * steps in at the plan's first (down) or last (up) chunk.
 */
export function chunkSteps(rows: readonly StepRow[], label: string, gone: (label: string) => boolean): ChunkSteps {
    const open = rows.find((r) => r.label === label);
    if (open != null && isLater(open)) {
        return { n: 0, total: 0, prev: null, next: null, later: true };
    }
    const labels = planChunks([...rows])
        .filter((c) => c.status !== "proposed" && !gone(c.label))
        .map((c) => c.label);
    const at = labels.indexOf(label);
    const to = (delta: 1 | -1): string | null => {
        const i = at < 0 ? (delta > 0 ? 0 : labels.length - 1) : at + delta;
        return i >= 0 && i < labels.length && i !== at ? labels[i] : null;
    };
    return { n: at + 1, total: labels.length, prev: to(-1), next: to(1), later: false };
}
