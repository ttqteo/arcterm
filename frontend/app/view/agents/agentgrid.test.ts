// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
    EMPTY_GRID,
    MAX_CELLS,
    addCell,
    collapseToFocused,
    focusAgent,
    gridEquals,
    gridFallbackFocus,
    gridHold,
    normalizeGrid,
    parseGrid,
    placementFor,
    placementStyle,
    pruneMissing,
    reconcileGrid,
    removeCell,
    replaceFocused,
    splitGrids,
    splitZones,
    swapCells,
    visibleCells,
    type CellPlacement,
    type GridState,
} from "./agentgrid";

// a state whose focused cell defaults to the first
const g = (ids: string[], focused: string | null = ids[0] ?? null): GridState => ({ ids, focused });
// the set of live (eligible) agent ids
const live = (...ids: string[]) => new Set(ids);
// the places of the 2x2 template, by name: two squares wide or tall, then the four single squares
const P = (row: number, col: number, rowSpan: number, colSpan: number): CellPlacement => ({
    row,
    col,
    rowSpan,
    colSpan,
});
const LEFT = P(1, 1, 2, 1);
const RIGHT = P(1, 2, 2, 1);
const TOP = P(1, 1, 1, 2);
const BOTTOM = P(2, 1, 1, 2);
const TL = P(1, 1, 1, 1);
const TR = P(1, 2, 1, 1);
const BL = P(2, 1, 1, 1);
const BR = P(2, 2, 1, 1);
// a state whose cells sit at `places` rather than where placementFor puts them
const gp = (ids: string[], focused: string, places: CellPlacement[]): GridState => ({ ids, focused, places });

describe("normalizeGrid", () => {
    it("MAX_CELLS is four", () => {
        expect(MAX_CELLS).toBe(4);
    });
    it("keeps the order and drops duplicate ids", () => {
        expect(normalizeGrid(g(["a", "b", "a", "c"], "b"))).toEqual(g(["a", "b", "c"], "b"));
    });
    it("keeps at most four cells, counting a duplicate once", () => {
        expect(normalizeGrid(g(["a", "b", "c", "d", "e"])).ids).toEqual(["a", "b", "c", "d"]);
        expect(normalizeGrid(g(["a", "a", "b", "c", "d", "e"])).ids).toEqual(["a", "b", "c", "d"]);
    });
    it("moves focus to the first cell when the focused id is not a cell", () => {
        expect(normalizeGrid({ ids: ["a", "b"], focused: "zz" })).toEqual(g(["a", "b"], "a"));
        expect(normalizeGrid({ ids: ["a", "b"], focused: null })).toEqual(g(["a", "b"], "a"));
    });
    it("has no focus when there are no cells", () => {
        expect(normalizeGrid({ ids: [], focused: "a" })).toEqual(EMPTY_GRID);
    });
    it("drops empty ids", () => {
        expect(normalizeGrid(g(["", "a"], "a"))).toEqual(g(["a"], "a"));
    });
    it("does not mutate its input", () => {
        const s = g(["a", "a", "b"]);
        normalizeGrid(s);
        expect(s.ids).toEqual(["a", "a", "b"]);
    });
});

describe("parseGrid", () => {
    it.each([[null], [undefined], ["x"], [3], [true], [[]], [{}]])("reads %j as an empty grid", (raw) => {
        expect(parseGrid(raw)).toEqual(EMPTY_GRID);
    });
    it("round-trips a stored grid", () => {
        const s = g(["a", "b", "c"], "b");
        expect(parseGrid(JSON.parse(JSON.stringify(s)))).toEqual(s);
    });
    it("keeps only the string ids and repairs the rest", () => {
        expect(parseGrid({ ids: ["a", 3, null, "b", "a"], focused: 7 })).toEqual(g(["a", "b"], "a"));
    });
    it("reads ids that are not an array as empty", () => {
        expect(parseGrid({ ids: "a", focused: "a" })).toEqual(EMPTY_GRID);
    });
    it("caps a stored list longer than four", () => {
        expect(parseGrid({ ids: ["a", "b", "c", "d", "e"], focused: "e" })).toEqual(g(["a", "b", "c", "d"], "a"));
    });
});

