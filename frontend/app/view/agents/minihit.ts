// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The float folded into Sprout is a see-through window larger than what it draws. A click on the see-through part
// must reach the app behind, so the window ignores the cursor unless it is over a drawn element
// (miniclickthrough.ts polls the cursor and asks this). Pure.

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

// the cursor, in the screen's physical pixels, as the page's CSS pixels
export function toPagePoint(cursor: Point, inner: Point, scale: number): Point {
    return { x: (cursor.x - inner.x) / scale, y: (cursor.y - inner.y) / scale };
}
