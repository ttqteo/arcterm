// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The teleport the pet plays when the window folds into it and back (jarvis modes spec): departing, it turns to light
// on a ring and is pulled up into a beam; arriving, a beam drops, the ring opens under it, and it lands stretched,
// squashes and settles. Drawn on the pet's own cell grid in the --color-teleport-* tokens, so it stays pixel art, for
// Sprout and the Minion alike. Pure: the frame at a time; petteleportsvg.tsx draws it, teleportstore.ts runs it.

import { PET_GRID } from "./petsprite";

export type TeleportKind = "depart" | "arrive";
export type TeleportToken = "--color-teleport-deep" | "--color-teleport" | "--color-teleport-soft";

// in grid cells, like petsprite.ts PetCell; x and y may fall outside the pose's 16x16
export interface TeleportCell {
    x: number;
    y: number;
    token: TeleportToken;
    opacity?: number;
}

export interface TeleportFrame {
    // scaled from its middle, along the ground only
    ring: { scaleX: number; opacity: number };
    // grows up from the ground on a departure and drops from the sky on an arrival
    beam: { scaleX: number; scaleY: number; opacity: number; from: "ground" | "sky" };
    // scaled from its feet; light is how much of it is drawn in --color-teleport-soft over its own colours
    pet: { scaleX: number; scaleY: number; opacity: number; light: number };
    sparks: TeleportCell[];
}

// the row the feet stand on
export const FEET = PET_GRID - 1;

// how long each plays; a departure leaves the pet gone, an arrival on the plain pet
export const TELEPORT_MS: Record<TeleportKind, number> = { depart: 360, arrive: 480 };

const RISE = [
    { x: 3, rise: 9 },
    { x: 12, rise: 11 },
    { x: 6, rise: 13 },
    { x: 9, rise: 10 },
    { x: 1, rise: 7 },
    { x: 14, rise: 8 },
];
const RISE_FROM = 180;
const RISE_EVERY = 30;
const RISE_MS = 220;

const BURST = [
    { x: 3, dx: -4, dy: -5 },
    { x: 12, dx: 4, dy: -5 },
    { x: 5, dx: -3, dy: -9 },
    { x: 10, dx: 3, dy: -9 },
    { x: 7, dx: -1, dy: -12 },
    { x: 8, dx: 1, dy: -11 },
    { x: 1, dx: -2, dy: -2 },
    { x: 14, dx: 2, dy: -2 },
];
const BURST_FROM = 250;
const BURST_EVERY = 15;
const BURST_MS = 230;

// when the last spark has faded, a little past TELEPORT_MS: the clock that draws it runs until then
export const TELEPORT_TAIL_MS: Record<TeleportKind, number> = {
    depart: RISE_FROM + (RISE.length - 1) * RISE_EVERY + RISE_MS,
    arrive: BURST_FROM + (BURST.length - 1) * BURST_EVERY + BURST_MS,
};

// The ring on the ground: a 14x3 pixel ellipse round the feet, its back arc drawn behind the pet and its front arc
// before it, listed in the order a bright head runs round it.
const RING: { x: number; y: number; front: boolean }[] = [];
for (let x = 12; x >= 3; x--) {
    RING.push({ x, y: FEET - 1, front: false });
}
RING.push({ x: 2, y: FEET, front: false }, { x: 1, y: FEET, front: false });
for (let x = 3; x <= 12; x++) {
    RING.push({ x, y: FEET + 1, front: true });
}
RING.push({ x: 13, y: FEET, front: false }, { x: 14, y: FEET, front: false });
// the head moves one cell this often, so it runs round about four times a teleport
const CHASE_MS = 16;
const TAIL_CELLS = 3;

export function ringCells(t: number): { back: TeleportCell[]; front: TeleportCell[] } {
    const n = RING.length;
    const head = Math.floor(Math.max(0, t) / CHASE_MS) % n;
    const back: TeleportCell[] = [];
    const front: TeleportCell[] = [];
    RING.forEach((r, i) => {
        const behind = (head - i + n) % n;
        const token: TeleportToken =
            behind === 0
                ? "--color-teleport-soft"
                : behind <= TAIL_CELLS
                  ? "--color-teleport"
                  : "--color-teleport-deep";
        (r.front ? front : back).push({ x: r.x, y: r.y, token });
    });
    return { back, front };
}

