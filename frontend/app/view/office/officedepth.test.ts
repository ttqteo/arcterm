// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { cellsClip, gridCells, inFront } from "./officedepth";
import type { Prop } from "./scenery";

// a prop 12 x 20 art px at (55, 31): 165..201 x 93..153 in plan px, its foot at 153
const machine: Prop = { kind: "coffee", x: 55, y: 31, w: 12, h: 20, foot: 51, ops: [], after: 0 };
// a body 50 px wide and 80 tall standing with its feet at (x, y)
const body = (x: number, y: number) => ({ feet: { x, y }, box: { x: x - 25, y: y - 80, w: 50, h: 80 } });

describe("inFront", () => {
    it("is true for a body beside the prop with its feet above the prop's foot", () => {
        const b = body(150, 117);
        expect(inFront(machine, b.feet, b.box)).toBe(true);
    });
    it("is false once the feet are level with the foot or below it: the body is in front", () => {
        const level = body(150, 153);
        const below = body(150, 170);
        expect(inFront(machine, level.feet, level.box)).toBe(false);
        expect(inFront(machine, below.feet, below.box)).toBe(false);
    });
    it("is false for a body behind the foot that does not reach the prop", () => {
        const clear = body(120, 117);
        const above = body(183, 12);
        expect(inFront(machine, clear.feet, clear.box)).toBe(false);
        expect(inFront(machine, above.feet, above.box)).toBe(false);
    });
});

describe("cellsClip", () => {
    const cells = [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 3, y: 0 },
        { x: 3, y: 1 },
    ];
    it("is each row's runs of cells as squares joined, in px", () => {
        expect(cellsClip(cells, 5, 20, false)).toBe('path("M0 0h10v5h-10zM15 0h5v5h-5zM15 5h5v5h-5z")');
    });
    it("mirrors the cells in the box's width, as the body is drawn facing left", () => {
        expect(cellsClip(cells, 5, 20, true)).toBe('path("M10 0h10v5h-10zM0 0h5v5h-5zM0 5h5v5h-5z")');
    });
    it("joins extra boxes, and hides all with no cells", () => {
        expect(cellsClip([{ x: 0, y: 0 }], 5, 20, false, [{ x: 2, y: 30, w: 8, h: 4 }])).toBe(
            'path("M0 0h5v5h-5zM2 30h8v4h-8z")'
        );
        expect(cellsClip([], 5, 20, false)).toBe("inset(50%)");
    });
});

describe("gridCells", () => {
    it("is every cell of the grid but the clear ones", () => {
        expect(gridCells([".O", "OK", ".."])).toEqual([
            { x: 1, y: 0 },
            { x: 0, y: 1 },
            { x: 1, y: 1 },
        ]);
    });
});
