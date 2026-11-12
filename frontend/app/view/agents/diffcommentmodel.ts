// frontend/app/view/agents/diffcommentmodel.ts
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Pure: what the diff pane's comment layer says and where it may comment. Kept out of the layer so the
// copy and the rules are tested without a Monaco editor.

import type { CommentSide } from "./diffcomments";

const EN_DASH = "–";

// "Line 4", "Lines 7–9"; the left side is only ever commented in split view, on its removed lines
export function rangeLabel(side: CommentSide, start: number, end: number): string {
    const lines = start === end ? `line ${start}` : `lines ${start}${EN_DASH}${end}`;
    return side === "original" ? `Removed ${lines}` : lines[0].toUpperCase() + lines.slice(1);
}

export function draftTitle(side: CommentSide, start: number, end: number): string {
    const label = rangeLabel(side, start, end);
    return `Comment on ${label[0].toLowerCase()}${label.slice(1)}`;
}

// Monaco reports a pure deletion with modifiedEndLineNumber 0, anchored after modifiedStartLineNumber. A
// deleted file is the exception: its removed lines are paired with the empty file's one blank line, which
// reads as added, so with an empty right side the whole file is the removed hunk, hung at the top.
export function removedOnlyHunks(
    changes: { modifiedEndLineNumber: number; modifiedStartLineNumber: number }[],
    modifiedEmpty = false
): number[] {
    if (modifiedEmpty) {
        return changes.length > 0 ? [0] : [];
    }
    return changes.filter((c) => c.modifiedEndLineNumber === 0).map((c) => c.modifiedStartLineNumber);
}

// unified view draws removed lines as view zones, with no gutter, selection or editor to hang a card in
export function commentableSide(side: CommentSide, split: boolean): boolean {
    return side === "modified" || split;
}

export function selectedLines(sel: {
    startLineNumber: number;
    startColumn: number;
    endLineNumber: number;
    endColumn: number;
}): { start: number; end: number } {
    const touchesOnlyStart = sel.endLineNumber > sel.startLineNumber && sel.endColumn === 1;
    return { start: sel.startLineNumber, end: touchesOnlyStart ? sel.endLineNumber - 1 : sel.endLineNumber };
}