// the ground inside the ring, faint under the feet
export const DISC_CELLS: TeleportCell[] = Array.from({ length: 10 }, (_, i) => ({
    x: 3 + i,
    y: FEET,
    token: "--color-teleport",
    opacity: 0.3,
}));

// four cells wide, from the top of the grid to the feet: a bright core between two edges
export const BEAM_CELLS: TeleportCell[] = [];
for (let y = 1; y <= FEET; y++) {
    for (let x = 6; x <= 9; x++) {
        BEAM_CELLS.push({ x, y, token: x === 6 || x === 9 ? "--color-teleport" : "--color-teleport-soft" });
    }
}

// how far t is from a to b, 0 to 1
function seg(t: number, a: number, b: number): number {
    return t <= a ? 0 : t >= b ? 1 : (t - a) / (b - a);
}

// close to MOTION.easeFluid's ease-out
function easeOut(p: number): number {
    return 1 - Math.pow(1 - p, 4);
}

function easeIn(p: number): number {
    return p * p * p;
}

function spark(x: number, y: number, opacity: number, i: number): TeleportCell {
    return {
        x: Math.round(x),
        y: Math.round(y),
        token: i % 2 === 0 ? "--color-teleport" : "--color-teleport-soft",
        opacity,
    };
}

function depart(t: number): TeleportFrame {
    const pull = easeIn(seg(t, 160, 300));
    const sparks: TeleportCell[] = [];
    RISE.forEach((r, i) => {
        const p = seg(t, RISE_FROM + i * RISE_EVERY, RISE_FROM + i * RISE_EVERY + RISE_MS);
        if (p > 0 && p < 1) {
            sparks.push(spark(r.x, FEET - r.rise * easeOut(p), 1 - p, i));
        }
    });
    return {
        ring: { scaleX: 0.3 + 0.7 * easeOut(seg(t, 0, 100)), opacity: seg(t, 0, 60) * (1 - seg(t, 280, 360)) },
        beam: {
            scaleX: 1 - seg(t, 260, 360),
            scaleY: easeOut(seg(t, 120, 220)),
            opacity: seg(t, 120, 160) * (1 - seg(t, 280, 360)),
            from: "ground",
        },
        pet: { scaleX: 1 - 0.9 * pull, scaleY: 1 + 0.5 * pull, opacity: 1 - seg(t, 250, 300), light: seg(t, 60, 160) },
        sparks,
    };
}

function arrive(t: number): TeleportFrame {
    // stretched thin as it lands, squashed wide at 250ms, settled by 340ms
    const land = easeOut(seg(t, 110, 250));
    const settle = seg(t, 250, 340);
    const sparks: TeleportCell[] = [];
    BURST.forEach((b, i) => {
        const p = seg(t, BURST_FROM + i * BURST_EVERY, BURST_FROM + i * BURST_EVERY + BURST_MS);
        if (p > 0 && p < 1) {
            sparks.push(spark(b.x + b.dx * easeOut(p), FEET + b.dy * easeOut(p), 1 - p, i));
        }
    });
    return {
        ring: {
            scaleX: 0.3 + 0.7 * easeOut(seg(t, 60, 180)) + 0.15 * seg(t, 380, 480),
            opacity: seg(t, 60, 120) * (1 - seg(t, 380, 480)),
        },
        beam: {
            scaleX: 1 - seg(t, 220, 340),
            scaleY: easeOut(seg(t, 0, 110)),
            opacity: seg(t, 0, 40) * (1 - seg(t, 260, 340)),
            from: "sky",
        },
        pet: {
            scaleX: t < 250 ? 0.1 + 1.05 * land : 1 + 0.15 * (1 - settle),
            scaleY: t < 250 ? 1.5 - 0.62 * land : 1 - 0.12 * (1 - settle),
            opacity: seg(t, 110, 150),
            light: t < 110 ? 0 : 1 - seg(t, 250, 400),
        },
        sparks,
    };
}

/** The teleport t ms after it began. */
export function teleportFrame(kind: TeleportKind, t: number): TeleportFrame {
    const at = Math.max(0, t);
    return kind === "depart" ? depart(at) : arrive(at);
}
