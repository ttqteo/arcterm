// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Which rows of Chat's conversation open on the spring as they arrive (chatconversation.tsx). Transcript content lands a whole
// block at a time, so a row that simply appears shoves what is above it; one that opens its height 0 → auto does not. Only a
// row arriving at the tail of a conversation already drawn opens that way: the first load, the items "Show earlier" draws in
// front and a restored reading place are all drawn at once, as they were. Pure.

/** A new row taller than this opens only its last ARRIVAL_CAP_PX of height; the rest is there at once, so the view never races. */
export const ARRIVAL_CAP_PX = 320;

/** Pure: the keys in `next` that arrived at the tail of a list that was already drawn (`prev`, the keys of the last render).
 *  Nothing arrives into an empty list (the first load) or a list none of whose keys remain (another conversation), and a key
 *  new in front of the ones kept (earlier items drawn) or between them is no arrival. */
export function tailArrivals(prev: readonly string[], next: readonly string[]): Set<string> {
    const arrived = new Set<string>();
    if (prev.length === 0) {
        return arrived;
    }
    const before = new Set(prev);
    let lastKept = -1;
    next.forEach((key, i) => {
        if (before.has(key)) {
            lastKept = i;
        }
    });
    if (lastKept < 0) {
        return arrived;
    }
    for (let i = lastKept + 1; i < next.length; i++) {
        if (!before.has(next[i])) {
            arrived.add(next[i]);
        }
    }
    return arrived;
}

/** Pure: the height in px a row of `height` px opens from, or null when it opens from nothing (it is no taller than the cap). */
export function arrivalFrom(height: number): number | null {
    return height > ARRIVAL_CAP_PX ? Math.round(height - ARRIVAL_CAP_PX) : null;
}
