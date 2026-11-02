// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// The New project picker's list: the projects Claude Code has sessions in (wavesrv's ScanClaudeProjects),
// less the ones already registered, filtered by what the user types, and once they type, the project folders
// found on disk near those (FindProjectFolders). Pure, so newprojectmodal.tsx only renders it.

// a path as the registry compares it: separators, a trailing slash and a drive letter's case do not make
// two folders
export function projectPathKey(path: string): string {
    return path.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

export function unregisteredProjects(
    scanned: readonly ClaudeProjectData[],
    registered: readonly { path: string }[]
): ClaudeProjectData[] {
    const taken = new Set(registered.map((r) => projectPathKey(r.path)));
    return scanned.filter((p) => !taken.has(projectPathKey(p.path)));
}

// A path as the search reads it: one under the home folder starts at "~", so typing your own user name (in every
// /Users/<name>/… path) does not match every row. The query goes through it too, so a pasted full path still matches.
export function searchPath(path: string, home: string): string {
    const p = path.replace(/\\/g, "/").toLowerCase();
    const h = home.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
    if (h !== "" && (p === h || p.startsWith(h + "/"))) {
        return "~" + p.slice(h.length);
    }
    return p;
}

// Keeps the items whose name or path holds the query, the name matches first, each part in its given order.
function search<T extends { name: string; path: string }>(list: readonly T[], query: string, home: string): T[] {
    const q = searchPath(query.trim(), home);
    const byName: T[] = [];
    const byPath: T[] = [];
    for (const item of list) {
        if (item.name.toLowerCase().includes(q)) {
            byName.push(item);
        } else if (searchPath(item.path, home).includes(q)) {
            byPath.push(item);
        }
    }
    return [...byName, ...byPath];
}

export function filterProjects(list: readonly ClaudeProjectData[], query: string, home = ""): ClaudeProjectData[] {
    if (query.trim() === "") {
        return [...list];
    }
    return search(list, query, home);
}

// The search's second section: project folders found on disk near the known ones, for a folder Claude Code never ran
// in. Only once the person types, so the list they open to stays the Claude Code one, and never a folder that list or
// the registry already has.
export function onDiskProjects(
    found: readonly ProjectFolderData[],
    claude: readonly { path: string }[],
    registered: readonly { path: string }[],
    query: string,
    home = ""
): ProjectFolderData[] {
    if (query.trim() === "") {
        return [];
    }
    const taken = new Set([...claude, ...registered].map((r) => projectPathKey(r.path)));
    return search(
        found.filter((f) => !taken.has(projectPathKey(f.path))),
        query,
        home
    );
}

// Registering a name that already exists moves that project to the new path (CreateProjectCommand treats it
// as an update), so a picked folder whose name is taken gets the first free "-2", "-3"… instead.
export function uniqueProjectName(base: string, taken: readonly string[]): string {
    const names = new Set(taken.map((n) => n.toLowerCase()));
    if (!names.has(base.toLowerCase())) {
        return base;
    }
    for (let i = 2; ; i++) {
        const name = `${base}-${i}`;
        if (!names.has(name.toLowerCase())) {
            return name;
        }
    }
}

// the row the cursor lands on after moving by `delta`, clamped to the list
export function moveCursor(index: number, delta: number, length: number): number {
    if (length === 0) {
        return -1;
    }
    return Math.min(length - 1, Math.max(0, index + delta));
}
