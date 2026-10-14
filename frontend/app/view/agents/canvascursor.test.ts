import { describe, expect, it } from "vitest";
import { changedLine, moveGalleryCursor } from "./canvascursor";
import type { GalleryCanvas } from "./canvasgallery";

// three groups of 5, 4 and 2 cards in a grid 3 wide:
//   0 1 2     5 6 7     9 10
//   3 4       8
const SIZES = [5, 4, 2];
const COLS = 3;

describe("moveGalleryCursor", () => {
    it("walks left and right through the drawn order, across a group's edge", () => {
        expect(moveGalleryCursor(SIZES, COLS, 4, "ArrowRight")).toBe(5);
        expect(moveGalleryCursor(SIZES, COLS, 5, "ArrowLeft")).toBe(4);
        expect(moveGalleryCursor(SIZES, COLS, 0, "ArrowLeft")).toBe(0);
        expect(moveGalleryCursor(SIZES, COLS, 10, "ArrowRight")).toBe(10);
    });

    it("moves down and up inside a group", () => {
        expect(moveGalleryCursor(SIZES, COLS, 0, "ArrowDown")).toBe(3);
        expect(moveGalleryCursor(SIZES, COLS, 3, "ArrowUp")).toBe(0);
        expect(moveGalleryCursor(SIZES, COLS, 5, "ArrowDown")).toBe(8);
    });

    it("goes down from a group's last row to the next group in the same column", () => {
        // 3 is on the last row of group 0, column 0; 4 is column 1; 2 has a short row under it
        expect(moveGalleryCursor(SIZES, COLS, 3, "ArrowDown")).toBe(5);
        expect(moveGalleryCursor(SIZES, COLS, 4, "ArrowDown")).toBe(6);
        expect(moveGalleryCursor(SIZES, COLS, 2, "ArrowDown")).toBe(4);
    });

    it("clamps to the next group's last card when it has fewer columns than the cursor's", () => {
        // 8 is the lone card of group 1's last row; group 2 has 2 cards, so column 0 only reaches 9
        expect(moveGalleryCursor(SIZES, COLS, 8, "ArrowDown")).toBe(9);
        expect(moveGalleryCursor([3, 1], COLS, 2, "ArrowDown")).toBe(3);
    });

    it("goes up from a group's first row to the previous group's last row in the same column", () => {
        expect(moveGalleryCursor(SIZES, COLS, 5, "ArrowUp")).toBe(3);
        expect(moveGalleryCursor(SIZES, COLS, 6, "ArrowUp")).toBe(4);
        // column 2 of group 0's last row is missing: the row's last card
        expect(moveGalleryCursor(SIZES, COLS, 7, "ArrowUp")).toBe(4);
        expect(moveGalleryCursor(SIZES, COLS, 9, "ArrowUp")).toBe(8);
    });

    it("stays put at the first and last row", () => {
        expect(moveGalleryCursor(SIZES, COLS, 1, "ArrowUp")).toBe(1);
        expect(moveGalleryCursor(SIZES, COLS, 10, "ArrowDown")).toBe(10);
        expect(moveGalleryCursor([3], COLS, 2, "ArrowDown")).toBe(2);
    });

    it("walks a single column (a narrow pane)", () => {
        expect(moveGalleryCursor([2, 2], 1, 0, "ArrowDown")).toBe(1);
        expect(moveGalleryCursor([2, 2], 1, 1, "ArrowDown")).toBe(2);
        expect(moveGalleryCursor([2, 2], 1, 2, "ArrowUp")).toBe(1);
    });

    it("clamps a stale cursor and survives no cards", () => {
        expect(moveGalleryCursor(SIZES, COLS, 99, "ArrowUp")).toBe(8);
        expect(moveGalleryCursor(SIZES, COLS, -4, "ArrowRight")).toBe(1);
        expect(moveGalleryCursor([], COLS, 3, "ArrowDown")).toBe(0);
        expect(moveGalleryCursor([0, 0], COLS, 0, "ArrowRight")).toBe(0);
    });

    it("skips an empty group between two full ones", () => {
        expect(moveGalleryCursor([2, 0, 2], COLS, 0, "ArrowDown")).toBe(2);
        expect(moveGalleryCursor([2, 0, 2], COLS, 2, "ArrowUp")).toBe(0);
    });
});

describe("changedLine", () => {
    const NOW = new Date(2026, 9, 14, 13, 37, 0).getTime();
    const canvas = (over: Partial<GalleryCanvas>): GalleryCanvas => ({
        topic: "run-office",
        project: "D:/work/arcterm",
        projectname: "arcterm",
        designdir: "D:/work/arcterm/.superpowers/design",
        dir: "D:/work/arcterm/.superpowers/design/run-office",
        boards: ["Main"],
        modts: NOW,
        thumbts: 0,
        bytes: 1,
        ...over,
    });

    it("puts changed before the time today and before the date otherwise", () => {
        expect(changedLine(canvas({ modts: new Date(2026, 9, 14, 13, 9).getTime() }), NOW)).toBe(
            "arcterm · changed 13:09"
        );
        expect(changedLine(canvas({ modts: new Date(2026, 9, 12, 8, 0).getTime() }), NOW)).toBe(
            "arcterm · changed 12 Oct"
        );
    });

    it("keeps a project name that holds the separator", () => {
        expect(changedLine(canvas({ projectname: "a · b", modts: NOW }), NOW)).toBe("a · b · changed 13:37");
    });
});
