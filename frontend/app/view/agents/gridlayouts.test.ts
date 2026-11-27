import { describe, expect, it } from "vitest";
import { arrangeCells, placesOf, type GridState } from "./agentgrid";
import { GRID_LAYOUTS, gridLayout, isLayout, layoutFits, layoutGrid, layoutSizes, zoneCells } from "./gridlayouts";

const BOARD = "board:proj/b1";
const pair: GridState = { ids: ["chat", BOARD], focused: "chat" };

describe("arrangeCells", () => {
    it("puts the mover in the zone and the others in their order", () => {
        const g: GridState = { ids: ["a", "b", "c"], focused: "b" };
        const places = gridLayout("1-2").places;
        expect(arrangeCells(g, places, "b", 0).ids).toEqual(["b", "a", "c"]);
        expect(arrangeCells(g, places, "b", 2).ids).toEqual(["a", "c", "b"]);
        expect(arrangeCells(g, places, "b", 2).focused).toBe("b");
    });

    it("keeps the grid when the zones do not fit, the zone is out of range or the mover is no cell", () => {
        expect(arrangeCells(pair, gridLayout("2x2").places, "chat", 0)).toEqual(pair);
        expect(arrangeCells(pair, gridLayout("1-1").places, "chat", 2)).toEqual(pair);
        expect(arrangeCells(pair, gridLayout("1-1").places, "nobody", 0)).toEqual(pair);
    });
});

describe("layoutGrid", () => {
    it("swaps a pair when the focused cell picks the other side", () => {
        expect(layoutGrid(pair, gridLayout("7-3"), 1).ids).toEqual([BOARD, "chat"]);
        expect(layoutGrid(pair, gridLayout("7-3"), 0).ids).toEqual(["chat", BOARD]);
    });

    it("lays three cells out as one left and two stacked right", () => {
        const three: GridState = { ids: ["a", "b", "c"], focused: "c" };
        const next = layoutGrid(three, gridLayout("1-2"), 0);
        expect(next.ids).toEqual(["c", "a", "b"]);
        expect(placesOf(next)).toEqual(gridLayout("1-2").places);
    });

    it("leaves a grid the layout does not fit", () => {
        expect(layoutGrid(pair, gridLayout("1-2"), 0)).toEqual(pair);
    });
});

describe("zoneCells", () => {
    it("names who lands in each zone", () => {
        expect(zoneCells(pair, gridLayout("1-1"), 1)).toEqual([BOARD, "chat"]);
        expect(zoneCells(pair, gridLayout("2x2"), 0)).toEqual([]);
    });
});

describe("layoutFits", () => {
    it("matches the zones to the cell count", () => {
        const fit = (n: number) => GRID_LAYOUTS.filter((l) => layoutFits(l, n)).map((l) => l.id);
        expect(fit(2)).toEqual(["1-1", "7-3", "3-7"]);
        expect(fit(3)).toEqual(["1-2"]);
        expect(fit(4)).toEqual(["2x2"]);
        expect(fit(1)).toEqual([]);
    });
});

describe("isLayout and layoutSizes", () => {
    it("reads the current layout from the zones and the shares", () => {
        const sizes = layoutSizes({ col: 0.5, row: 0.4 }, gridLayout("7-3"));
        expect(sizes).toEqual({ col: 0.7, row: 0.4 });
        expect(isLayout(pair, sizes, gridLayout("7-3"))).toBe(true);
        expect(isLayout(pair, sizes, gridLayout("1-1"))).toBe(false);
        expect(isLayout(pair, { col: 0.62, row: 0.4 }, gridLayout("7-3"))).toBe(false);
    });

    it("tells the stacked three apart from the default three", () => {
        const def: GridState = { ids: ["a", "b", "c"], focused: "a" };
        expect(isLayout(def, { col: 0.5, row: 0.5 }, gridLayout("1-2"))).toBe(false);
        expect(isLayout(layoutGrid(def, gridLayout("1-2"), 0), { col: 0.5, row: 0.5 }, gridLayout("1-2"))).toBe(true);
    });
});