describe("places", () => {
    it("round-trips a stored layout", () => {
        const s = gp(["a", "b", "c"], "b", [LEFT, TR, BR]);
        expect(parseGrid(JSON.parse(JSON.stringify(s)))).toEqual(s);
    });
    it("stores no places for the default layout", () => {
        expect(normalizeGrid(gp(["a", "b"], "a", [LEFT, RIGHT]))).toEqual(g(["a", "b"], "a"));
        expect("places" in normalizeGrid(gp(["a", "b", "c"], "a", [TL, TR, BOTTOM]))).toBe(false);
    });
    it("puts the cells in reading order, each keeping its place", () => {
        expect(normalizeGrid(gp(["b", "a"], "a", [BOTTOM, TOP]))).toEqual(gp(["a", "b"], "a", [TOP, BOTTOM]));
    });
    it("drops places that do not tile the 2x2, or no longer match the ids", () => {
        expect(normalizeGrid(gp(["a", "b"], "a", [TOP, TOP]))).toEqual(g(["a", "b"], "a"));
        expect(normalizeGrid(gp(["a", "b"], "a", [TOP]))).toEqual(g(["a", "b"], "a"));
        expect(normalizeGrid(gp(["a", "a", "b"], "a", [TOP, BL, BR]))).toEqual(g(["a", "b"], "a"));
        expect(
            parseGrid({ ids: ["a", "b"], focused: "a", places: [TOP, { row: 3, col: 1, rowSpan: 1, colSpan: 2 }] })
        ).toEqual(g(["a", "b"], "a"));
        expect(parseGrid({ ids: ["a", 7, "b"], focused: "a", places: [TL, TR, BOTTOM] })).toEqual(g(["a", "b"], "a"));
    });
    it("a swap trades the agents and keeps the places", () => {
        expect(swapCells(gp(["a", "b"], "a", [TOP, BOTTOM]), 0, 1)).toEqual(gp(["b", "a"], "a", [TOP, BOTTOM]));
    });
    it("splitZones offers the edges a cell is two squares long on, and none on a full grid", () => {
        expect(splitZones(g(["a"]), 0)).toEqual(["left", "right", "top", "bottom"]);
        expect(splitZones(g(["a", "b"]), 1)).toEqual(["top", "bottom"]);
        expect(splitZones(gp(["a", "b"], "a", [TOP, BOTTOM]), 0)).toEqual(["left", "right"]);
        expect(splitZones(g(["a", "b", "c"]), 0)).toEqual([]);
        expect(splitZones(g(["a", "b", "c", "d"]), 0)).toEqual([]);
        expect(splitZones(g(["a"]), 3)).toEqual([]);
    });
});

describe("gridEquals", () => {
    it("compares ids in order and the focused id", () => {
        expect(gridEquals(g(["a", "b"], "a"), g(["a", "b"], "a"))).toBe(true);
        expect(gridEquals(g(["a", "b"], "a"), g(["b", "a"], "a"))).toBe(false);
        expect(gridEquals(g(["a", "b"], "a"), g(["a", "b"], "b"))).toBe(false);
        expect(gridEquals(g(["a"], "a"), g(["a", "b"], "a"))).toBe(false);
        expect(gridEquals(EMPTY_GRID, g([]))).toBe(true);
        expect(gridEquals(g(["a", "b"], "a"), gp(["a", "b"], "a", [TOP, BOTTOM]))).toBe(false);
        expect(gridEquals(g(["a", "b"], "a"), gp(["a", "b"], "a", [LEFT, RIGHT]))).toBe(true);
    });
});

