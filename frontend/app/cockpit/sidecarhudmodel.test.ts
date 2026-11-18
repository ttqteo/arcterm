// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { bracketPath, HUD_GLOW_HALO, HUD_GLOW_OPACITY, tickLines, type BracketCorner } from "./sidecarhudmodel";

/** The points an absolute M / H / V / A path visits, in order (the only commands `bracketPath` draws): an arc's point is where it ends. */
function pathPoints(d: string): { x: number; y: number }[] {
    return pathSteps(d).map(({ x, y }) => ({ x, y }));
}

type Step = { cmd: string; x: number; y: number; arc?: { rx: number; ry: number; large: number; sweep: number } };

/** `pathPoints` with each step's command, and an arc's radii and flags. */
function pathSteps(d: string): Step[] {
    const steps: Step[] = [];
    let x = 0;
    let y = 0;
    for (const m of d.matchAll(/([MHVA])([^MHVA]*)/g)) {
        const nums = m[2]
            .split(/[ ,]+/)
            .filter((s) => s !== "")
            .map(Number);
        if (m[1] === "M") {
            [x, y] = nums;
        } else if (m[1] === "H") {
            x = nums[0];
        } else if (m[1] === "V") {
            y = nums[0];
        } else {
            // A rx ry x-axis-rotation large-arc sweep x y
            [x, y] = [nums[5], nums[6]];
            steps.push({ cmd: "A", x, y, arc: { rx: nums[0], ry: nums[1], large: nums[3], sweep: nums[4] } });
            continue;
        }
        steps.push({ cmd: m[1], x, y });
    }
    return steps;
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

describe("bracketPath with a radius", () => {
    const SIZE = 18;
    const INSET = 1;
    const FAR = SIZE - INSET;
    const R = 6;
    // where each corner's arc centre sits: R in from both of the box's edges at that corner (the inset counted)
    const centres: Record<BracketCorner, { x: number; y: number }> = {
        tl: { x: INSET + R, y: INSET + R },
        tr: { x: FAR - R, y: INSET + R },
        br: { x: FAR - R, y: FAR - R },
        bl: { x: INSET + R, y: FAR - R },
    };

    it("keeps the right-angle path at radius 0, whatever the corner", () => {
        for (const corner of ["tl", "tr", "br", "bl"] as const) {
            expect(bracketPath(14, corner, 1, 0)).toBe(bracketPath(14, corner));
            expect(bracketPath(14, corner, 1, -3)).toBe(bracketPath(14, corner));
            expect(bracketPath(14, corner)).not.toContain("A");
        }
    });

    it("draws top-left as an arm down the left edge, a quarter arc, an arm along the top", () => {
        expect(bracketPath(14, "tl", 1, 5)).toBe("M1,14V6A5,5,0,0,1,6,1H14");
    });

    for (const corner of ["tl", "tr", "br", "bl"] as const) {
        it(`${corner}: one arc of the radius, clockwise, joining the two edges round the corner`, () => {
            const steps = pathSteps(bracketPath(SIZE, corner, INSET, R));
            // start, the arm's end where the arc begins, the arc's end, the other arm's end
            expect(steps.map((s) => s.cmd)).toEqual(["M", steps[1].cmd, "A", steps[3].cmd]);
            expect(steps.filter((s) => s.cmd === "A")).toHaveLength(1);
            const arc = steps[2];
            expect(arc.arc).toEqual({ rx: R, ry: R, large: 0, sweep: 1 });
            // both ends of the arc lie R from the centre: a quarter circle, not a chord
            const c = centres[corner];
            for (const p of [steps[1], steps[2]]) {
                expect(Math.hypot(p.x - c.x, p.y - c.y)).toBeCloseTo(R, 9);
            }
            // the arc's ends are on the corner's two edges, where the arms meet it
            const { vertical, horizontal } = {
                tl: { vertical: INSET, horizontal: INSET },
                tr: { vertical: FAR, horizontal: INSET },
                br: { vertical: FAR, horizontal: FAR },
                bl: { vertical: INSET, horizontal: FAR },
            }[corner];
            const ends = [steps[1], steps[2]];
            expect(ends.some((p) => p.x === vertical)).toBe(true);
            expect(ends.some((p) => p.y === horizontal)).toBe(true);
        });

        it(`${corner}: both arms run the rest of the way to the box's other sides and nothing leaves the box`, () => {
            const pts = pathPoints(bracketPath(SIZE, corner, INSET, R));
            const [start, , , end] = pts;
            // an arm is SIZE - INSET - R long: from its box side to where the arc starts
            expect(Math.abs(start.x - pts[1].x) + Math.abs(start.y - pts[1].y)).toBe(SIZE - INSET - R);
            expect(Math.abs(end.x - pts[2].x) + Math.abs(end.y - pts[2].y)).toBe(SIZE - INSET - R);
            for (const p of pts) {
                expect(p.x).toBeGreaterThanOrEqual(0);
                expect(p.x).toBeLessThanOrEqual(SIZE);
                expect(p.y).toBeGreaterThanOrEqual(0);
                expect(p.y).toBeLessThanOrEqual(SIZE);
            }
        });
    }

    it("clamps a radius that does not fit to size - inset, where the arms shrink to nothing", () => {
        expect(bracketPath(10, "tl", 1, 50)).toBe(bracketPath(10, "tl", 1, 9));
        expect(bracketPath(10, "tl", 1, 9)).toBe("M1,10V10A9,9,0,0,1,10,1H10");
    });

    it("takes the inset into the arc's ends: tr at size 10, inset 2, radius 3", () => {
        // the arm along the top ends 3 short of the right edge's line (x 8), the arc ends 3 below the top edge's line (y 2)
        expect(bracketPath(10, "tr", 2, 3)).toBe("M0,2H5A3,3,0,0,1,8,5V10");
    });
});
