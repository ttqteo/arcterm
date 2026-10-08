// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The Agent rail's Files tab, as state: which directories are open, which rows are selected, the anchor a Shift-click
// ranges from, and the keyboard cursor, plus what a drag carries and when the listing reloads
// (docs/superpowers/specs/2026-10-08-rail-worktree-files-design.md). Every path is repo-relative with forward slashes,
// as codetree.ts's rows name them. Pure: no React, no Wave runtime; every function returns a new state.

import type { TreeNode, TreeRow } from "@/app/view/code/codetree";

export interface RailTreeState {
    expanded: string[];
    selected: string[];
    anchor: string | null; // where a Shift-click starts its range
    cursor: string | null; // the row the arrow keys move from
}

export const EMPTY_RAIL_TREE: RailTreeState = { expanded: [], selected: [], anchor: null, cursor: null };

export type ClickMod = "none" | "toggle" | "range";

function flip(list: readonly string[], path: string): string[] {
    return list.includes(path) ? list.filter((p) => p !== path) : [...list, path];
}

// "none" is a plain click, "toggle" a Ctrl/Cmd-click, "range" a Shift-click. A plain click on a directory also opens or
// closes it; the other two only change the selection.
export function clickRow(s: RailTreeState, rows: readonly TreeRow[], path: string, mod: ClickMod): RailTreeState {
    if (mod === "toggle") {
        return { ...s, selected: flip(s.selected, path), anchor: path, cursor: path };
    }
    if (mod === "range" && s.anchor != null) {
        const from = rows.findIndex((r) => r.path === s.anchor);
        const to = rows.findIndex((r) => r.path === path);
        if (from >= 0 && to >= 0) {
            // only visible rows: the children of a collapsed directory between the two are not rows
            const picked = rows.slice(Math.min(from, to), Math.max(from, to) + 1).map((r) => r.path);
            return { ...s, selected: picked, cursor: path };
        }
    }
    // a plain click, or a range with no visible anchor to start from
    const opens = mod === "none" && rows.some((r) => r.path === path && r.kind === "dir");
    return { expanded: opens ? flip(s.expanded, path) : s.expanded, selected: [path], anchor: path, cursor: path };
}

export function toggleExpanded(s: RailTreeState, path: string): RailTreeState {
    return { ...s, expanded: flip(s.expanded, path) };
}

// the arrow keys: the cursor moves and that row becomes the only selection
export function moveCursorTo(s: RailTreeState, path: string): RailTreeState {
    return { ...s, selected: [path], anchor: path, cursor: path };
}

// What dragging `path` carries: the visible selected rows, in row order, when `path` is one of them; otherwise `path`
// alone. A directory ends in "/", so the drop can tell it from a file.
export function dragPaths(s: RailTreeState, rows: readonly TreeRow[], path: string): string[] {
    const named = (r: TreeRow) => (r.kind === "dir" ? `${r.path}/` : r.path);
    if (s.selected.includes(path)) {
        const selected = new Set(s.selected);
        return rows.filter((r) => selected.has(r.path)).map(named);
    }
    const row = rows.find((r) => r.path === path);
    return [row != null ? named(row) : path];
}

// Drops the expanded, selected, anchor and cursor paths a reload removed. `listing` is the whole tree (buildTree's
// result) or a list of rows: expanded directories inside a collapsed one are only in the whole tree, so rows are right
// only when the caller means "what is visible".
export function pruneExpanded(s: RailTreeState, listing: readonly TreeNode[] | readonly TreeRow[]): RailTreeState {
    const known = new Set<string>();
    const walk = (items: readonly (TreeNode | TreeRow)[]) => {
        for (const item of items) {
            known.add(item.path);
            if ("children" in item) {
                walk(item.children);
            }
        }
    };
    walk(listing);
    const expanded = s.expanded.filter((p) => known.has(p));
    const selected = s.selected.filter((p) => known.has(p));
    const anchor = s.anchor != null && known.has(s.anchor) ? s.anchor : null;
    const cursor = s.cursor != null && known.has(s.cursor) ? s.cursor : null;
    if (
        expanded.length === s.expanded.length &&
        selected.length === s.selected.length &&
        anchor === s.anchor &&
        cursor === s.cursor
    ) {
        return s; // unchanged: the same object, so an atom set from it does not re-render
    }
    return { expanded, selected, anchor, cursor };
}

export interface TreeReloadObservation {
    state: string | null | undefined; // the agent's state
    tabShown: boolean; // the Files tab is the one showing
}

// Whether the Files listing reloads: when the tab becomes shown, and when the agent's state changes (a turn ending may
// have created files) while it shows. `prev` is null the first time the tab is observed.
export function shouldReloadTree(prev: TreeReloadObservation | null, next: TreeReloadObservation): boolean {
    if (!next.tabShown) {
        return false;
    }
    return prev == null || !prev.tabShown || prev.state !== next.state;
}
