// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Pure: where the reader left each council scroller (the chat's channel, an idea's thread, the Summary), so opening
// another council, the Summary, another agent or another surface and coming back lands where they were, not at the
// newest line or the top. Kept in memory per key (`channel:<council>`, `thread:<council>:<idea>`, `summary:<council>`),
// like a preview's place in codescroll.ts; useKeptScroll (councilchat.tsx) reads and writes it. A reader at the bottom
// is kept as `bottom`, not an offset, so new lines that came meanwhile still show when they return.

export interface ScrollPlace {
    top: number;
    bottom: boolean; // within `NEAR_BOTTOM_PX` of the end: the scroller follows new lines
}

interface Scroller {
    scrollTop: number;
    scrollHeight: number;
    clientHeight: number;
}

export const NEAR_BOTTOM_PX = 80;
const KEPT_PLACES = 60;

const places = new Map<string, ScrollPlace>();

export function keptPlace(key: string): ScrollPlace | undefined {
    return places.get(key);
}

// the newest key last; past the cap the oldest goes
export function keepPlace(key: string, place: ScrollPlace): void {
    places.delete(key);
    places.set(key, place);
    for (const k of places.keys()) {
        if (places.size <= KEPT_PLACES) {
            break;
        }
        places.delete(k);
    }
}

export function placeOf(el: Scroller): ScrollPlace {
    return { top: el.scrollTop, bottom: el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX };
}

/** The scrollTop that puts the reader back: the end for a place at the bottom, else its offset. With no place kept, a
 *  scroller that `follow`s new lines starts at the end and any other at the top. */
export function topFor(place: ScrollPlace | undefined, el: Scroller, follow: boolean): number {
    const end = Math.max(0, el.scrollHeight - el.clientHeight);
    if (place == null) {
        return follow ? end : 0;
    }
    return place.bottom ? end : Math.min(place.top, end);
}

/** Whether new lines keep the scroller at the end: a following scroller the reader has not scrolled up in. */
export function followsEnd(place: ScrollPlace | undefined, follow: boolean): boolean {
    return follow && (place?.bottom ?? true);
}

export function clearKeptPlaces(): void {
    places.clear();
}
