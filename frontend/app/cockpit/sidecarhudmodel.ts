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
 * The `d` of one corner bracket in a `size` x `size` box: its elbow sits `inset` in from the box's corner (1, so a
 * 1.5 px stroke stays inside the box), and its two arms run along the corner's two edges to the box's other sides.
 * `tl` is board A's `M1,14V1H14` at size 14.
 *
 * With a `radius` the elbow bends: an SVG arc of that radius (an `A` command, clockwise) joins the two arms, so the
 * bracket follows a box with rounded corners. `radius` is the arc's own radius, so the caller gives the box's radius less
 * the inset; it is clamped to what fits (`size - inset`, where the arms shrink to nothing). A radius of 0, the default,
 * is the right-angle path.
 */
export function bracketPath(size: number, corner: BracketCorner, inset = 1, radius = 0): string {
    const far = size - inset;
    const r = Math.min(Math.max(radius, 0), far);
    if (r === 0) {
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
    // each arc runs from one edge to the other round the corner, a quarter turn clockwise on screen (sweep 1)
    const arc = (x: number, y: number) => `A${r},${r},0,0,1,${x},${y}`;
    switch (corner) {
        case "tl":
            return `M${inset},${size}V${inset + r}${arc(inset + r, inset)}H${size}`;
        case "tr":
            return `M0,${inset}H${far - r}${arc(far, inset + r)}V${size}`;
        case "br":
            return `M${far},0V${far - r}${arc(far - r, far)}H0`;
        case "bl":
            return `M${size},${far}H${inset + r}${arc(inset, far - r)}V0`;
    }
}
