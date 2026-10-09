// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// A rendered document's outline (docoutlineview.tsx draws it): its headings, indented from the shallowest one,
// and which of them you are reading. Used by the review dialog's document and the Code surface's .md and .tex
// previews.

export interface OutlineHeading {
    level: number;
    text: string;
}

export interface OutlineItem {
    // the heading's index among every heading read, so a click finds its element
    index: number;
    depth: number;
    text: string;
}

// three levels deep below the shallowest heading: a plan's Task steps and a paper's subsubsections are noise here
const MAX_DEPTH = 2;
const MIN_ITEMS = 2;

export function outlineItems(headings: OutlineHeading[]): OutlineItem[] {
    const top = Math.min(...headings.map((h) => h.level));
    const items = headings
        .map((h, index) => ({ index, depth: h.level - top, text: h.text.replace(/\s+/g, " ").trim() }))
        .filter((it) => it.depth <= MAX_DEPTH && it.text !== "");
    return items.length >= MIN_ITEMS ? items : [];
}

// The item you are reading: the last whose heading is at or above the reading line (margin below the scroller's
// top), or the first when none has scrolled up yet. tops are each item's heading offset in the scroller's content.
export function activeItem(tops: number[], scrollTop: number, margin: number): number {
    let at = tops.length > 0 ? 0 : -1;
    tops.forEach((t, i) => {
        if (t <= scrollTop + margin) {
            at = i;
        }
    });
    return at;
}