describe("addCell with an agent that is not in the grid", () => {
    it("starts a grid from nothing, whatever the zone", () => {
        expect(addCell(EMPTY_GRID, "a", 0, "right")).toEqual(g(["a"], "a"));
        expect(addCell(EMPTY_GRID, "a", 5, "center")).toEqual(g(["a"], "a"));
    });
    it("centre replaces the cell under the drop, which leaves the grid", () => {
        expect(addCell(g(["a", "b"]), "c", 1, "center")).toEqual(g(["a", "c"], "c"));
    });
    it("an edge splits the target along it, the agent taking that edge's half", () => {
        expect(addCell(g(["a"]), "b", 0, "bottom")).toEqual(gp(["a", "b"], "b", [TOP, BOTTOM]));
        expect(addCell(g(["a"]), "b", 0, "top")).toEqual(gp(["b", "a"], "b", [TOP, BOTTOM]));
        expect(addCell(g(["a"]), "b", 0, "right")).toEqual(g(["a", "b"], "b"));
        expect(addCell(g(["a"]), "b", 0, "left")).toEqual(g(["b", "a"], "b"));
    });
    it("a bottom or top drop on one of two side-by-side cells stacks it there, the other keeping its full height", () => {
        expect(addCell(g(["a", "b"]), "c", 1, "bottom")).toEqual(gp(["a", "b", "c"], "c", [LEFT, TR, BR]));
        expect(addCell(g(["a", "b"]), "c", 0, "top")).toEqual(gp(["c", "b", "a"], "c", [TL, RIGHT, BL]));
    });
    it("a right or left drop on one of two stacked cells puts it beside that one", () => {
        expect(addCell(gp(["a", "b"], "a", [TOP, BOTTOM]), "c", 1, "right")).toEqual(
            gp(["a", "b", "c"], "c", [TOP, BL, BR])
        );
    });
    it("an edge the target is too narrow for splits it along the other axis", () => {
        expect(addCell(g(["a", "b"]), "c", 1, "right")).toEqual(gp(["a", "b", "c"], "c", [LEFT, TR, BR]));
        expect(addCell(g(["a", "b"]), "c", 1, "left")).toEqual(gp(["a", "c", "b"], "c", [LEFT, TR, BR]));
    });
    it("a one-square target that cannot split leaves the split to the cell that can, so no one is replaced", () => {
        expect(addCell(g(["a", "b", "c"]), "d", 0, "right")).toEqual(g(["a", "b", "c", "d"], "d"));
    });
    it("builds a grid up to four cells and focuses each agent as it lands", () => {
        let s = g(["a"]);
        s = addCell(s, "b", 0, "right");
        expect(s).toEqual(g(["a", "b"], "b"));
        s = addCell(s, "c", 1, "bottom");
        expect(s).toEqual(gp(["a", "b", "c"], "c", [LEFT, TR, BR]));
        s = addCell(s, "d", 0, "bottom");
        expect(s).toEqual(g(["a", "b", "d", "c"], "d"));
    });
    it("on a full grid an edge zone acts as the centre", () => {
        expect(addCell(g(["a", "b", "c", "d"]), "e", 2, "left")).toEqual(g(["a", "b", "e", "d"], "e"));
        expect(addCell(g(["a", "b", "c", "d"]), "e", 3, "right")).toEqual(g(["a", "b", "c", "e"], "e"));
    });
    it("never grows past four cells", () => {
        let s = g([]);
        for (const id of ["a", "b", "c", "d", "e", "f"]) {
            s = addCell(s, id, 0, "right");
            expect(s.ids.length).toBeLessThanOrEqual(MAX_CELLS);
        }
    });
    it("clamps the target index", () => {
        const s = g(["a", "b", "c"]);
        expect(addCell(s, "x", 99, "right")).toEqual(addCell(s, "x", 2, "right"));
        expect(addCell(s, "x", -5, "left")).toEqual(addCell(s, "x", 0, "left"));
        expect(addCell(s, "x", Number.NaN, "left")).toEqual(addCell(s, "x", 0, "left"));
        expect(addCell(s, "x", 1.9, "center")).toEqual(addCell(s, "x", 1, "center"));
    });
    it("pins an infinite target index to the last or the first cell", () => {
        const s = g(["a", "b", "c"]);
        expect(addCell(s, "x", Number.POSITIVE_INFINITY, "center")).toEqual(g(["a", "b", "x"], "x"));
        expect(addCell(s, "x", Number.NEGATIVE_INFINITY, "center")).toEqual(g(["x", "b", "c"], "x"));
    });
    it("ignores an empty id", () => {
        expect(addCell(g(["a"]), "", 0, "right")).toEqual(g(["a"]));
        expect(addCell(EMPTY_GRID, "", 0, "right")).toEqual(EMPTY_GRID);
    });
    it("normalizes a state with duplicates before adding", () => {
        expect(addCell(g(["a", "a"]), "b", 0, "right")).toEqual(g(["a", "b"], "b"));
    });
    it("does not mutate its input", () => {
        const s = g(["a", "b"]);
        const before = JSON.stringify(s);
        addCell(s, "c", 0, "right");
        expect(JSON.stringify(s)).toBe(before);
    });
});

