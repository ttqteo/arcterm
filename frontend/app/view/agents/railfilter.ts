// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The rail Files tab's filter box, as rows: the files whose name holds the query, under their folders, all open.
// A query with a "/" in it is a path instead, matched against each file's whole path.
// Pure: no React, no Wave runtime.

import { buildTree, visibleRows, type TreeRow } from "@/app/view/code/codetree";

function baseOf(path: string): string {
    return path.slice(path.lastIndexOf("/") + 1);
}

// the query as the filter reads it: trimmed, lowercased, backslashes as "/", a leading "./" or "/" dropped
function normalize(query: string): string {
    return query
        .trim()
        .toLowerCase()
        .replace(/\\/g, "/")
        .replace(/^(\.\/|\/)+/, "");
}

// a path query matches anywhere in a path: "results/study/audit" — not only the name
export function isPathQuery(query: string): boolean {
    return normalize(query).includes("/");
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

// [start, end) of a path query in a path; a query that ends with the whole path (an absolute path pasted, or one
// starting at a folder above the tree) covers all of it
export function pathMatchSpan(path: string, query: string): [number, number] | null {
    const q = normalize(query);
    if (q === "") {
        return null;
    }
    const p = path.toLowerCase();
    const at = p.indexOf(q);
    if (at >= 0) {
        return [at, at + q.length];
    }
    return q.endsWith("/" + p) ? [0, p.length] : null;
}

// the part of a row's name to bold while filtering: the query in a file's name, or, for a path query, the stretch of
// a file's name the matched path covers
export function rowMatchSpan(row: Pick<TreeRow, "kind" | "path" | "name">, query: string): [number, number] | null {
    if (!isPathQuery(query)) {
        return matchSpan(row.name, query);
    }
    if (row.kind !== "file") {
        return null;
    }
    const span = pathMatchSpan(row.path, query);
    if (span == null) {
        return null;
    }
    const nameAt = row.path.length - row.name.length;
    const start = Math.max(span[0], nameAt);
    const end = Math.min(span[1], row.path.length);
    return start < end ? [start - nameAt, end - nameAt] : null;
}

// a name, not a path: typing "harn" should not list every file under a folder called obsidian_harness; a query with a
// "/" opts into the path
export function filterRows(paths: readonly string[], query: string): { rows: TreeRow[]; count: number } {
    const byPath = isPathQuery(query);
    const matched = paths.filter((p) => (byPath ? pathMatchSpan(p, query) : matchSpan(baseOf(p), query)) != null);
    const open = new Set<string>();
    for (const p of matched) {
        for (let cut = p.indexOf("/"); cut !== -1; cut = p.indexOf("/", cut + 1)) {
            open.add(p.slice(0, cut));
        }
    }
    return { rows: visibleRows(buildTree(matched), open), count: matched.length };
}
