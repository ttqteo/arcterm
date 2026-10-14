// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { gridPixels, parseColor, POSES, SPRITE_W, spriteFor, type SpritePose } from "./officesprite";

const SITTING: SpritePose[] = ["type1", "type2", "handup1", "handup2", "slump", "lean", "hands"];
const STANDING: SpritePose[] = ["stand", "clip", "box"];

describe("officesprite", () => {
    it("draws every pose 14 wide, 18 rows sitting and 22 standing", () => {
        for (const p of SITTING) {
            expect(POSES[p].length, p).toBe(18);
        }
        for (const p of STANDING) {
            expect(POSES[p].length, p).toBe(22);
        }
        for (const [p, grid] of Object.entries(POSES)) {
            for (const row of grid) {
                expect(row.length, p).toBe(SPRITE_W);
            }
        }
    });

    it("uses only known cell codes", () => {
        for (const [p, grid] of Object.entries(POSES)) {
            expect(grid.join(""), p).toMatch(/^[.HSETPKWB]+$/);
        }
    });

    it("names the grid a desk pose shows on each frame", () => {
        expect(spriteFor("type", 0)).toBe("type1");
        expect(spriteFor("type", 1)).toBe("type2");
        expect(spriteFor("handup", 1)).toBe("handup2");
        expect(spriteFor("lean", 1)).toBe("lean");
        expect(spriteFor("empty", 0)).toBeUndefined();
    });

    it("turns a grid into RGBA, leaving empty cells and uncoloured roles clear", () => {
        const px = gridPixels(
            ["H.", "S."].map((r) => r.padEnd(SPRITE_W, ".")),
            (role) => (role === "H" ? [1, 2, 3] : undefined)
        );
        expect(px.length).toBe(SPRITE_W * 2 * 4);
        expect(Array.from(px.slice(0, 4))).toEqual([1, 2, 3, 255]);
        expect(px[7]).toBe(0); // the "." beside it
        expect(px[SPRITE_W * 4 + 3]).toBe(0); // the S with no colour
    });

    it("reads the colours getComputedStyle hands back", () => {
        expect(parseColor("#7c95ff")).toEqual([124, 149, 255]);
        expect(parseColor(" rgb(1, 2, 3) ")).toEqual([1, 2, 3]);
        expect(parseColor("")).toBeUndefined();
        expect(parseColor("var(--x)")).toBeUndefined();
    });
});
