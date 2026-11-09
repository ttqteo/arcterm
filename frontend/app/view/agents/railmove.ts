// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Rows of the Agent panel's Files tree dragged onto a folder of the same tree move into it, as in a file manager; a
// drag onto a terminal still types the paths. This is the pure part: which moves a drop makes, which it skips and why,
// and the words. The renames are railfiledropstore.ts (moveRowsInto); wavesrv refuses a name already taken in the
// folder (RemoteFileMoveCommand), so a move never replaces a file.

import { whereLabel } from "./railfiledrop";

export interface MoveStep {
    from: string; // repo-relative
    to: string;
}

export interface MovePlan {
    moves: MoveStep[];
    // what will not move, with why; an item already in the folder is left out silently, since nothing was asked of it
    skipped: { name: string; reason: string }[];
}

function parentOf(rel: string): string {
    const cut = rel.lastIndexOf("/");
    return cut === -1 ? "" : rel.slice(0, cut);
}

function baseOf(rel: string): string {
    return rel.slice(rel.lastIndexOf("/") + 1);
}

function isUnder(rel: string, dir: string): boolean {
    return rel === dir || rel.startsWith(`${dir}/`);
}

// The moves a drop of `paths` (repo-relative; a folder may end with "/", as dragPaths names it) into `dir` ("" the root)
// makes. An item inside another dragged folder goes with that folder, a folder cannot go into itself, and of two items
// with one name only the first goes in.
export function planMove(paths: readonly string[], dir: string): MovePlan {
    const rels = [...new Set(paths.map((p) => p.replace(/\/+$/, "")).filter((p) => p !== ""))];
    const plan: MovePlan = { moves: [], skipped: [] };
    const taken = new Set<string>();
    for (const rel of rels) {
        if (rels.some((other) => other !== rel && isUnder(rel, other))) {
            continue; // moves with its folder
        }
        if (parentOf(rel) === dir || rel === dir) {
            continue; // already there, or a folder dropped on its own row
        }
        if (dir !== "" && isUnder(dir, rel)) {
            plan.skipped.push({ name: rel, reason: "a folder cannot go inside itself" });
            continue;
        }
        const name = baseOf(rel);
        const to = dir === "" ? name : `${dir}/${name}`;
        if (taken.has(to)) {
            plan.skipped.push({ name: rel, reason: `another item named “${name}” is moving there` });
            continue;
        }
        taken.add(to);
        plan.moves.push({ from: rel, to });
    }
    return plan;
}

// The strip shown while the tree's own rows are over it, naming the folder they would move into
export function moveHintLabel(dir: string): string {
    return `Drop to move into ${whereLabel(dir)}`;
}

// What to tell the user about everything a move left where it was, as one toast; null when it all moved.
export function moveFailedToast(failed: readonly { name: string; reason: string }[]): {
    title: string;
    message: string;
} | null {
    if (failed.length === 0) {
        return null;
    }
    if (failed.length === 1) {
        return { title: `Couldn't move “${failed[0].name}”`, message: failed[0].reason };
    }
    const shown = failed.slice(0, 3).map((f) => `“${f.name}”: ${f.reason}`);
    const more = failed.length > 3 ? [`and ${failed.length - 3} more`] : [];
    return { title: `${failed.length} items weren't moved`, message: [...shown, ...more].join("; ") };
}

// The tree's own rows being dragged, by the tree's cwd. A browser hides a drag's payload until the drop, so dragover
// reads this to tell a move within the tree from a drag that came from elsewhere.
let dragging: { cwd: string; rels: string[] } | null = null;

export function setTreeDrag(drag: { cwd: string; rels: string[] } | null): void {
    dragging = drag;
}

export function treeDrag(): { cwd: string; rels: string[] } | null {
    return dragging;
}
