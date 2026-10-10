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
