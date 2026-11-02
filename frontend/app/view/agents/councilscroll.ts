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

// ---- the channel's jumps (Channel, councilchat.tsx): Top, Latest, and Back to the message the reader was on ----

// a row with no more than this much left below the view's top is already read past
export const READ_EDGE_PX = 24;

/** A row of the channel, in the scroller's content (where scrollTop counts from). */
export interface RowBox {
    top: number;
    bottom: number;
}

/** The row the reader is on: the first whose bottom is more than READ_EDGE_PX below the view's top, or -1 with none. */
export function readingRow(rows: RowBox[], viewTop: number): number {
    return rows.findIndex((r) => r.bottom - viewTop > READ_EDGE_PX);
}

/** Where the reader was before a jump: how far the row they were on sat below the view's top (negative when it started
 *  above it), and the scrollTop, the way back when that row is gone. */
export interface ReadingPlace {
    offset: number;
    top: number;
}

/** The scrollTop that puts the reader back on their row as they left it, wherever the rows above it moved; `rowTop` is
 *  where that row is now, or null when it is gone. Clamped to the scroller. */
export function returnTop(place: ReadingPlace, rowTop: number | null, el: Scroller): number {
    const end = Math.max(0, el.scrollHeight - el.clientHeight);
    const top = rowTop == null ? place.top : rowTop - place.offset;
    return Math.min(Math.max(0, top), end);
}

export type Landing = "top" | "latest";

/** Whether the reader is still where the last jump put them: then a second jump keeps the place saved by the first, so
 *  Top then Latest still goes back to where they were reading, not to the top. */
export function stillLanded(landing: Landing | null, el: Scroller): boolean {
    if (landing === "top") {
        return el.scrollTop < NEAR_BOTTOM_PX;
    }
    return landing === "latest" && placeOf(el).bottom;
}

// ---- the glide a jump scrolls with ----

/** How long a jump glides over `distance` px: a short hop quick, a long one a little longer, never past 450ms. */
export function glideMs(distance: number): number {
    return Math.round(Math.min(450, 220 + Math.abs(distance) / 25));
}

/** Where a glide from `from` to `to` is at `t` (0 to 1 of its time): ease-out cubic, fast off the mark and settling. */
export function glideAt(from: number, to: number, t: number): number {
    const k = Math.min(1, Math.max(0, t));
    return from + (to - from) * (1 - Math.pow(1 - k, 3));
}

export interface JumpPills {
    top: boolean;
    latest: boolean;
    back: boolean;
}

export const NO_PILLS: JumpPills = { top: false, latest: false, back: false };

/** Which jumps the channel offers: Top once the reader is more than a screen down, Latest once they left the end, and
 *  Back while a saved place (`backTop`, the scrollTop that returns to it) is more than half a screen away. */
export function jumpPills(el: Scroller, backTop: number | null): JumpPills {
    return {
        top: el.scrollTop > el.clientHeight,
        latest: !placeOf(el).bottom,
        back: backTop != null && Math.abs(el.scrollTop - backTop) > el.clientHeight / 2,
    };
}
