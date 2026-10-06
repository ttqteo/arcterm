// frontend/util/paths.ts
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { isWindows } from "./platformutil";

// On Windows git reports repo-relative paths with forward slashes while a project root uses
// backslashes, so a raw `${root}/${rel}` join is mixed-separator. Normalizing the whole join to
// backslashes is what makes open::that (ShellExecute) resolve it and a copied absolute path a valid
// native Windows path. Elsewhere both halves already use the native forward slash.
export function joinRepoPath(root: string, rel: string): string {
    if (!isWindows()) {
        return `${root}/${rel}`.replace(/\/+/g, "/");
    }
    return `${root}/${rel}`.replace(/\/+/g, "\\").replace(/\\+/g, "\\");
}

// A repository path reaches the cockpit either from git (forward slashes) or from the config
// registry (backslashes), so equality has to ignore separator style — and NTFS ignores case.
// joinRepoPath cannot serve here: it builds one path for ShellExecute, it does not compare two.
// An empty path matches nothing, so a blank cwd can never claim a registered project.
export function sameRepoPath(a: string, b: string): boolean {
    if (!a || !b) {
        return false;
    }
    return normalizeRepoPath(a) === normalizeRepoPath(b);
}

export function normalizeRepoPath(p: string): string {
    return p
        .replace(/[\\/]+/g, "/")
        .replace(/\/+$/, "")
        .toLowerCase();
}

// The directory name, used to label a repository that is not in the project registry — a worktree,
// which launchAgent creates and which the Code surface can still browse.
export function repoBasename(p: string): string {
    const segs = p.split(/[\\/]+/).filter((s) => s !== "");
    return segs.length === 0 ? "" : segs[segs.length - 1];
}

// A repo-relative path as the diff header draws it: the directory keeps its trailing slash so the two
// halves concatenate back to the path, and the file name can be styled on its own.
export function splitRepoPath(p: string): { dir: string; file: string } {
    const i = p.lastIndexOf("/");
    return i < 0 ? { dir: "", file: p } : { dir: p.slice(0, i + 1), file: p.slice(i + 1) };
}
