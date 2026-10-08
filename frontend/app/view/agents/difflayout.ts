// frontend/app/view/agents/difflayout.ts
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Pure: how wide the Diff surface is -> whether the commit column and the worktree sidebar are columns or rails. The
// surface ships in a 1000x700 window (src-tauri/tauri.conf.json), where a fixed 460px history plus
// a 300px file list leaves the diff pane about 240px — unreadable. One threshold per column is
// the whole of it; the rest of the folding cascade stays declined (docs/deferred.md).

import { atom, type PrimitiveAtom } from "jotai";

export const HISTORY_COLLAPSE_PX = 1280;

// null = follow the width; true/false = the user said so and resizing must not undo it
export const historyCollapsedAtom = atom<boolean | null>(null) as PrimitiveAtom<boolean | null>;

export function resolveCollapsed(explicit: boolean | null, surfaceWidth: number): boolean {
    if (explicit != null) {
        return explicit;
    }
    if (surfaceWidth <= 0) {
        return false; // not measured yet; expanding first avoids a rail that flashes and vanishes
    }
    return surfaceWidth < HISTORY_COLLAPSE_PX;
}

// Measured on the whole surface, sidebar included, so folding the sidebar never moves the width it is judged by. Below
// this, a 240px sidebar beside the folded commit rail (44px) and the 300px file list leaves the diff pane under 400px:
// at the shipped window the surface is about 920px wide.
export const SIDEBAR_FOLD_PX = 1000;

// The worktree sidebar's fold, by resolveCollapsed's rule: an explicit choice wins, else the width decides.
export function resolveSidebarFolded(explicit: boolean | null, surfaceWidth: number): boolean {
    if (explicit != null) {
        return explicit;
    }
    if (surfaceWidth <= 0) {
        return false; // not measured yet, as above
    }
    return surfaceWidth < SIDEBAR_FOLD_PX;
}
