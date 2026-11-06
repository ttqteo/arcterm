// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
    FIREWORK_FRAMES,
    fireworkCells,
    ORNAMENT_FILL,
    treeGrid,
    XMAS_TREE_FILL,
    XMAS_TREE_H,
    XMAS_TREE_W,
} from "./xmastreegrid";

const NEEDLES = new Set(["P", "d"]);
// the spec's spots by branch stage: sapling, then 1 … 5 tiers
const STAGES: readonly [number, number][] = [
    [0, 4],
    [1, 10],
    [2, 19],
    [3, 22],
    [4, 25],
    [5, 30],
];
const TOKEN_FILL =
    /^(var\(--color-[a-z0-9-]+\)|color-mix\(in srgb, (var\(--color-[a-z0-9-]+\)|black|white)( \d+%)?, (var\(--color-[a-z0-9-]+\)|black|white)( \d+%)?\))$/;

function cellsOf(rows: readonly string[], chars: Set<string>): Set<string> {
    const out = new Set<string>();
    rows.forEach((row, y) => [...row].forEach((c, x) => chars.has(c) && out.add(`${x},${y}`)));
    return out;
}

describe("treeGrid", () => {
    it("is XMAS_TREE_W x XMAS_TREE_H at every stage, every cell with a fill", () => {
        for (const [tiers] of STAGES) {
            for (const lights of [false, true]) {
                for (const star of [false, true]) {
                    const { rows } = treeGrid(tiers, lights, star, 0);
                    expect(rows).toHaveLength(XMAS_TREE_H);
                    for (const row of rows) {
                        expect(row).toHaveLength(XMAS_TREE_W);
                        for (const c of row) if (c !== ".") expect(XMAS_TREE_FILL[c]).toBeDefined();
                    }
                }
            }
        }
    });

    it("stays narrow enough for the hall (at most 20 cells wide)", () => {
        expect(XMAS_TREE_W).toBeLessThanOrEqual(20);
    });

    it("puts every spot on its own needle cell, never on a light or the star", () => {
        for (const [tiers, spotCount] of STAGES) {
            const { rows, spots } = treeGrid(tiers, true, true, spotCount);
            expect(spots).toHaveLength(spotCount);
            const seen = new Set<string>();
            for (const { x, y } of spots) {
                expect(NEEDLES.has(rows[y][x])).toBe(true);
                seen.add(`${x},${y}`);
            }
            expect(seen.size).toBe(spotCount);
        }
    });

    it("keeps each spot on the same cell as the tree grows", () => {
        for (let s = 1; s < STAGES.length; s++) {
            const before = treeGrid(STAGES[s - 1][0], false, false, STAGES[s - 1][1]).spots;
            const after = treeGrid(STAGES[s][0], true, true, STAGES[s][1]).spots;
            expect(after.slice(0, before.length)).toEqual(before);
        }
    });

    it("grows: each stage's needles hold the one before, and the sapling's are a subset of tier 5's", () => {
        const needles = STAGES.map(([t]) => cellsOf(treeGrid(t, false, false, 0).rows, NEEDLES));
        for (let s = 1; s < needles.length; s++) {
            for (const c of needles[s - 1]) expect(needles[s].has(c)).toBe(true);
            expect(needles[s].size).toBeGreaterThan(needles[s - 1].size);
        }
        for (const c of needles[0]) expect(needles[5].has(c)).toBe(true);
    });

    it("draws the star and the lights only when asked", () => {
        for (const [tiers] of STAGES) {
            expect(cellsOf(treeGrid(tiers, true, false, 0).rows, new Set(["S"])).size).toBe(0);
            expect(cellsOf(treeGrid(tiers, false, true, 0).rows, new Set(["L"])).size).toBe(0);
        }
        expect(cellsOf(treeGrid(5, true, true, 0).rows, new Set(["S"])).size).toBe(5);
        expect(cellsOf(treeGrid(5, true, true, 0).rows, new Set(["L"])).size).toBeGreaterThan(0);
    });

    it("has a mirror-symmetric silhouette standing on its trunk on the bottom row", () => {
        for (const [tiers] of STAGES) {
            const { rows } = treeGrid(tiers, true, true, 0);
            for (const row of rows) {
                const shape = [...row].map((c) => (c === "." ? "." : "#")).join("");
                expect(shape).toBe([...shape].reverse().join(""));
            }
            expect(rows[XMAS_TREE_H - 1]).toContain("T");
        }
    });

    it("moves a spot the stage cannot hold, keeping its index, and lists no more spots than cells", () => {
        const { rows, spots } = treeGrid(0, false, false, 30);
        const free = cellsOf(rows, NEEDLES).size;
        expect(spots.length).toBe(Math.min(30, free));
        expect(new Set(spots.map((p) => `${p.x},${p.y}`)).size).toBe(spots.length);
        expect(spots.slice(0, 4)).toEqual(treeGrid(0, false, false, 4).spots);
    });
});

describe("fills", () => {
    it("takes every colour from tokens, never raw hex", () => {
        for (const f of [...Object.values(XMAS_TREE_FILL), ...ORNAMENT_FILL]) {
            expect(f).not.toMatch(/#/);
            expect(f).toMatch(TOKEN_FILL);
        }
        expect(ORNAMENT_FILL).toEqual([
            "var(--color-xmas-bulb)",
            "var(--color-accent)",
            "var(--color-xmas-snow)",
            "var(--color-xmas-crimson)",
        ]);
    });
});

describe("fireworkCells", () => {
    it("stays inside w x h on every frame, with token colours", () => {
        for (const [w, h] of [
            [78, 40],
            [20, 12],
            [3, 2],
        ]) {
            for (let f = 0; f < FIREWORK_FRAMES * 2; f++) {
                for (const c of fireworkCells(f, w, h)) {
                    expect(c.x).toBeGreaterThanOrEqual(0);
                    expect(c.x).toBeLessThan(w);
                    expect(c.y).toBeGreaterThanOrEqual(0);
                    expect(c.y).toBeLessThan(h);
                    expect(c.fill).toMatch(TOKEN_FILL);
                }
            }
        }
    });

    it("animates: frame 0 and frame 1 differ, and the cycle repeats", () => {
        expect(fireworkCells(1, 78, 40)).not.toEqual(fireworkCells(0, 78, 40));
        expect(fireworkCells(FIREWORK_FRAMES + 3, 78, 40)).toEqual(fireworkCells(3, 78, 40));
        expect(fireworkCells(0, 0, 0)).toEqual([]);
    });

    it("bursts in bulb, gold, snow and pine", () => {
        const fills = new Set<string>();
        for (let f = 0; f < FIREWORK_FRAMES; f++) for (const c of fireworkCells(f, 78, 40)) fills.add(c.fill);
        for (const want of ["bulb", "accent", "snow", "pine"]) {
            expect([...fills].some((f) => f.includes(`--color-${want}`) || f.includes(`--color-xmas-${want}`))).toBe(
                true
            );
        }
    });
});