describe("addCell with an agent that is already in the grid (a move)", () => {
    it("centre swaps the two cells and focuses the moved agent", () => {
        expect(addCell(g(["a", "b", "c"], "a"), "c", 0, "center")).toEqual(g(["c", "b", "a"], "c"));
    });
    it("dropping an agent on its own cell only focuses it", () => {
        expect(addCell(g(["a", "b", "c"], "a"), "b", 1, "center")).toEqual(g(["a", "b", "c"], "b"));
        expect(addCell(g(["a", "b", "c"], "a"), "b", 1, "left")).toEqual(g(["a", "b", "c"], "b"));
    });
    it("an edge takes it out of its cell and splits it off the target along that edge", () => {
        expect(addCell(g(["a", "b"]), "a", 1, "bottom")).toEqual(gp(["b", "a"], "a", [TOP, BOTTOM]));
        expect(addCell(g(["a", "b"]), "b", 0, "top")).toEqual(gp(["b", "a"], "b", [TOP, BOTTOM]));
        expect(addCell(gp(["a", "b"], "a", [TOP, BOTTOM]), "a", 1, "left")).toEqual(g(["a", "b"], "a"));
    });
    it("the cell it leaves is filled before the target splits", () => {
        // a leaves the top row, so b widens over it; then the bottom cell splits and a takes its right half
        expect(addCell(g(["a", "b", "c"]), "a", 2, "right")).toEqual(gp(["b", "c", "a"], "a", [TOP, BL, BR]));
    });
    it("moves on a full grid without dropping anyone", () => {
        expect(addCell(g(["a", "b", "c", "d"]), "a", 1, "right")).toEqual(g(["b", "a", "c", "d"], "a"));
    });
});

describe("swapCells", () => {
    it("swaps two cells by index and leaves focus on the same agent", () => {
        expect(swapCells(g(["a", "b", "c"], "a"), 0, 2)).toEqual(g(["c", "b", "a"], "a"));
    });
    it("does nothing for the same, an out-of-range or a non-integer index", () => {
        const s = g(["a", "b"], "b");
        expect(swapCells(s, 1, 1)).toEqual(s);
        expect(swapCells(s, 0, 2)).toEqual(s);
        expect(swapCells(s, -1, 0)).toEqual(s);
        expect(swapCells(s, 0.5, 1)).toEqual(s);
        expect(swapCells(s, Number.NaN, 1)).toEqual(s);
    });
    it("does not mutate its input", () => {
        const s = g(["a", "b"]);
        swapCells(s, 0, 1);
        expect(s.ids).toEqual(["a", "b"]);
    });
});

