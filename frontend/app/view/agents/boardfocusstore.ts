// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Focus board's press (boardfocus.ts): it writes the three parts it changes (the tree's fold, the rail, the split's
// share) and keeps the layout it found, in memory, for the second press to put back. Kept per project, as the shares
// are: focusing one project's board split leaves another project's layout to put back alone.

import { globalStore } from "@/app/store/jotaiStore";
import { atom, type PrimitiveAtom } from "jotai";
import { treeFoldedAtom } from "../boards/boardsplitstore";
import { focusedLayout, isBoardFocused, unfocusedLayout, type BoardFocusTarget, type FocusLayout } from "./boardfocus";
import { gridSizesAtom, sizesOf } from "./gridsash";
import { clampShare } from "./gridsplit";
import { railVisibleAtom } from "./railstore";

interface Kept {
    before: FocusLayout;
    share: number; // the share the press set, after the width clamp
}

const keptAtom = atom<Record<string, Kept>>({}) as PrimitiveAtom<Record<string, Kept>>;

// The layout as it is now, for a project's split.
const layoutAtom = atom((get) => ({
    treeFolded: get(treeFoldedAtom),
    railVisible: get(railVisibleAtom),
    all: get(gridSizesAtom),
}));

function layoutOf(project: string): FocusLayout {
    const now = globalStore.get(layoutAtom);
    return { treeFolded: now.treeFolded, railVisible: now.railVisible, sizes: sizesOf(now.all, project) };
}

function write(project: string, next: FocusLayout): void {
    globalStore.set(treeFoldedAtom, next.treeFolded);
    globalStore.set(railVisibleAtom, next.railVisible);
    globalStore.set(gridSizesAtom, project, next.sizes);
}

// Whether a project's board split is focused now: the share the press set while it is kept, else the target's own.
export const boardFocusedAtom = atom((get) => (project: string, target: BoardFocusTarget) => {
    const now = get(layoutAtom);
    const share = get(keptAtom)[project]?.share ?? target.share;
    return isBoardFocused(
        { treeFolded: now.treeFolded, railVisible: now.railVisible, sizes: sizesOf(now.all, project) },
        target.axis,
        share
    );
});

// The grid's span on the target's axis, read off the stack (agentsurface.tsx data-agent-grid), for the width clamp the
// sash applies too; 0 (no clamp by pixels) when it is not on screen.
function gridSpan(axis: BoardFocusTarget["axis"]): number {
    const el = globalThis.document?.querySelector<HTMLElement>("[data-agent-grid]");
    if (el == null) {
        return 0;
    }
    const r = el.getBoundingClientRect();
    return axis === "col" ? r.width : r.height;
}

// One press: focus the board split, or put the layout back when it is focused.
export function toggleBoardFocus(project: string, target: BoardFocusTarget): void {
    const now = layoutOf(project);
    const kept = globalStore.get(keptAtom);
    const rest = { ...kept };
    delete rest[project];
    if (globalStore.get(boardFocusedAtom)(project, target)) {
        write(project, unfocusedLayout(now, kept[project]?.before ?? null, target.axis));
        globalStore.set(keptAtom, rest);
        return;
    }
    // the layout as it is now is what the next press puts back, even when an earlier focus was undone by hand since
    const share = clampShare(target.share, gridSpan(target.axis));
    write(project, focusedLayout(now, target.axis, share));
    globalStore.set(keptAtom, { ...rest, [project]: { before: now, share } });
}
