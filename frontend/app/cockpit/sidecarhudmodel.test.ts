// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { bracketPath, HUD_GLOW_HALO, HUD_GLOW_OPACITY, tickLines, type BracketCorner } from "./sidecarhudmodel";

/** The points an absolute M / H / V path visits, in order (the only commands `bracketPath` draws). */
function pathPoints(d: string): { x: number; y: number }[] {
    const pts: { x: number; y: number }[] = [];
    let x = 0;
    let y = 0;
    for (const m of d.matchAll(/([MHV])([^MHV]*)/g)) {
        const nums = m[2]
            .split(/[ ,]+/)
            .filter((s) => s !== "")
            .map(Number);
        if (m[1] === "M") {
            [x, y] = nums;
        } else if (m[1] === "H") {
            x = nums[0];
        } else {
            y = nums[0];
        }
        pts.push({ x, y });
    }
    return pts;
}

describe("glow constants", () => {
    it("draws the halo four times the core's width at 22% opacity", () => {
        expect(HUD_GLOW_HALO).toBe(4);
        expect(HUD_GLOW_OPACITY).toBe(0.22);
    });
});

describe("tickLines", () => {
    const CX = 230;
    const CY = 220;
    const R = 208;

    it("returns `count` ticks", () => {
        expect(tickLines(CX, CY, R, 120, 10, 4, 7)).toHaveLength(120);
        expect(tickLines(CX, CY, R, 60, 5, 3, 5)).toHaveLength(60);
        expect(tickLines(CX, CY, R, 0, 5, 3, 5)).toEqual([]);
    });

    it("starts at 12 o'clock, pointing inward", () => {
        const [first] = tickLines(CX, CY, R, 120, 10, 4, 7);
        expect(first.x1).toBeCloseTo(CX, 9);
        expect(first.y1).toBeCloseTo(CY - R, 9);
        expect(first.x2).toBeCloseTo(CX, 9);
        expect(first.y2).toBeCloseTo(CY - R + 7, 9);
    });

    it("goes clockwise: a quarter of the way round is 3 o'clock", () => {
        const ticks = tickLines(CX, CY, R, 120, 10, 4, 7);
        expect(ticks[30].x1).toBeCloseTo(CX + R, 9);
        expect(ticks[30].y1).toBeCloseTo(CY, 9);
        expect(ticks[60].x1).toBeCloseTo(CX, 9);
        expect(ticks[60].y1).toBeCloseTo(CY + R, 9);
        expect(ticks[90].x1).toBeCloseTo(CX - R, 9);
    });

    it("makes every majorEvery-th tick major and majorLen long, the rest minorLen", () => {
        const ticks = tickLines(CX, CY, R, 120, 10, 4, 7);
        ticks.forEach((t, i) => {
            const major = i % 10 === 0;
            expect(t.major).toBe(major);
            expect(Math.hypot(t.x2 - t.x1, t.y2 - t.y1)).toBeCloseTo(major ? 7 : 4, 9);
        });
        expect(ticks.filter((t) => t.major)).toHaveLength(12);
    });

    it("puts every tick's outer end on radius r and its inner end inward on the same ray", () => {
        for (const t of tickLines(CX, CY, R, 60, 5, 3, 5)) {
            const len = t.major ? 5 : 3;
            expect(Math.hypot(t.x1 - CX, t.y1 - CY)).toBeCloseTo(R, 9);
            expect(Math.hypot(t.x2 - CX, t.y2 - CY)).toBeCloseTo(R - len, 9);
            // the same ray: the cross product of the two radii is zero
            expect((t.x1 - CX) * (t.y2 - CY) - (t.y1 - CY) * (t.x2 - CX)).toBeCloseTo(0, 6);
        }
    });

    it("spaces the ticks 360 / count degrees apart", () => {
        const ticks = tickLines(0, 0, 100, 60, 5, 3, 5);
        const turn = 2 * Math.PI;
        for (let i = 1; i < ticks.length; i++) {
            // atan2 wraps from pi to -pi past 6 o'clock, so compare the gap modulo a full turn
            const a = Math.atan2(ticks[i - 1].x1, -ticks[i - 1].y1);
            const b = Math.atan2(ticks[i].x1, -ticks[i].y1);
            expect((((b - a) % turn) + turn) % turn).toBeCloseTo(turn / 60, 9);
        }
    });
});

describe("bracketPath", () => {
    const SIZE = 14;
    const INSET = 1;
    // each corner's two edges, as the line the path's two ends lie on (x = ... for a vertical edge, y = ... for a horizontal one)
    const edges: Record<BracketCorner, { vertical: number; horizontal: number }> = {
        tl: { vertical: INSET, horizontal: INSET },
        tr: { vertical: SIZE - INSET, horizontal: INSET },
        br: { vertical: SIZE - INSET, horizontal: SIZE - INSET },
        bl: { vertical: INSET, horizontal: SIZE - INSET },
    };

    for (const corner of ["tl", "tr", "br", "bl"] as const) {
        it(`${corner}: runs along the corner's two edges and meets at the corner`, () => {
            const pts = pathPoints(bracketPath(SIZE, corner));
            expect(pts).toHaveLength(3);
            const { vertical, horizontal } = edges[corner];
            const [start, mid, end] = pts;
            // the elbow sits on both edges
            expect(mid).toEqual({ x: vertical, y: horizontal });
            // one arm runs along the vertical edge, the other along the horizontal one
            const startOnVertical = start.x === vertical;
            const endOnHorizontal = end.y === horizontal;
            const startOnHorizontal = start.y === horizontal;
            const endOnVertical = end.x === vertical;
            expect((startOnVertical && endOnHorizontal) || (startOnHorizontal && endOnVertical)).toBe(true);
            // both arms leave the elbow into the box, 13 long, never past it
            for (const p of [start, end]) {
                expect(Math.abs(p.x - mid.x) + Math.abs(p.y - mid.y)).toBe(SIZE - INSET);
                expect(p.x).toBeGreaterThanOrEqual(0);
                expect(p.x).toBeLessThanOrEqual(SIZE);
                expect(p.y).toBeGreaterThanOrEqual(0);
                expect(p.y).toBeLessThanOrEqual(SIZE);
            }
        });
    }

    it("matches board A's top-left bracket (M1,14 V1 H14)", () => {
        expect(pathPoints(bracketPath(14, "tl"))).toEqual([
            { x: 1, y: 14 },
            { x: 1, y: 1 },
            { x: 14, y: 1 },
        ]);
    });

    it("takes a size and an inset", () => {
        const pts = pathPoints(bracketPath(10, "br", 2));
        expect(pts[1]).toEqual({ x: 8, y: 8 });
        expect(pts[0]).toEqual({ x: 8, y: 0 });
        expect(pts[2]).toEqual({ x: 0, y: 8 });
    });

    it("defaults the inset to 1, so a 1.5 px stroke stays inside the box", () => {
        expect(bracketPath(14, "tr")).toBe(bracketPath(14, "tr", 1));
    });
});
