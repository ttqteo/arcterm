// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// The New project picker's list: the folders Claude Code has sessions in (wavesrv's ScanClaudeProjects),
// less the ones already registered, filtered by what the user types. Pure, so newprojectmodal.tsx only
// renders it.

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

export function filterProjects(list: readonly ClaudeProjectData[], query: string): ClaudeProjectData[] {
    const q = query.trim().toLowerCase();
    if (q === "") {
        return [...list];
    }
    return list.filter((p) => p.name.toLowerCase().includes(q) || p.path.toLowerCase().includes(q));
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
