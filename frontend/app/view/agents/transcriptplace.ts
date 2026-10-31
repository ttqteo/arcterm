// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Where the reader left each transcript, for as long as the app runs, so a transcript that unmounts (a sleeping agent's
// when another agent takes the view, an ended session's when another one opens) comes back to it instead of the end.
// A place is the item at the top of the view and how far into it, not a scrollTop: a transcript draws only its last
// items when it mounts (compactwindow.ts), so a pixel offset would land on another message. A transcript read to its
// end has no place and opens at the end, as before. The caller picks the id; CompactTranscript keeps and restores.

export interface TranscriptPlace {
    key: number; // the key of the item at the top of the view (compactwindow.ts keyFor)
    offset: number; // how far the top of the view is below that item's top, in px
}

export const PLACE_CAP = 100;

const places = new Map<string, TranscriptPlace>();

export function transcriptPlace(id: string): TranscriptPlace | undefined {
    return places.get(id);
}

// null forgets it. The map keeps the order places were kept in, so past the cap the one kept longest ago goes.
export function keepTranscriptPlace(id: string, place: TranscriptPlace | null): void {
    places.delete(id);
    if (place == null) {
        return;
    }
    places.set(id, place);
    if (places.size > PLACE_CAP) {
        places.delete(places.keys().next().value);
    }
}

/** Pure: the first of `count` items, drawn top to bottom, whose bottom edge is below `viewTop`; `count` when none is.
 *  A binary search, so a scroll reads a handful of rects rather than every drawn item's. */
export function firstItemBelow(count: number, bottomOf: (i: number) => number, viewTop: number): number {
    let lo = 0;
    let hi = count;
    while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (bottomOf(mid) > viewTop) {
            hi = mid;
        } else {
            lo = mid + 1;
        }
    }
    return lo;
}
