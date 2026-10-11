// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Pure: the universal search's Files scope. Code's file finder folded in here, so this reuses its
// ranking (rankPaths) and its query language (a trailing ":123" is a line) rather than growing a
// second one.

import { parseFinderQuery, rankPaths } from "@/app/view/code/codefinder";

export interface FileHit {
    path: string; // repo-relative
    base: string;
    dir: string;
}

export interface FileGroups {
    text: string; // the query without its line suffix: what rows highlight against
    line?: number;
    groups: { key: string; label: string; items: FileHit[] }[];
}

function hit(path: string): FileHit {
    const slash = path.lastIndexOf("/");
    return slash === -1
        ? { path, base: path, dir: "" }
        : { path, base: path.slice(slash + 1), dir: path.slice(0, slash) };
}

// recent: most recent first, from Code's history. With nothing typed it leads as its own group; a
// recent file the index no longer lists is left out (rankPaths drops it), since it was deleted or renamed.
// pinned: the project's pinned files (codepins.ts), in pin order; with nothing typed they lead, ahead of recent.
export function assembleFileGroups(
    query: string,
    paths: readonly string[],
    recent: readonly string[],
    projectLabel: string,
    limit: number,
    pinned: readonly string[] = []
): FileGroups {
    const { text, line } = parseFinderQuery(query);
    const pinnedSet = new Set(pinned);
    const head = [...pinned, ...recent.filter((p) => !pinnedSet.has(p))];
    const ranked = rankPaths(text, paths, limit, head).map((m) => hit(m.path));
    const label = `Files in ${projectLabel}`;
    if (text !== "") {
        return { text, line, groups: ranked.length > 0 ? [{ key: "files", label, items: ranked }] : [] };
    }
    const recentSet = new Set(recent);
    return {
        text,
        line,
        groups: [
            { key: "pinned-files", label: "Pinned files", items: ranked.filter((f) => pinnedSet.has(f.path)) },
            {
                key: "recent-files",
                label: "Recent files",
                items: ranked.filter((f) => recentSet.has(f.path) && !pinnedSet.has(f.path)),
            },
            { key: "files", label, items: ranked.filter((f) => !recentSet.has(f.path) && !pinnedSet.has(f.path)) },
        ].filter((g) => g.items.length > 0),
    };
}

export function fileEcho(f: FileHit, line: number | undefined): string {
    return `Opens ${f.path}${line != null ? ` at line ${line}` : ""} in Code`;
}
