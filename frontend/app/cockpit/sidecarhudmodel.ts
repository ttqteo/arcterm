// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The geometry of Sidecar's HUD skin (spec 2026-11-18-sidecar-hud-design.md), pure, so the parts in sidecarhud.tsx only
// draw: where the ticks of a ring sit, the path of one corner bracket, and how the stacked-stroke glow is built. Nothing
// here reads a snapshot: the decoration it describes never changes, so it never repaints.

/** A glow is two strokes of one shape: a halo this many times the core's width under the core. */
export const HUD_GLOW_HALO = 4;
/** The halo's `stroke-opacity`: faint enough to read as light, not as a second line. */
export const HUD_GLOW_OPACITY = 0.22;

export type TickLine = { x1: number; y1: number; x2: number; y2: number; major: boolean };

/**
 * The ticks of a ring of radius `r` round (`cx`, `cy`): `count` of them, evenly spaced, the first at 12 o'clock and
 * the rest clockwise. Every `majorEvery`-th tick (the first included) is major and `majorLen` long, the others
 * `minorLen`. A tick starts on the ring (`x1`, `y1`) and points inward to (`x2`, `y2`).
 */
export function tickLines(
    cx: number,
    cy: number,
    r: number,
    count: number,
    majorEvery: number,
    minorLen: number,
    majorLen: number
): TickLine[] {
    const ticks: TickLine[] = [];
    for (let i = 0; i < count; i++) {
        const angle = (2 * Math.PI * i) / count;
        const sin = Math.sin(angle);
        const cos = Math.cos(angle);
        const major = majorEvery > 0 && i % majorEvery === 0;
        const inner = r - (major ? majorLen : minorLen);
        ticks.push({ x1: cx + r * sin, y1: cy - r * cos, x2: cx + inner * sin, y2: cy - inner * cos, major });
    }
    return ticks;
}

export type BracketCorner = "tl" | "tr" | "br" | "bl";

/**
 * The `d` of one L-shaped corner bracket in a `size` x `size` box: its elbow sits `inset` in from the box's corner
 * (1, so a 1.5 px stroke stays inside the box), and its two arms run along the corner's two edges to the box's other
 * sides. `tl` is board A's `M1,14V1H14` at size 14.
 */
export function bracketPath(size: number, corner: BracketCorner, inset = 1): string {
    const far = size - inset;
    switch (corner) {
        case "tl":
            return `M${inset},${size}V${inset}H${size}`;
        case "tr":
            return `M0,${inset}H${far}V${size}`;
        case "br":
            return `M${far},0V${far}H0`;
        case "bl":
            return `M${size},${far}H${inset}V0`;
    }
}