describe("removeCell", () => {
    it("removes a cell that is not focused and keeps focus", () => {
        expect(removeCell(g(["a", "b", "c"], "a"), "b")).toEqual(gp(["a", "c"], "a", [TOP, BOTTOM]));
    });
    it("focus moves to the cell that takes the removed one's place", () => {
        expect(removeCell(g(["a", "b", "c"], "b"), "b")).toEqual(gp(["a", "c"], "c", [TOP, BOTTOM]));
        expect(removeCell(g(["a", "b"], "a"), "a")).toEqual(g(["b"], "b"));
    });
    it("focus goes to the next survivor, not the last one", () => {
        expect(removeCell(g(["a", "b", "c", "d"], "b"), "b")).toEqual(gp(["a", "c", "d"], "c", [TOP, BL, BR]));
    });
    it("a neighbour sharing a whole side with it fills its space, one in the same row first", () => {
        expect(removeCell(g(["a", "b", "c", "d"], "a"), "d")).toEqual(g(["a", "b", "c"], "a"));
        expect(removeCell(g(["a", "b", "c"], "a"), "c")).toEqual(g(["a", "b"], "a"));
        expect(removeCell(gp(["a", "b", "c"], "a", [LEFT, TR, BR]), "c")).toEqual(g(["a", "b"], "a"));
    });
    it("a cell spanning the whole height leaves the cells beside it each growing across", () => {
        expect(removeCell(gp(["a", "b", "c"], "a", [LEFT, TR, BR]), "a")).toEqual(gp(["b", "c"], "b", [TOP, BOTTOM]));
    });
    it("focus moves to the previous cell when the last one is removed", () => {
        expect(removeCell(g(["a", "b", "c"], "c"), "c")).toEqual(g(["a", "b"], "b"));
    });
    it("removing the only cell leaves an empty grid", () => {
        expect(removeCell(g(["a"]), "a")).toEqual(EMPTY_GRID);
    });
    it("an id that is not a cell changes nothing", () => {
        expect(removeCell(g(["a", "b"], "b"), "z")).toEqual(g(["a", "b"], "b"));
    });
});

describe("replaceFocused", () => {
    it("starts a grid from nothing", () => {
        expect(replaceFocused(EMPTY_GRID, "x")).toEqual(g(["x"], "x"));
    });
    it("replaces the focused cell in place", () => {
        expect(replaceFocused(g(["a", "b", "c"], "b"), "d")).toEqual(g(["a", "d", "c"], "d"));
    });
    it("is a no-op for the agent already focused", () => {
        expect(replaceFocused(g(["a", "b"], "b"), "b")).toEqual(g(["a", "b"], "b"));
    });
    it("never duplicates: an agent in another cell trades places with the focused one", () => {
        expect(replaceFocused(g(["a", "b", "c"], "a"), "c")).toEqual(g(["c", "b", "a"], "c"));
    });
    it("keeps a full grid at four", () => {
        expect(replaceFocused(g(["a", "b", "c", "d"], "d"), "e").ids).toEqual(["a", "b", "c", "e"]);
    });
    it("ignores an empty id", () => {
        expect(replaceFocused(g(["a"]), "")).toEqual(g(["a"]));
    });
});

describe("focusAgent (the one rule: its cell, else the focused cell)", () => {
    it("focuses the cell of an agent that is in the grid and leaves the list alone", () => {
        expect(focusAgent(g(["a", "b"], "a"), "b")).toEqual(g(["a", "b"], "b"));
    });
    it("is a no-op for the agent already focused", () => {
        expect(focusAgent(g(["a", "b"], "b"), "b")).toEqual(g(["a", "b"], "b"));
    });
    it("replaces the focused cell with an agent that is not in the grid", () => {
        expect(focusAgent(g(["a", "b"], "a"), "c")).toEqual(g(["c", "b"], "c"));
    });
    it("starts a grid from nothing", () => {
        expect(focusAgent(EMPTY_GRID, "c")).toEqual(g(["c"], "c"));
    });
    it("ignores an empty id", () => {
        expect(focusAgent(g(["a", "b"], "b"), "")).toEqual(g(["a", "b"], "b"));
    });
    it("browsing through the roster keeps rewriting only the focused cell", () => {
        let s = g(["a", "b"], "a");
        s = focusAgent(s, "c");
        expect(s).toEqual(g(["c", "b"], "c"));
        s = focusAgent(s, "d");
        expect(s).toEqual(g(["d", "b"], "d"));
        s = focusAgent(s, "b");
        expect(s).toEqual(g(["d", "b"], "b"));
        s = focusAgent(s, "e");
        expect(s).toEqual(g(["d", "e"], "e"));
    });
});

