// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The rail Files tab's filter box, as rows: the files whose name holds the query, under their folders, all open.
// Pure: no React, no Wave runtime.

import { buildTree, visibleRows, type TreeRow } from "@/app/view/code/codetree";

function baseOf(path: string): string {
    return path.slice(path.lastIndexOf("/") + 1);
}

// [start, end) of the query in a name, case-insensitively; null when it is not there or the query is blank
export function matchSpan(name: string, query: string): [number, number] | null {
    const q = query.trim().toLowerCase();
    if (q === "") {
        return null;
    }
    const at = name.toLowerCase().indexOf(q);
    return at < 0 ? null : [at, at + q.length];
}

// a name, not a path: typing "harn" should not list every file under a folder called obsidian_harness
export function filterRows(paths: readonly string[], query: string): { rows: TreeRow[]; count: number } {
    const matched = paths.filter((p) => matchSpan(baseOf(p), query) != null);
    const open = new Set<string>();
    for (const p of matched) {
        for (let cut = p.indexOf("/"); cut !== -1; cut = p.indexOf("/", cut + 1)) {
            open.add(p.slice(0, cut));
        }
    }
    return { rows: visibleRows(buildTree(matched), open), count: matched.length };
}
