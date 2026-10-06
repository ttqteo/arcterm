// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The rect arithmetic behind where Sprout walks (sprout spec §3). Pure: petview.tsx reads the boxes off the
// page and hands them in, so the rules — which ledge element wins, how far it runs, which terminals count —
// are testable without a DOM.

import { PET_PX } from "./petsprite";
import type { PetCorner } from "./petstore";

export interface Box {
    left: number;
    right: number;
    top: number;
    bottom: number;
}

export interface MeasuredLedge {
    // the y the sprite's bottom row stands on
    top: number;
    left: number;
    right: number;
}

// The ledge stops this far short of the window's right edge.
export const LEDGE_RIGHT_INSET_PX = 8;

// A terminal or composer counts when its box comes within this far above the ledge.
export const AVOID_REACH_PX = 80;

// Zero-size boxes are elements that are not shown (a hidden pane, an unmounted surface's leftovers).
function shown(b: Box): boolean {
    return b.right - b.left > 0 && b.bottom - b.top > 0;
}

/** The lowest shown ledge element's box, or null when none is shown. */
export function lowestLedge(boxes: readonly Box[]): Box | null {
    let best: Box | null = null;
    for (const b of boxes) {
        if (shown(b) && (best == null || b.top > best.top)) {
            best = b;
        }
    }
    return best;
}

/**
 * The ledge: the top of the lowest shown `[data-pet-ledge]` box (the window's bottom when there is none),
 * running from the nav rail's right edge (0 without one) to the window's right edge less 8 px — and never
 * past the ledge box's own ends. The footer spans the window, but the Cockpit's HintsBar stops at the
 * Cockpit rail, and a creature walking past its end would stand on nothing.
 */
export function measureLedge(
    ledgeBoxes: readonly Box[],
    navRight: number | null,
    viewport: { width: number; height: number }
): MeasuredLedge {
    const lowest = lowestLedge(ledgeBoxes);
    const left = navRight ?? 0;
    const right = viewport.width - LEDGE_RIGHT_INSET_PX;
    if (lowest == null) {
        return { top: viewport.height, left, right };
    }
    return { top: lowest.top, left: Math.max(left, lowest.left), right: Math.min(right, lowest.right) };
}

/**
 * The horizontal spans of the shown boxes (every `.xterm` and `[data-pet-avoid]`) that come within 80 px above
 * the ledge: a box whose bottom is below `top - 80` and whose top is above the ledge.
 */
export function avoidSpans(boxes: readonly Box[], top: number): [number, number][] {
    return boxes
        .filter((b) => shown(b) && b.top < top && b.bottom > top - AVOID_REACH_PX)
        .map((b): [number, number] => [b.left, b.right]);
}

/** Which side the bubble and peek open from: the half of the window the creature's centre is in. */
export function cornerFor(x: number, viewportWidth: number): PetCorner {
    return x + PET_PX / 2 < viewportWidth / 2 ? "bottom-left" : "bottom-right";
}
