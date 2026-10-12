// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Spider-Man's teleport (petteleport.ts draws Sprout's and the Minion's): departing, he shoots a strand up and out and
// is yanked along it out of sight; arriving, a strand drops and he swings in down it to where he stands. It lasts what
// the teleport lasts (TELEPORT_MS), so teleportstore.ts and the fold's timing do not know which one plays. The body is
// SPIDEY_SWING, moved in whole cells; the strand is cells in --color-spidey-web. Pure: the frame at a time;
// petteleportsvg.tsx draws it.

import { TELEPORT_MS, type TeleportKind } from "./petteleport";

export const WEB_TOKEN = "--color-spidey-web";

// a cell on the pet's grid; x and y may fall outside its 16x16
export interface WebCell {
    x: number;
    y: number;
}

export interface WebSwingFrame {
    // where the body is drawn, in whole cells from where he stands, and how much of it shows
    pet: { dx: number; dy: number; opacity: number };
    // the strand, from his hand to where it is stuck; empty when none is drawn
    strand: WebCell[];
}

// where the strand sticks: up and out to the right, off the pet's box
export const ANCHOR: WebCell = { x: 14, y: -14 };
// SPIDEY_SWING's raised hand
export const HANDS: WebCell = { x: 10, y: 0 };
// where an arriving swing comes from, in cells from where he lands: up and to the left
export const SWING_FROM = { dx: -12, dy: -10 };
// how long the strand takes to shoot out or drop
export const SHOOT_MS = 120;
// a departing body fades over the last part of its pull
const FADE_FROM = 0.6;

const clamp01 = (k: number) => Math.min(1, Math.max(0, k));
const easeIn = (k: number) => k * k;
const easeOut = (k: number) => 1 - (1 - k) * (1 - k);
const lerp = (a: number, b: number, k: number) => Math.round(a + (b - a) * k);
const at = (p: WebCell, dx: number, dy: number): WebCell => ({ x: p.x + dx, y: p.y + dy });

/** The cells of a 1-cell strand from `a` to `b`, both included, each touching the last (Bresenham's line). */
export function strandCells(a: WebCell, b: WebCell): WebCell[] {
    const out: WebCell[] = [];
    let { x, y } = a;
    const dx = Math.abs(b.x - x);
    const dy = -Math.abs(b.y - y);
    const sx = x < b.x ? 1 : -1;
    const sy = y < b.y ? 1 : -1;
    let err = dx + dy;
    for (;;) {
        out.push({ x, y });
        if (x === b.x && y === b.y) {
            return out;
        }
        const e2 = 2 * err;
        if (e2 >= dy) {
            err += dy;
            x += sx;
        }
        if (e2 <= dx) {
            err += dx;
            y += sy;
        }
    }
}

function depart(t: number): WebSwingFrame {
    if (t < SHOOT_MS) {
        const k = t / SHOOT_MS;
        const tip = { x: lerp(HANDS.x, ANCHOR.x, k), y: lerp(HANDS.y, ANCHOR.y, k) };
        return { pet: { dx: 0, dy: 0, opacity: 1 }, strand: strandCells(HANDS, tip) };
    }
    const k = clamp01((t - SHOOT_MS) / (TELEPORT_MS.depart - SHOOT_MS));
    if (k >= 1) {
        return { pet: { dx: ANCHOR.x - HANDS.x, dy: ANCHOR.y - HANDS.y, opacity: 0 }, strand: [] };
    }
    // pulled up the strand, faster as he goes
    const dx = lerp(0, ANCHOR.x - HANDS.x, easeIn(k));
    const dy = lerp(0, ANCHOR.y - HANDS.y, easeIn(k));
    const opacity = k < FADE_FROM ? 1 : 1 - (k - FADE_FROM) / (1 - FADE_FROM);
    return { pet: { dx, dy, opacity }, strand: strandCells(at(HANDS, dx, dy), ANCHOR) };
}

function arrive(t: number): WebSwingFrame {
    const from = at(HANDS, SWING_FROM.dx, SWING_FROM.dy);
    if (t < SHOOT_MS) {
        const k = t / SHOOT_MS;
        const tip = { x: lerp(ANCHOR.x, from.x, k), y: lerp(ANCHOR.y, from.y, k) };
        return { pet: { dx: SWING_FROM.dx, dy: SWING_FROM.dy, opacity: 0 }, strand: strandCells(ANCHOR, tip) };
    }
    const k = clamp01((t - SHOOT_MS) / (TELEPORT_MS.arrive - SHOOT_MS));
    if (k >= 1) {
        return { pet: { dx: 0, dy: 0, opacity: 1 }, strand: [] };
    }
    // a pendulum's arc: he drops first and comes across last, rather than sliding in a line
    const dx = lerp(SWING_FROM.dx, 0, easeIn(k));
    const dy = lerp(SWING_FROM.dy, 0, easeOut(k));
    return { pet: { dx, dy, opacity: 1 }, strand: strandCells(at(HANDS, dx, dy), ANCHOR) };
}

/** The web-swing t ms after it began. */
export function webSwingFrame(kind: TeleportKind, t: number): WebSwingFrame {
    const a = Math.max(0, t);
    return kind === "depart" ? depart(a) : arrive(a);
}