describe("pruneMissing", () => {
    it("drops agents that are not live, keeping the order", () => {
        expect(pruneMissing(g(["a", "b", "c"], "a"), new Set(["a", "c"]))).toEqual(gp(["a", "c"], "a", [TOP, BOTTOM]));
    });
    it("accepts any iterable of live ids", () => {
        expect(pruneMissing(g(["a", "b"]), ["b"])).toEqual(g(["b"], "b"));
    });
    it("a focused cell that left hands focus to the next surviving cell", () => {
        expect(pruneMissing(g(["a", "b", "c", "d"], "b"), new Set(["a", "c", "d"]))).toEqual(
            gp(["a", "c", "d"], "c", [TOP, BL, BR])
        );
        expect(pruneMissing(g(["a", "b", "c", "d"], "b"), new Set(["a", "d"]))).toEqual(
            gp(["a", "d"], "d", [TOP, BOTTOM])
        );
    });
    it("falls back to the last survivor when none is after the focused one", () => {
        expect(pruneMissing(g(["a", "b", "c"], "c"), new Set(["a", "b"]))).toEqual(g(["a", "b"], "b"));
    });
    it("empties the grid when nothing survives", () => {
        expect(pruneMissing(g(["a", "b"]), new Set())).toEqual(EMPTY_GRID);
    });
    it("changes nothing when everything is live", () => {
        expect(pruneMissing(g(["a", "b"], "b"), new Set(["a", "b", "z"]))).toEqual(g(["a", "b"], "b"));
    });
    it("normalizes first", () => {
        expect(pruneMissing(g(["a", "a", "b"]), new Set(["a", "b"]))).toEqual(g(["a", "b"], "a"));
    });
});

describe("collapseToFocused", () => {
    it("keeps only the focused cell", () => {
        expect(collapseToFocused(g(["a", "b", "c"], "b"))).toEqual(g(["b"], "b"));
    });
    it("leaves an empty grid and a single cell as they are", () => {
        expect(collapseToFocused(EMPTY_GRID)).toEqual(EMPTY_GRID);
        expect(collapseToFocused(g(["a"]))).toEqual(g(["a"]));
    });
});

describe("placementFor", () => {
    it("1 fills the area", () => {
        expect(placementFor(1)).toEqual([{ row: 1, col: 1, rowSpan: 2, colSpan: 2 }]);
    });
    it("2 sit side by side", () => {
        expect(placementFor(2)).toEqual([
            { row: 1, col: 1, rowSpan: 2, colSpan: 1 },
            { row: 1, col: 2, rowSpan: 2, colSpan: 1 },
        ]);
    });
    it("3 are two on top and one spanning the bottom", () => {
        expect(placementFor(3)).toEqual([
            { row: 1, col: 1, rowSpan: 1, colSpan: 1 },
            { row: 1, col: 2, rowSpan: 1, colSpan: 1 },
            { row: 2, col: 1, rowSpan: 1, colSpan: 2 },
        ]);
    });
    it("4 are 2x2", () => {
        expect(placementFor(4)).toEqual([
            { row: 1, col: 1, rowSpan: 1, colSpan: 1 },
            { row: 1, col: 2, rowSpan: 1, colSpan: 1 },
            { row: 2, col: 1, rowSpan: 1, colSpan: 1 },
            { row: 2, col: 2, rowSpan: 1, colSpan: 1 },
        ]);
    });
    it("has nothing for zero, a negative or a non-number", () => {
        expect(placementFor(0)).toEqual([]);
        expect(placementFor(-3)).toEqual([]);
        expect(placementFor(Number.NaN)).toEqual([]);
        expect(placementFor(Number.NEGATIVE_INFINITY)).toEqual([]);
    });
    it("clamps to four and truncates a fraction", () => {
        expect(placementFor(7)).toEqual(placementFor(4));
        expect(placementFor(Number.POSITIVE_INFINITY)).toEqual(placementFor(4));
        expect(placementFor(2.9)).toEqual(placementFor(2));
    });
    it("every shape covers the 2x2 exactly once", () => {
        for (const n of [1, 2, 3, 4]) {
            const covered: number[][] = [
                [0, 0],
                [0, 0],
            ];
            for (const p of placementFor(n)) {
                for (let r = p.row - 1; r < p.row - 1 + p.rowSpan; r++) {
                    for (let c = p.col - 1; c < p.col - 1 + p.colSpan; c++) {
                        covered[r][c]++;
                    }
                }
            }
            expect(covered).toEqual([
                [1, 1],
                [1, 1],
            ]);
        }
    });
    it("returns fresh objects each call", () => {
        placementFor(1)[0].row = 9;
        expect(placementFor(1)[0].row).toBe(1);
    });
});

