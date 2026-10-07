// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// How Sprout comes back to the ledge when it is not standing on it: dropped from a drag, or left in the air (or
// sunk into the bar) when the ledge under it moves on a surface switch. Pure — petview.tsx plays what comes back
// through motion. Every offset is the px the sprite is drawn below where it rests: negative is above the ledge.
//
// It falls rather than glides, so it reads as a creature with weight: under gravity, accelerating, and the
// landing bounces it one cell. A ledge that rose under it is a hop up instead. Neither scales the sprite, which
// would no longer stand on the ledge and would smear its cells (sprout spec §3).

import { PET_CELL_PX } from "./petsprite";

// px/s². 160 px (the CDP drag's height) falls in about 0.28 s.
export const GRAVITY_PX_S2 = 4000;
export const MIN_FALL_S = 0.1;
export const MAX_FALL_S = 0.45;

// the landing's bounce, and how far a hop up overshoots the ledge before settling: one cell
export const BOUNCE_PX = PET_CELL_PX;
const BOUNCE_S = 0.07;
const RISE_S = 0.1;
const SETTLE_S = 0.08;

export type Ease = "easeIn" | "easeOut";

export interface Landing {
    // keyframes for the sprite's y offset, the first being where it starts
    y: number[];
    // each keyframe's place in the duration, 0..1
    times: number[];
    // one per segment between keyframes
    ease: Ease[];
    // seconds
    duration: number;
}

/** The seconds a fall of `px` takes under GRAVITY_PX_S2, clamped to MIN_FALL_S..MAX_FALL_S. */
export function fallSeconds(px: number): number {
    const t = Math.sqrt((2 * Math.abs(px)) / GRAVITY_PX_S2);
    return Math.min(MAX_FALL_S, Math.max(MIN_FALL_S, t));
}

export interface LedgeAt {
    // the ledge's y, viewport px
    top: number;
    // the window's height when it was measured
    vh: number;
}

/**
 * Where the sprite starts after the ledge moved from `prev` to `next`, so it is drawn where it stood a moment ago
 * and comes to the new ledge from there. Only a change in the ledge's distance from the window's bottom counts (the
 * bar under it grew, shrank or went away): a resize moves the ledge and the bottom together, and the creature
 * moves with the window rather than falling through it. 0 at boot and for sub-pixel layout jitter.
 */
export function ledgeShift(prev: LedgeAt | null, next: LedgeAt): number {
    if (prev == null) {
        return 0;
    }
    const d = next.vh - next.top - (prev.vh - prev.top);
    return Math.abs(d) < 1 ? 0 : Math.round(d);
}

/** The way back to the ledge from `offset` px below it (negative: above), or null when it is already there. */
export function landing(offset: number): Landing | null {
    if (Math.abs(offset) < 1) {
        return null;
    }
    if (offset < 0) {
        const fall = fallSeconds(offset);
        const duration = fall + 2 * BOUNCE_S;
        return {
            y: [offset, 0, -BOUNCE_PX, 0],
            times: [0, fall / duration, (fall + BOUNCE_S) / duration, 1],
            ease: ["easeIn", "easeOut", "easeIn"],
            duration,
        };
    }
    const duration = RISE_S + SETTLE_S;
    return {
        y: [offset, -BOUNCE_PX, 0],
        times: [0, RISE_S / duration, 1],
        ease: ["easeOut", "easeIn"],
        duration,
    };
}
