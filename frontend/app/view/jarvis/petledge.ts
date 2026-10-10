// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The rect arithmetic behind where Sprout walks (sprout spec §3). Pure: petview.tsx reads the boxes off the
// page and hands them in, so the rules — which ledge element wins, how far it runs, which terminals count —
// are testable without a DOM.

import { PET_PX } from "./petsprite";

// The side the bubble and peek open from (petbubble.tsx, petpeek.tsx), derived from where the creature is.
export type PetCorner = "bottom-right" | "bottom-left";

export interface Box {
    left: number;
    right: number;
    top: number;
    bottom: number;
}

// A ledge element's box, and whether the ledge holds the whole sprite (Float's, cockpit/float-ledge.tsx): the sprite
// stands inside it rather than on its top edge, and nothing above it is in its way.
export interface LedgeBox extends Box {
    holds?: boolean;
}

export interface MeasuredLedge {
    // the y the sprite's bottom row stands on
    top: number;
    left: number;
    right: number;
    // the ledge holds the sprite, so there is nothing to avoid (avoidSpans does not apply)
    holds: boolean;
}

// The ledge stops this far short of the window's right edge.
export const LEDGE_RIGHT_INSET_PX = 8;

// A ledge that holds the sprite stands it this far above its bottom.
export const LEDGE_HOLD_PAD_PX = 2;

// A terminal or composer counts when its box comes within this far above the ledge.
export const AVOID_REACH_PX = 80;

// Zero-size boxes are elements that are not shown (a hidden pane, an unmounted surface's leftovers).
function shown(b: Box): boolean {
    return b.right - b.left > 0 && b.bottom - b.top > 0;
}

/** The lowest shown ledge element's box, or null when none is shown. */
export function lowestLedge<B extends Box>(boxes: readonly B[]): B | null {
    let best: B | null = null;
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
 * Cockpit rail, and a creature walking past its end would stand on nothing. A ledge that holds the sprite (`holds`)
 * stands it inside, LEDGE_HOLD_PAD_PX above its bottom.
 */
export function measureLedge(
    ledgeBoxes: readonly LedgeBox[],
    navRight: number | null,
    viewport: { width: number; height: number }
): MeasuredLedge {
    const lowest = lowestLedge(ledgeBoxes);
    const left = navRight ?? 0;
    const right = viewport.width - LEDGE_RIGHT_INSET_PX;
    if (lowest == null) {
        return { top: viewport.height, left, right, holds: false };
    }
    const holds = lowest.holds === true;
    return {
        top: holds ? lowest.bottom - LEDGE_HOLD_PAD_PX : lowest.top,
        left: Math.max(left, lowest.left),
        right: Math.min(right, lowest.right),
        holds,
    };
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
