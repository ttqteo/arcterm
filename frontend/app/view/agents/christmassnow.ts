// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The Christmas snow's pure model: how many flakes a window holds, one step of a flake, and the rule that draws a
// flake over a terminal at half its opacity so the log under it stays readable. christmassnowview.tsx paints it.

/** One snowflake, in CSS pixels of the window. */
export interface Flake {
    x: number;
    y: number;
    /** radius: 0.5 to 1, so a flake is 1 to 2 px across */
    r: number;
    /** fall speed, px/s */
    vy: number;
    /** steady sideways drift, px/s */
    vx: number;
    /** phase of the slight sway, radians */
    phase: number;
    /** opacity before the terminal rule: faint, since flakes cross text */
    alpha: number;
}

/** A rectangle in window coordinates; a DOMRect is one. */
export interface SnowRect {
    left: number;
    top: number;
    right: number;
    bottom: number;
}

/** The most flakes a window holds, however large. */
export const SNOW_MAX = 120;

// One flake per this many square pixels: 90 over the spike's 1200x720 window, the density it settled on.
const AREA_PER_FLAKE = 9_600;
// The sway's amplitude (px/s) and period scale (ms per radian).
const SWAY = 6;
const SWAY_MS = 900;

/** How many flakes a window of this size holds: by area, at most SNOW_MAX. */
export function flakeCount(width: number, height: number): number {
    if (!(width > 0) || !(height > 0)) {
        return 0;
    }
    return Math.min(SNOW_MAX, Math.round((width * height) / AREA_PER_FLAKE));
}

function newFlake(width: number, height: number, rand: () => number): Flake {
    return {
        x: rand() * width,
        y: rand() * height,
        r: 0.5 + rand() * 0.5,
        vy: 14 + rand() * 18,
        vx: rand() * 8 - 4,
        phase: rand() * Math.PI * 2,
        alpha: 0.35 + rand() * 0.25,
    };
}

/** The flakes for a window of this size, scattered over all of it. */
export function makeFlakes(width: number, height: number, rand: () => number = Math.random): Flake[] {
    const n = flakeCount(width, height);
    const flakes: Flake[] = [];
    for (let i = 0; i < n; i++) {
        flakes.push(newFlake(width, height, rand));
    }
    return flakes;
}

function wrap(v: number, size: number): number {
    return ((v % size) + size) % size;
}

/**
 * The flake `dt` seconds later at time `t` (ms): it falls and drifts with a slight sway. One that passes the bottom
 * comes back in at the top at a new x; one that leaves a side comes back in at the other, so it stays in the window.
 */
export function stepFlake(
    f: Flake,
    dt: number,
    t: number,
    width: number,
    height: number,
    rand: () => number = Math.random
): Flake {
    const y = f.y + f.vy * dt;
    const x = f.x + (f.vx + Math.sin(t / SWAY_MS + f.phase) * SWAY) * dt;
    if (y >= height) {
        return { ...f, y: wrap(y, height), x: rand() * width };
    }
    return { ...f, y, x: wrap(x, width) };
}

/** A flake's opacity: `base`, halved when the point lies in any of the rects (a rect's edge counts as inside). */
export function flakeAlpha(x: number, y: number, base: number, rects: readonly SnowRect[]): number {
    for (const r of rects) {
        if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) {
            return base / 2;
        }
    }
    return base;
}
