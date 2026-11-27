import { describe, expect, it } from "vitest";
import { boardFocusTarget, focusedLayout, isBoardFocused, unfocusedLayout, type FocusLayout } from "./boardfocus";

const BOARD = "board:proj\u0000b1";

describe("boardFocusTarget", () => {
    it("is null without a board, or with the board alone", () => {
        expect(boardFocusTarget({ ids: ["a", "b"], focused: "a" })).toBeNull();
        expect(boardFocusTarget({ ids: [BOARD], focused: BOARD })).toBeNull();
        expect(boardFocusTarget({ ids: [], focused: null })).toBeNull();
    });

    it("gives the board 7 of 10 of the width beside the chat, on either side", () => {
        expect(boardFocusTarget({ ids: ["a", BOARD], focused: "a" })).toEqual({ axis: "col", share: 0.3 });
        expect(boardFocusTarget({ ids: [BOARD, "a"], focused: "a" })).toEqual({ axis: "col", share: 0.7 });
    });

    it("takes the row when the board spans the width below or above another cell", () => {
        const below = {
            ids: ["a", BOARD],
            focused: "a",
            places: [
                { row: 1, col: 1, rowSpan: 1, colSpan: 2 },
                { row: 2, col: 1, rowSpan: 1, colSpan: 2 },
            ],
        };
        expect(boardFocusTarget(below)).toEqual({ axis: "row", share: 0.3 });
        const above = { ...below, ids: [BOARD, "a"] };
        expect(boardFocusTarget(above)).toEqual({ axis: "row", share: 0.7 });
    });

    it("acts on the board's column in a three-cell grid", () => {
        // default 3-cell placement: two on top, the third across the bottom
        expect(boardFocusTarget({ ids: ["a", BOARD, "c"], focused: "a" })).toEqual({ axis: "col", share: 0.3 });
        expect(boardFocusTarget({ ids: ["a", "b", BOARD], focused: "a" })).toEqual({ axis: "row", share: 0.3 });
    });
});

describe("focus and back", () => {
    const before: FocusLayout = { treeFolded: false, railVisible: true, sizes: { col: 0.55, row: 0.4 } };

    it("folds the tree, hides the rail and moves only the target's axis", () => {
        expect(focusedLayout(before, "col", 0.3)).toEqual({
            treeFolded: true,
            railVisible: false,
            sizes: { col: 0.3, row: 0.4 },
        });
    });

    it("reads as focused only while every part is as the press left it", () => {
        const on = focusedLayout(before, "col", 0.3);
        expect(isBoardFocused(on, "col", 0.3)).toBe(true);
        expect(isBoardFocused({ ...on, railVisible: true }, "col", 0.3)).toBe(false);
        expect(isBoardFocused({ ...on, treeFolded: false }, "col", 0.3)).toBe(false);
        expect(isBoardFocused({ ...on, sizes: { col: 0.42, row: 0.4 } }, "col", 0.3)).toBe(false);
    });

    it("puts back what the press found, or the defaults with nothing kept", () => {
        const on = focusedLayout(before, "col", 0.3);
        expect(unfocusedLayout(on, before, "col")).toEqual(before);
        expect(unfocusedLayout(on, null, "col")).toEqual({
            treeFolded: false,
            railVisible: true,
            sizes: { col: 0.5, row: 0.4 },
        });
    });
});
