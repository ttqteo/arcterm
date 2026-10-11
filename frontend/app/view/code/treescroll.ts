// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Where a file tree scrolls to show a row: Code's tree and the Agent panel's Files tab. A row at most one row past the
// edge is a step (the arrow keys) and scrolls just into view; a row further away is a jump (Open in Code, the finder, a
// pinned file, Locate) and lands in the middle, where the eye finds it, not on the bottom edge.

export interface ScrollView {
    top: number; // the list's scrollTop
    height: number; // the list's visible height
}

export interface RowBox {
    top: number; // the row's offset in the list's content
    height: number;
}

// the scrollTop that shows `row`, or null when it already shows whole
export function revealScrollTop(view: ScrollView, row: RowBox): number | null {
    const bottom = view.top + view.height;
    const rowBottom = row.top + row.height;
    if (row.top >= view.top && rowBottom <= bottom) {
        return null;
    }
    if (row.top < view.top && row.top >= view.top - row.height) {
        return row.top;
    }
    if (rowBottom > bottom && row.top <= bottom) {
        return rowBottom - view.height;
    }
    return Math.max(0, Math.round(row.top - (view.height - row.height) / 2));
}

// scrolls `list` so `row`, an element inside it, shows (revealScrollTop)
export function revealInList(list: HTMLElement | null, row: HTMLElement | null | undefined): void {
    if (list == null || row == null) {
        return;
    }
    const l = list.getBoundingClientRect();
    const r = row.getBoundingClientRect();
    const top = revealScrollTop(
        { top: list.scrollTop, height: list.clientHeight },
        { top: r.top - l.top - list.clientTop + list.scrollTop, height: r.height }
    );
    if (top != null) {
        list.scrollTop = top;
    }
}
