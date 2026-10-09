// frontend/app/view/agents/filestep.ts
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Moving through the file list the Diff surface shows (everything here is pure but firstShownPath, which reads the two
// list switches). ↑/↓ in the list and the folded header's ‹ file i of n ›
// both step through the paths in the order the list draws them, so the tree's order (directories first, each sorted)
// is what "next" means, not the order git reported.

import { globalStore } from "@/app/store/jotaiStore";
import { buildFileTree, collapsedDirsAtom, treeModeAtom } from "./filetree";
import type { GitChange } from "./gitstatus";

// The file paths in draw order. A directory collapsed in the tree hides its files, so they are not shown and not
// stepped through; flat mode draws the list as given.
export function shownPaths(files: GitChange[], treeMode: boolean, collapsed: Set<string>): string[] {
    if (!treeMode) {
        return files.map((f) => f.path);
    }
    return buildFileTree(files, collapsed)
        .filter((r) => r.kind === "file")
        .map((r) => r.id);
}

// The next (delta 1) or previous (delta -1) path, clamped at the ends. With nothing selected, or the selection no
// longer listed, the first path: a step then lands on the top of the list rather than nowhere.
export function stepFile(paths: string[], current: string | null, delta: number): string | null {
    if (paths.length === 0) {
        return null;
    }
    const at = current == null ? -1 : paths.indexOf(current);
    if (at < 0) {
        return paths[0];
    }
    return paths[Math.min(paths.length - 1, Math.max(0, at + delta))];
}

// "file 2 of 5"; counts from the first when the current file is not listed, as stepFile does.
export function fileStepLabel(paths: string[], current: string | null): string {
    if (paths.length === 0) {
        return "file 0 of 0";
    }
    const at = current == null ? 0 : Math.max(0, paths.indexOf(current));
    return `file ${at + 1} of ${paths.length}`;
}

// The file a source, commit, session row or compare range opens on: the top row of the list as it is drawn right now.
// Reads the tree switch and the collapsed folders from the store, so the pick matches the screen in tree mode too. If
// every folder is collapsed nothing is drawn; the first file then ignores the folds rather than leaving the diff empty.
export function firstShownPath(files: GitChange[]): string | undefined {
    const tree = globalStore.get(treeModeAtom);
    return shownPaths(files, tree, globalStore.get(collapsedDirsAtom))[0] ?? shownPaths(files, tree, new Set())[0];
}
