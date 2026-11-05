// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { flakeAlpha, flakeCount, makeFlakes, SNOW_MAX, stepFlake, type Flake } from "./christmassnow";

const term = { left: 100, top: 50, right: 300, bottom: 250 };

describe("flakeAlpha", () => {
    it("halves base for a point inside a terminal rect", () => {
        expect(flakeAlpha(200, 100, 0.5, [term])).toBe(0.25);
    });

    it("keeps base outside every rect", () => {
        expect(flakeAlpha(20, 20, 0.5, [term])).toBe(0.5);
        expect(flakeAlpha(301, 100, 0.5, [term])).toBe(0.5);
    });

    it("keeps base on an empty list", () => {
        expect(flakeAlpha(200, 100, 0.5, [])).toBe(0.5);
    });

    it("treats a rect's edge as inside", () => {
        expect(flakeAlpha(100, 50, 0.5, [term])).toBe(0.25);
        expect(flakeAlpha(300, 250, 0.5, [term])).toBe(0.25);
        expect(flakeAlpha(300, 120, 0.5, [term])).toBe(0.25);
    });

    it("halves once when rects overlap", () => {
        expect(flakeAlpha(200, 100, 0.5, [term, term])).toBe(0.25);
    });
});

describe("flakeCount", () => {
    it("scales with the window's area", () => {
        const small = flakeCount(400, 300);
        const big = flakeCount(800, 600);
        expect(small).toBeGreaterThan(0);
        expect(big).toBeGreaterThan(small);
    });

    it("never passes the cap", () => {
        expect(SNOW_MAX).toBe(120);
        expect(flakeCount(1920, 1080)).toBe(SNOW_MAX);
        expect(flakeCount(7680, 4320)).toBe(SNOW_MAX);
    });

    it("is zero for an empty window", () => {
        expect(flakeCount(0, 600)).toBe(0);
        expect(flakeCount(-5, 600)).toBe(0);
    });

    it("makeFlakes makes that many, small, faint and inside the window", () => {
        const flakes = makeFlakes(800, 600);
        expect(flakes).toHaveLength(flakeCount(800, 600));
        for (const f of flakes) {
            expect(f.x).toBeGreaterThanOrEqual(0);
            expect(f.x).toBeLessThan(800);
            expect(f.y).toBeGreaterThanOrEqual(0);
            expect(f.y).toBeLessThan(600);
            // 1 to 2 px across
            expect(f.r * 2).toBeGreaterThanOrEqual(1);
            expect(f.r * 2).toBeLessThanOrEqual(2);
            expect(f.alpha).toBeGreaterThanOrEqual(0.35);
            expect(f.alpha).toBeLessThanOrEqual(0.6);
        }
    });
});

describe("stepFlake", () => {
    const flake: Flake = { x: 50, y: 10, r: 0.75, vy: 20, vx: 2, phase: 0, alpha: 0.5 };

    it("falls", () => {
        const next = stepFlake(flake, 0.1, 0, 800, 600);
        expect(next.y).toBeGreaterThan(flake.y);
    });

    it("wraps at the bottom and stays inside the window", () => {
        const low = { ...flake, y: 598 };
        const next = stepFlake(low, 0.2, 0, 800, 600, () => 0.5);
        expect(next.y).toBeGreaterThanOrEqual(0);
        expect(next.y).toBeLessThan(600);
        expect(next.y).toBeLessThan(low.y);
        expect(next.x).toBe(400);
    });

    it("wraps sideways and stays inside the window", () => {
        const left = stepFlake({ ...flake, x: 0.1, vx: -20 }, 0.2, 0, 800, 600);
        expect(left.x).toBeGreaterThanOrEqual(0);
        expect(left.x).toBeLessThan(800);
        const right = stepFlake({ ...flake, x: 799.9, vx: 20 }, 0.2, 0, 800, 600);
        expect(right.x).toBeGreaterThanOrEqual(0);
        expect(right.x).toBeLessThan(800);
    });

    it("keeps every flake inside over many steps", () => {
        let flakes = makeFlakes(640, 480);
        for (let i = 0; i < 500; i++) {
            flakes = flakes.map((f) => stepFlake(f, 1 / 12, i * 83, 640, 480));
        }
        for (const f of flakes) {
            expect(f.x).toBeGreaterThanOrEqual(0);
            expect(f.x).toBeLessThan(640);
            expect(f.y).toBeGreaterThanOrEqual(0);
            expect(f.y).toBeLessThan(480);
        }
    });
});