describe("placementStyle", () => {
    it("turns a placement into the grid-row and grid-column values", () => {
        expect(placementStyle({ row: 2, col: 1, rowSpan: 1, colSpan: 2 })).toEqual({
            gridRow: "2 / span 1",
            gridColumn: "1 / span 2",
        });
    });
});

describe("visibleCells", () => {
    it("is empty while nothing is in focus", () => {
        expect(visibleCells(g(["a", "b"]), { focusId: undefined, collapsed: false })).toEqual([]);
    });
    it("reads an empty focus id as nothing in focus", () => {
        expect(visibleCells(g(["a", "b"]), { focusId: "", collapsed: false })).toEqual([]);
    });
    it("lays the grid out by count and flags the focused cell", () => {
        const cells = visibleCells(g(["a", "b", "c", "d"], "a"), { focusId: "c", collapsed: false });
        expect(cells.map((c) => c.id)).toEqual(["a", "b", "c", "d"]);
        expect(cells.map((c) => c.placement)).toEqual(placementFor(4));
        expect(cells.map((c) => c.focused)).toEqual([false, false, true, false]);
    });
    it("uses the three-cell shape for three agents", () => {
        const cells = visibleCells(g(["a", "b", "c"], "c"), { focusId: "c", collapsed: false });
        expect(cells.map((c) => c.placement)).toEqual(placementFor(3));
    });
    it("puts each cell at its stored place", () => {
        const cells = visibleCells(gp(["a", "b"], "a", [TOP, BOTTOM]), { focusId: "b", collapsed: false });
        expect(cells.map((c) => c.placement)).toEqual([TOP, BOTTOM]);
    });
    it("collapses to the focused cell, filling the area", () => {
        expect(visibleCells(g(["a", "b"]), { focusId: "b", collapsed: true })).toEqual([
            { id: "b", placement: { row: 1, col: 1, rowSpan: 2, colSpan: 2 }, focused: true },
        ]);
    });
    it("shows an agent that is not in the grid alone", () => {
        expect(visibleCells(g(["a", "b"]), { focusId: "term", collapsed: false })).toEqual([
            { id: "term", placement: placementFor(1)[0], focused: true },
        ]);
    });
    it("follows the id in focus, not the stored focused cell", () => {
        const cells = visibleCells(g(["a", "b"], "a"), { focusId: "b", collapsed: false });
        expect(cells.map((c) => c.focused)).toEqual([false, true]);
    });
});

