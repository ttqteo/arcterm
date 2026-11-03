// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Pure model for Agent → Councils (agentcenter.ts' `councils` mode): every council of every project, open or closed, as
// a list grouped Today / Yesterday / Earlier by its newest message, the way the Canvas gallery groups its canvases, and
// its search. The tree lists only the councils still open (councilRowsByProject leaves a closed one out); this is where a
// closed one is found again. No React.

import { councilRowVM, projectNamesByKey, type CouncilRowVM } from "./agentsidebarmodel";
import { councilProjectKey, isClosedCouncil } from "./councilmodel";

export interface CouncilHistoryRow extends CouncilRowVM {
    /** the registered project's name, else the last folder of the path the council ran in */
    projectName: string;
    /** what it was asked, trimmed; empty when it was asked nothing beyond its feature */
    question: string;
    /** the person closed it (isClosedCouncil): the tree no longer lists it */
    closed: boolean;
}

export type CouncilHistoryGroup = {
    key: "today" | "yesterday" | "earlier";
    label: string;
    rows: CouncilHistoryRow[];
};

/** Pure: the last folder of a path, either separator, a trailing one ignored; the path itself when it has none. */
export function folderName(path: string): string {
    const parts = path.replace(/[\\/]+$/, "").split(/[\\/]/);
    return parts[parts.length - 1] || path;
}

/** Pure: every council (councilListAtom("")) as a row, newest message first (councilLastAt), a tie broken by id so the
 *  order never depends on the input's. `null` is a list not loaded yet, which has no rows. */
export function councilHistoryRows(
    councils: readonly Council[] | null | undefined,
    roots: ReadonlyMap<string, string>,
    unread: ReadonlySet<string> = new Set()
): CouncilHistoryRow[] {
    const list = councils ?? [];
    const nameOf = projectNamesByKey(roots);
    const byId = new Map(list.map((c) => [c.id, c]));
    return list
        .map(
            (c): CouncilHistoryRow => ({
                ...councilRowVM(c, byId, unread),
                projectName: nameOf.get(councilProjectKey(c.project)) ?? folderName(c.project),
                question: (c.question ?? "").trim(),
                closed: isClosedCouncil(c),
            })
        )
        .sort((a, b) => b.lastAt - a.lastAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** Pure: the rows whose feature, question or project name holds `query`, case aside; every row for a blank query. */
export function searchCouncilHistory(rows: readonly CouncilHistoryRow[], query: string): CouncilHistoryRow[] {
    const q = query.trim().toLowerCase();
    if (q === "") {
        return [...rows];
    }
    return rows.filter((r) => [r.feature, r.question, r.projectName].some((s) => s.toLowerCase().includes(q)));
}

function startOfDay(ts: number): number {
    return new Date(ts).setHours(0, 0, 0, 0);
}

/** Pure: the rows by the day of their newest message, in their order: Today, Yesterday, Earlier, an empty group left
 *  out. */
export function groupCouncilHistory(rows: readonly CouncilHistoryRow[], now: number): CouncilHistoryGroup[] {
    const today = startOfDay(now);
    // setDate, not minus 24 h: a day with a clock change is not 24 h long
    const yesterday = new Date(today).setDate(new Date(today).getDate() - 1);
    const groups: CouncilHistoryGroup[] = [
        { key: "today", label: "Today", rows: [] },
        { key: "yesterday", label: "Yesterday", rows: [] },
        { key: "earlier", label: "Earlier", rows: [] },
    ];
    for (const r of rows) {
        groups[r.lastAt >= today ? 0 : r.lastAt >= yesterday ? 1 : 2].rows.push(r);
    }
    return groups.filter((g) => g.rows.length > 0);
}

/** Pure: the header's count: every council, and how many of them are closed when any is. */
export function councilHistoryCount(rows: readonly CouncilHistoryRow[]): string {
    const closed = rows.filter((r) => r.closed).length;
    return closed > 0 ? `${rows.length} · ${closed} closed` : `${rows.length}`;
}
