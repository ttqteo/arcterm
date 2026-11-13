// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Pure: the three number columns that end a sidebar row's second line, RAM · tokens · age, on an agent's, a lead's, a
// run's and a worker's row (docs/superpowers/specs/2026-11-13-sidebar-declutter-design.md). Each field the person keeps
// on (Settings → Appearance → Agent sidebar) holds its cell on every one of those rows, empty when the row has no figure
// for it, so the columns line up down the tree; a field turned off takes its column off every row. Every figure reads
// faint, and only the RAM cell turns to the warning colour, once it reads in GB. agenttree.tsx draws the cells.

import { fmtMem, GB_FROM_BYTES } from "@/app/cockpit/resmon";
import { formatTokens } from "./agentsviewmodel";
import type { RowFields } from "./rowfields";

export type RowColKey = "ram" | "tokens" | "age";

/** What a row's RAM cell says, and whether it says it in the warning colour. */
export interface RamReading {
    label: string;
    warn: boolean;
}

export interface RowCell {
    key: RowColKey;
    // "" for a row with no figure for it: the cell still holds its place
    text: string;
    warn: boolean;
}

/** The RAM cell's reading of `bytes`, or null for no figure. It warns from the point fmtMem writes GB (1000 MiB), so a
 *  figure reading "1.0 GB" is never left plain. */
export function ramReading(bytes: number | null): RamReading | null {
    return bytes == null ? null : { label: fmtMem(bytes), warn: bytes >= GB_FROM_BYTES };
}

/** Whether two readings say the same, so a row redraws only when its RAM cell changes, not on every snapshot. */
export function sameRamReading(a: RamReading | null, b: RamReading | null): boolean {
    return a === b || (a != null && b != null && a.label === b.label && a.warn === b.warn);
}

/** The cells a row ends its second line with, in the order RAM · tokens · age: one per field that is on, whatever the
 *  row has for it. */
export function rowCols(
    fields: Pick<RowFields, RowColKey>,
    v: { ram?: RamReading | null; tokens?: number; age?: string }
): RowCell[] {
    const cells: RowCell[] = [];
    if (fields.ram) {
        cells.push({ key: "ram", text: v.ram?.label ?? "", warn: v.ram?.warn ?? false });
    }
    if (fields.tokens) {
        cells.push({ key: "tokens", text: v.tokens ? formatTokens(v.tokens) : "", warn: false });
    }
    if (fields.age) {
        cells.push({ key: "age", text: v.age ?? "", warn: false });
    }
    return cells;
}
