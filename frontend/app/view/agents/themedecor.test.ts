// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
    cellsPath,
    chipSwatches,
    cobwebPath,
    hasSpiderDecor,
    offersSpiderTheme,
    SPIDER_MARK,
    SPIDER_SENSE,
    SPIDER_SENSE_OFFSET,
    SPIDER_SMALL,
} from "./themedecor";
import { activePalette } from "./themes";

describe("hasSpiderDecor", () => {
    it("is the Spider theme's alone", () => {
        expect(hasSpiderDecor("spider")).toBe(true);
        for (const preset of ["claude", "monokai", "", "Spider"]) {
            expect(hasSpiderDecor(preset)).toBe(false);
        }
    });
});

describe("offersSpiderTheme", () => {
    it("asks when Spider-Man is picked under another theme", () => {
        expect(offersSpiderTheme("spidey", "claude")).toBe(true);
    });

    it("does not ask when the Spider theme is already on", () => {
        expect(offersSpiderTheme("spidey", "spider")).toBe(false);
    });

    it("does not ask for the other characters", () => {
        expect(offersSpiderTheme("sprout", "claude")).toBe(false);
        expect(offersSpiderTheme("minion", "claude")).toBe(false);
    });
});

describe("the spider's cells", () => {
    it("fills the t> mark's 25x19 box", () => {
        expect(SPIDER_MARK).toHaveLength(19);
        for (const row of SPIDER_MARK) {
            expect(row).toHaveLength(25);
        }
    });

    it("draws both spiders mirror-symmetric", () => {
        for (const row of [...SPIDER_MARK, ...SPIDER_SMALL]) {
            expect([...row].reverse().join("")).toBe(row);
        }
    });

    it("gives the small spider two eyes on a 9x8 grid", () => {
        expect(SPIDER_SMALL).toHaveLength(8);
        expect(SPIDER_SMALL.every((row) => row.length === 9)).toBe(true);
        expect(SPIDER_SMALL.join("").split("e")).toHaveLength(3);
    });
});

describe("chipSwatches", () => {
    it("shows background, surface, accent and success", () => {
        const p = activePalette("monokai");
        expect(chipSwatches("monokai", p)).toEqual([p.bg, p.surface, p.accent, p.success]);
    });

    it("shows the suit's red and blue on the Spider chip", () => {
        const p = activePalette("spider");
        expect(chipSwatches("spider", p)).toEqual([p.bg, p.surface, "var(--color-spidey-red)", "#7a9ce6"]);
    });
});

describe("SPIDER_SENSE", () => {
    const cells = (rows: readonly string[], code: string, dx = 0, dy = 0) =>
        rows.flatMap((row, y) => [...row].flatMap((c, x) => (c === code ? [{ x: x + dx, y: y + dy }] : [])));

    it("frames the small spider three cells a side, mirror-symmetric", () => {
        for (const row of SPIDER_SENSE) {
            expect(row).toHaveLength(SPIDER_SMALL[0].length + 2 * SPIDER_SENSE_OFFSET.x);
            expect([...row].reverse().join("")).toBe(row);
        }
    });

    it("keeps every jag a cell clear of the spider", () => {
        const body = cells(SPIDER_SMALL, "S", SPIDER_SENSE_OFFSET.x, SPIDER_SENSE_OFFSET.y);
        for (const j of cells(SPIDER_SENSE, "y")) {
            for (const b of body) {
                expect(Math.max(Math.abs(j.x - b.x), Math.abs(j.y - b.y)), `${j.x},${j.y}`).toBeGreaterThanOrEqual(2);
            }
        }
    });
});

describe("cellsPath", () => {
    it("draws one square per cell of the code, at its cell size", () => {
        expect(cellsPath(["#.", ".#"], "#", 2)).toBe("M0 0h2v2h-2zM2 2h2v2h-2z");
    });

    it("skips the other codes", () => {
        expect(cellsPath(["Se"], "e", 1)).toBe("M1 0h1v1h-1z");
        expect(cellsPath(["Se"], "x", 1)).toBe("");
    });
});

describe("cobwebPath", () => {
    it("stays inside its box: 1.13 radii wide, one radius tall", () => {
        const nums = cobwebPath(100, [30, 60, 90])
            .match(/-?\d+(\.\d+)?/g)!
            .map(Number);
        const xs = nums.filter((_, i) => i % 2 === 0);
        const ys = nums.filter((_, i) => i % 2 === 1);
        expect(Math.min(...nums)).toBeGreaterThanOrEqual(0);
        expect(Math.max(...xs)).toBeLessThanOrEqual(113);
        expect(Math.max(...ys)).toBeLessThanOrEqual(100);
    });

    it("runs six spokes from the corner and five strands a ring", () => {
        const d = cobwebPath(100, [30, 60]);
        expect(d.match(/M0 0L/g)).toHaveLength(6);
        expect(d.match(/Q/g)).toHaveLength(10);
    });
});
