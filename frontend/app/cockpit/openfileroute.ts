// frontend/app/cockpit/openfileroute.ts
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Pure routing for "openfile" events: turn an absolute path into a Code-surface project/file
// selection. Kept free of atoms and RPC so it unit-tests without booting the store.

import type { CodeProject } from "@/app/view/code/codestore";
import { normalizeRepoPath, repoBasename, sameRepoPath } from "@/util/paths";

export interface OpenFileRoute {
    // project to have selected when this route runs
    project: CodeProject;
    // file to open within the project; null = just browse the project (directory arg)
    rel: string | null;
}

export function isUnderRoot(root: string, path: string): boolean {
    const nRoot = normalizeRepoPath(root);
    const nPath = normalizeRepoPath(path);
    // a bare "C:" prefix would swallow every path on the drive; a usable root has a separator
    if (!nRoot.includes("/")) {
        return false;
    }
    return nPath.startsWith(nRoot + "/");
}

// rel is git-style: forward slashes, no leading separator. Comparison is case/separator
// insensitive (via isUnderRoot) but the returned segments keep their original case.
export function toRel(root: string, path: string): string {
    const segs = path.split(/[\\/]+/).filter((s) => s !== "");
    const rootSegs = root.split(/[\\/]+/).filter((s) => s !== "");
    return segs.slice(rootSegs.length).join("/");
}

function dirnameOf(path: string): string {
    const idx = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
    return idx <= 0 ? path : path.slice(0, idx);
}

// A path outside the current project belongs to the registered project that contains it before it
// becomes a project of its own directory: agents are matched to a project by its registered name, and
// a file opened under a synthesized project would also lose the rest of its repository.
export function routeOpenFile(
    absPath: string,
    isDir: boolean,
    current: CodeProject | null,
    registered: readonly CodeProject[]
): OpenFileRoute {
    if (isDir) {
        const known = registered.find((p) => sameRepoPath(p.path, absPath));
        return { project: known ?? { name: repoBasename(absPath), path: absPath }, rel: null };
    }
    if (current != null && current.path !== "" && isUnderRoot(current.path, absPath)) {
        return { project: current, rel: toRel(current.path, absPath) };
    }
    // the deepest root wins, so a repository registered inside another claims its own files
    let owner: CodeProject | null = null;
    for (const p of registered) {
        if (
            isUnderRoot(p.path, absPath) &&
            (owner == null || normalizeRepoPath(p.path).length > normalizeRepoPath(owner.path).length)
        ) {
            owner = p;
        }
    }
    if (owner != null) {
        return { project: owner, rel: toRel(owner.path, absPath) };
    }
    const dir = dirnameOf(absPath);
    return { project: { name: repoBasename(dir), path: dir }, rel: repoBasename(absPath) };
}
