// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The Overview's Branches card, as data (projectgraphcard.tsx draws it): the newest commits of every branch of the
// project's checkout over the graph's lanes, the uncommitted row on top, and the header's line naming the branches they
// show. Pure.

import { buildRows, type HistoryRow, type RefChip } from "./historyrows";

// one read, no paging: the card is a glance, the Diff surface's Log is the whole history
export const GRAPH_CARD_LIMIT = 20;
export const GRAPH_CARD_ROW_H = 28;
// the card is page-wide, so it has room for more lanes than the Log's 340px panel
export const GRAPH_CARD_MAX_LANES = 6;
// chips a row shows before the rest fold into a count
export const GRAPH_CARD_CHIPS = 3;

export function graphCardRows(commits: HistoryCommit[], head: string, dirtyFiles: number, now: number): HistoryRow[] {
    return buildRows(commits, { head, dirtyFileCount: dirtyFiles, now });
}

// the branches the rows name, local ones first (the checked-out one leads), then the remote ones; tags are not branches
export function branchesShown(rows: HistoryRow[]): RefChip[] {
    const seen = new Set<string>();
    const out: RefChip[] = [];
    for (const row of rows) {
        for (const ref of row.refs) {
            if (ref.kind === "tag" || ref.label === "HEAD" || seen.has(ref.label)) {
                continue;
            }
            seen.add(ref.label);
            out.push(ref);
        }
    }
    const rank = (r: RefChip) => (r.kind === "head" ? 0 : r.kind === "branch" ? 1 : 2);
    return out.sort((a, b) => rank(a) - rank(b));
}

export function graphCardSummary(rows: HistoryRow[]): string {
    const commits = rows.filter((r) => !r.workingTree).length;
    const branches = branchesShown(rows).length;
    const c = `${commits} ${commits === 1 ? "commit" : "commits"}`;
    return branches === 0 ? c : `${c} · ${branches} ${branches === 1 ? "branch" : "branches"}`;
}

// a row's chips and how many more it has
export function rowChips(row: HistoryRow): { chips: RefChip[]; more: number } {
    const chips = row.refs.slice(0, GRAPH_CARD_CHIPS);
    return { chips, more: row.refs.length - chips.length };
}
