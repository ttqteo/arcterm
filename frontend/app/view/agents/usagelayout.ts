// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// What the Usage surface leaves out. The master-detail layout earns its rail only with two or more
// harnesses to pick between: with one, the rail repeats the detail, the aggregate is that harness under
// another name, and "1 of 1 reporting" says nothing. The same goes for a card or legend entry with no
// value to show — it is dropped, not drawn as a dash or a 0%.
//
// Pure: no React.

import type { UsageRailRow } from "./usagerail";
import type { ClassUsage } from "./usagestats";

// the one harness the window knows about, or null when there are none or several to choose from
export function soloHarness(rows: UsageRailRow[]): string | null {
    return rows.length === 1 ? rows[0].harness : null;
}

// a token class with neither tokens nor spend is a column of zeros (reasoning, for Claude)
export function visibleClasses(split: ClassUsage[]): ClassUsage[] {
    return split.filter((c) => c.tokens > 0 || c.spendUsd > 0);
}

// literal class strings, so Tailwind's scanner sees every one
const LEGEND_COLS: Record<number, string> = {
    1: "grid-cols-1",
    2: "grid-cols-2",
    3: "grid-cols-2 lg:grid-cols-3",
    4: "grid-cols-2 xl:grid-cols-4",
};

export function legendGridClass(n: number): string {
    return LEGEND_COLS[n] ?? "grid-cols-2 lg:grid-cols-3 xl:grid-cols-5";
}

export function statGridClass(n: number): string {
    return n >= 4 ? "grid-cols-2 xl:grid-cols-4" : n === 3 ? "grid-cols-1 sm:grid-cols-3" : "grid-cols-2";
}
