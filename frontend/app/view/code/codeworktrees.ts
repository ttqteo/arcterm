// frontend/app/view/code/codeworktrees.ts
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Pure: where the browsed folder sits in each checkout of its repository, so a project that is a
// subfolder of a repo switches to the same subfolder in another worktree rather than its root.

import { joinRepoPath, repoBasename } from "@/util/paths";

export interface WorktreeFolder {
    label: string;
    path: string;
}

function segments(p: string): string[] {
    return p.split(/[\\/]+/).filter((s) => s !== "");
}

// the project's segments below `root`, or null when the project is not inside it; NTFS ignores case
function relativeSegments(project: string[], root: string[]): string[] | null {
    if (root.length > project.length) {
        return null;
    }
    for (let i = 0; i < root.length; i++) {
        if (root[i].toLowerCase() !== project[i].toLowerCase()) {
            return null;
        }
    }
    return project.slice(root.length);
}

export function worktreeFolders(projectPath: string, worktrees: GitWorktree[]): WorktreeFolder[] {
    const project = segments(projectPath);
    // the innermost checkout wins: a worktree can live inside the main one's folder
    let rel: string[] | null = null;
    let depth = -1;
    for (const wt of worktrees) {
        const root = segments(wt.path);
        const r = relativeSegments(project, root);
        if (r != null && root.length > depth) {
            rel = r;
            depth = root.length;
        }
    }
    if (rel == null) {
        return [];
    }
    const sub = rel.join("/");
    return worktrees.map((wt) => ({
        // GitWorktree carries no sha, so a detached checkout is named by its folder
        label: wt.branch || `${repoBasename(wt.path)} (detached)`,
        path: sub === "" ? wt.path : joinRepoPath(wt.path, sub),
    }));
}