describe("reconcileGrid", () => {
    it("leaves the saved grid alone until the roster has been read", () => {
        // the focus is live and not a cell, and a saved agent is missing: seeded or not, a rule would act on both
        expect(reconcileGrid(g(["a", "b"], "a"), { focusId: "c", eligible: live("c"), seeded: false })).toEqual(
            g(["a", "b"], "a")
        );
    });
    it("prunes agents that are no longer live", () => {
        expect(
            reconcileGrid(g(["a", "b", "c"], "a"), { focusId: "a", eligible: live("a", "c"), seeded: true })
        ).toEqual(gp(["a", "c"], "a", [TOP, BOTTOM]));
    });
    it("focuses the cell of a focused agent that is already in the grid", () => {
        expect(reconcileGrid(g(["a", "b"], "a"), { focusId: "b", eligible: live("a", "b"), seeded: true })).toEqual(
            g(["a", "b"], "b")
        );
    });
    it("replaces the focused cell with a focused agent that is not in the grid", () => {
        expect(
            reconcileGrid(g(["a", "b"], "a"), { focusId: "c", eligible: live("a", "b", "c"), seeded: true })
        ).toEqual(g(["c", "b"], "c"));
    });
    it("ignores a focus that is not a live agent (a terminal, a done worker)", () => {
        expect(reconcileGrid(g(["a", "b"], "a"), { focusId: "term", eligible: live("a", "b"), seeded: true })).toEqual(
            g(["a", "b"], "a")
        );
    });
    it("only prunes when nothing is in focus", () => {
        expect(
            reconcileGrid(g(["a", "b", "c"], "b"), { focusId: undefined, eligible: live("a", "c"), seeded: true })
        ).toEqual(gp(["a", "c"], "c", [TOP, BOTTOM]));
    });
    it("starts a one-cell grid from a focused live agent", () => {
        expect(reconcileGrid(EMPTY_GRID, { focusId: "a", eligible: live("a"), seeded: true })).toEqual(g(["a"], "a"));
    });
    it("is idempotent", () => {
        const cases: [GridState, string | undefined, string[], boolean][] = [
            [g(["a", "b", "c"], "b"), "d", ["a", "b", "c", "d"], true],
            [g(["a", "b", "c", "d"], "a"), "e", ["a", "b", "c", "d", "e"], true],
            [g(["a", "x", "b"], "x"), undefined, ["a", "b"], true],
            [g(["a", "b"], "a"), "term", ["a", "b"], true],
            [g(["a", "b"], "a"), "c", ["c"], false],
            [EMPTY_GRID, "a", ["a"], true],
        ];
        for (const [state, focusId, ids, seeded] of cases) {
            const input = { focusId, eligible: new Set(ids), seeded };
            const once = reconcileGrid(state, input);
            expect(reconcileGrid(once, input)).toEqual(once);
        }
    });
});

describe("gridFallbackFocus", () => {
    it("prefers the grid's focused cell", () => {
        expect(gridFallbackFocus(g(["a", "b"], "b"), live("a", "b"))).toBe("b");
    });
    it("falls to the first live cell when the focused one is not live", () => {
        expect(gridFallbackFocus(g(["a", "b", "c"], "b"), live("a", "c"))).toBe("a");
    });
    it("has nothing when no cell is live or the grid is empty", () => {
        expect(gridFallbackFocus(g(["a", "b"]), live("z"))).toBeUndefined();
        expect(gridFallbackFocus(EMPTY_GRID, live("a"))).toBeUndefined();
    });
    it("takes the first live cell on a raw grid, where pruneMissing would take the neighbour", () => {
        const grid = g(["a", "b", "c", "d"], "c");
        const ids = live("a", "b", "d");
        expect(gridFallbackFocus(grid, ids)).toBe("a");
        expect(gridFallbackFocus(pruneMissing(grid, ids), ids)).toBe("d");
    });
});

describe("gridHold", () => {
    it("holds while the roster loads and none of the saved agents has arrived", () => {
        expect(gridHold(g(["a", "b"]), new Set(["z"]), false)).toBe(true);
        expect(gridHold(g(["a", "b"]), new Set(), false)).toBe(true);
    });
    // a reload resumed on whichever saved cell's agent arrived first, and that one then stayed the focused agent
    it("holds while the roster loads until the saved focused cell's agent arrives", () => {
        expect(gridHold(g(["a", "b"]), new Set(["b"]), false)).toBe(true);
        expect(gridHold(g(["a", "b"]), new Set(["a"]), false)).toBe(false);
        expect(gridHold(g(["a", "b"], "b"), new Set(["b"]), false)).toBe(false);
    });
    it("never holds once the roster has been read", () => {
        expect(gridHold(g(["a", "b"]), new Set(), true)).toBe(false);
    });
    it("never holds an empty grid", () => {
        expect(gridHold(EMPTY_GRID, new Set(), false)).toBe(false);
    });
});

describe("splitGrids", () => {
    it("keeps the grids of two cells or more, by project", () => {
        const state = {
            project: "a",
            grids: { a: { ids: ["x", "y"], focused: "x" }, b: { ids: ["z"], focused: "z" } },
        };
        expect([...splitGrids(state).keys()]).toEqual(["a"]);
    });
});
