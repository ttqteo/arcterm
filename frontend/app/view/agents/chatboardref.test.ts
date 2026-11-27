import { describe, expect, it } from "vitest";
import type { BoardSplit } from "../boards/boardentries";
import { besideBoard, withBoardRef } from "./chatboardref";

const board: BoardSplit = { project: "thesis", boardId: "4e0f9655" };
const open = new Map([["thesis/4e0f9655", board]]);
const cell = "board:thesis/4e0f9655";

describe("besideBoard", () => {
    it("finds the open board in the agent's split, on either side", () => {
        const grids = { project: "thesis", grids: { thesis: { ids: [cell, "a1"], focused: "a1" } } };
        expect(besideBoard(grids, "a1", open)).toEqual(board);
    });

    it("is undefined for an agent alone, in a split with no board, or beside a closed board", () => {
        expect(besideBoard({ project: "p", grids: { p: { ids: ["a1"], focused: "a1" } } }, "a1", open)).toBeUndefined();
        expect(
            besideBoard({ project: "p", grids: { p: { ids: ["a1", "a2"], focused: "a1" } } }, "a1", open)
        ).toBeUndefined();
        const grids = { project: "thesis", grids: { thesis: { ids: ["a1", cell], focused: "a1" } } };
        expect(besideBoard(grids, "a1", new Map())).toBeUndefined();
        expect(besideBoard(grids, "a2", open)).toBeUndefined();
    });
});

describe("withBoardRef", () => {
    it("ends the message with the board's reference", () => {
        expect(withBoardRef("xem thử với board hiện tại", "4e0f9655")).toBe(
            "xem thử với board hiện tại board:4e0f9655"
        );
        expect(withBoardRef("vẽ lại band 3\n", "4e0f9655")).toBe("vẽ lại band 3 board:4e0f9655");
    });

    it("leaves a message that already names the board, by its id or a prefix of it", () => {
        expect(withBoardRef("sửa board:4e0f9655 đi", "4e0f9655")).toBe("sửa board:4e0f9655 đi");
        expect(withBoardRef("sửa board:4e0f đi", "4e0f9655")).toBe("sửa board:4e0f đi");
    });

    it("leaves empty text, a /command, a ! command and a missing board", () => {
        expect(withBoardRef("", "4e0f9655")).toBe("");
        expect(withBoardRef("  ", "4e0f9655")).toBe("  ");
        expect(withBoardRef("/compact", "4e0f9655")).toBe("/compact");
        expect(withBoardRef("! ls", "4e0f9655")).toBe("! ls");
        expect(withBoardRef("hello", undefined)).toBe("hello");
    });

    it("adds it beside another board's reference", () => {
        expect(withBoardRef("so với board:aaaa1111", "4e0f9655")).toBe("so với board:aaaa1111 board:4e0f9655");
    });
});
