// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The float folded into Sprout is a see-through window larger than what it draws. A click on the see-through part
// must reach the app behind, so the window ignores the cursor unless it is over a drawn element
// (miniclickthrough.ts polls the cursor and asks this), and the hover card opens only on a cursor that rests on Sprout.
// Pure.

export interface Point {
    x: number;
    y: number;
}

// a DOMRect fits
export interface Box {
    left: number;
    top: number;
    right: number;
    bottom: number;
}

export function hitAny(p: Point, boxes: readonly Box[]): boolean {
    return boxes.some((b) => p.x >= b.left && p.x < b.right && p.y >= b.top && p.y < b.bottom);
}

// The cursor as the page's CSS pixels. Windows reports the cursor and the window in one space of physical pixels. macOS
// does not: tao makes the cursor's "physical" pixels from points with the primary monitor's scale and the window's
// with the window's own, so on a second monitor of another scale only points line up, and a point is a CSS pixel.
export function toPagePoint(
    cursor: Point,
    inner: Point,
    scales: { cursor: number; window: number },
    mac: boolean
): Point {
    if (mac) {
        return {
            x: cursor.x / scales.cursor - inner.x / scales.window,
            y: cursor.y / scales.cursor - inner.y / scales.window,
        };
    }
    return { x: (cursor.x - inner.x) / scales.window, y: (cursor.y - inner.y) / scales.window };
}

// the cursor rests on Sprout this long before the hover card opens, so one passing over it to the app behind opens nothing
export const HOVER_ENTER_MS = 250;
// the card stays this long after the cursor leaves Sprout and the card, so the cursor can travel to it
export const HOVER_LEAVE_MS = 200;

export interface HoverState {
    shown: boolean;
    // when the cursor came onto Sprout with the card closed, or left both with it open; null while neither waits
    since: number | null;
    // a click on Sprout closed the card: a cursor still resting on it opens nothing until it has left
    dismissed?: boolean;
}

export const HOVER_NONE: HoverState = { shown: false, since: null };
export const HOVER_DISMISSED: HoverState = { shown: false, since: null, dismissed: true };

// One poll's step: over is the cursor on Sprout, or on the card while it shows.
export function nextHover(prev: HoverState, over: boolean, now: number): HoverState {
    if (prev.dismissed) {
        return over ? prev : HOVER_NONE;
    }
    if (over === prev.shown) {
        return prev.since == null ? prev : { shown: prev.shown, since: null };
    }
    const since = prev.since ?? now;
    const wait = over ? HOVER_ENTER_MS : HOVER_LEAVE_MS;
    return now - since >= wait ? { shown: over, since: null } : { shown: prev.shown, since };
}
