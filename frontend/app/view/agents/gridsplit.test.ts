import { describe, expect, it } from "vitest";
import { placementFor } from "./agentgrid";
import { clampShare, parseGridSizes, sashSpans, shareAt, tracks } from "./gridsplit";

describe("clampShare", () => {
    it("keeps a share inside the bounds", () => {
        expect(clampShare(0.4, 2000)).toBe(0.4);
        expect(clampShare(0.01, 2000)).toBe(0.15);
        expect(clampShare(0.99, 2000)).toBe(0.85);
    });
    it("leaves each track MIN_TRACK_PX on a narrow span", () => {
        expect(clampShare(0.1, 800)).toBe(0.25);
        expect(clampShare(0.9, 800)).toBe(0.75);
    });
    it("keeps a span too small for two tracks even", () => {
        expect(clampShare(0.3, 300)).toBe(0.5);
    });
    it("reads NaN as even", () => {
        expect(clampShare(NaN, 1000)).toBe(0.5);
    });
});

describe("tracks", () => {
    it("writes factors that add up to 100", () => {
        expect(tracks(0.5)).toBe("minmax(0, 50fr) minmax(0, 50fr)");
        expect(tracks(0.3)).toBe("minmax(0, 30fr) minmax(0, 70fr)");
        expect(tracks(0.3333)).toBe("minmax(0, 33.3fr) minmax(0, 66.7fr)");
    });
});

describe("shareAt", () => {
    it("puts the line in the middle of the gap", () => {
        // tracks start at 6, 497 + 497 with a 6px gap: the middle of the gap is 6 + 497 + 3 = 506
        expect(shareAt(506, 6, 497, 497, 6)).toBeCloseTo(0.5);
        expect(shareAt(6 + 3 + 397.6, 6, 497, 497, 6)).toBeCloseTo(0.4);
    });
    it("clamps a pointer past the edge", () => {
        expect(shareAt(0, 6, 497, 497, 6)).toBeCloseTo(0.2012, 3);
    });
});

describe("sashSpans", () => {
    it("has no sash for one cell", () => {
        expect(sashSpans(placementFor(1))).toEqual({ col: null, row: null });
    });
    it("has a full-height column sash for two side by side", () => {
        expect(sashSpans(placementFor(2))).toEqual({ col: { row: 1, rowSpan: 2 }, row: null });
    });
    it("splits only the top row when the third cell spans the bottom", () => {
        expect(sashSpans(placementFor(3))).toEqual({ col: { row: 1, rowSpan: 1 }, row: { col: 1, colSpan: 2 } });
    });
    it("has both full sashes for four", () => {
        expect(sashSpans(placementFor(4))).toEqual({ col: { row: 1, rowSpan: 2 }, row: { col: 1, colSpan: 2 } });
    });
    it("splits only the right column when the left cell spans both rows", () => {
        const places = [
            { row: 1, col: 1, rowSpan: 2, colSpan: 1 },
            { row: 1, col: 2, rowSpan: 1, colSpan: 1 },
            { row: 2, col: 2, rowSpan: 1, colSpan: 1 },
        ];
        expect(sashSpans(places)).toEqual({ col: { row: 1, rowSpan: 2 }, row: { col: 2, colSpan: 1 } });
    });
});

describe("parseGridSizes", () => {
    it("keeps only entries with both shares in range", () => {
        expect(
            parseGridSizes({
                a: { col: 0.3, row: 0.6 },
                b: { col: 2, row: 0.5 },
                c: null,
                d: { col: "0.4", row: 0.5 },
            })
        ).toEqual({ a: { col: 0.3, row: 0.6 } });
    });
    it("reads anything else as empty", () => {
        expect(parseGridSizes(null)).toEqual({});
        expect(parseGridSizes([1])).toEqual({});
        expect(parseGridSizes("x")).toEqual({});
    });
});
