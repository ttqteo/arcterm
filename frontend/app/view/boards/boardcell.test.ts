// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { placesOf, type GridState } from "../agents/agentgrid";
import { boardCellId, boardCellIds, boardCellRef, isBoardCell, openBoardCellIn, replaceBoardCellIn } from "./boardcell";
import { parseBoardEntries, parseBoardKey } from "./boardentries";

const g = (ids: string[], focused: string | null = ids[0] ?? null): GridState => ({ ids, focused });
const X = "board:arc/x";
const Y = "board:arc/y";

describe("the board cell id", () => {
    it("round trips a board", () => {
        expect(boardCellId({ project: "arc", boardId: "x" })).toBe(X);
        expect(boardCellRef(X)).toEqual({ project: "arc", boardId: "x" });
        expect(isBoardCell(X)).toBe(true);
    });
    it("keeps a project with a slash in it: the id is after the last one", () => {
        const id = boardCellId({ project: "a/b", boardId: "x" });
        expect(boardCellRef(id)).toEqual({ project: "a/b", boardId: "x" });
    });
    it("is undefined for an agent or terminal id, and for a bare prefix", () => {
        expect(boardCellRef("a1")).toBeUndefined();
        expect(isBoardCell("a1")).toBe(false);
        expect(boardCellRef("board:")).toBeUndefined();
    });
    it("reads a cell saved before boards were cells of their own as a board cell of no board", () => {
        expect(isBoardCell("board:a1")).toBe(true);
        expect(boardCellRef("board:a1")).toBeUndefined();
    });
});

describe("boardCellIds", () => {
    it("is a board cell for each open board", () => {
        expect(
            boardCellIds([
                { project: "arc", boardId: "x" },
                { project: "arc", boardId: "y" },
            ])
        ).toEqual([X, Y]);
    });
});

describe("the stored list", () => {
    it("keeps each well-formed board once and drops the rest", () => {
        expect(
            parseBoardEntries([
                { project: "arc", boardId: "x" },
                { project: "arc", boardId: "x" },
                { project: "", boardId: "y" },
                { project: "arc", boardId: "a/b" },
                null,
                "x",
            ])
        ).toEqual([{ project: "arc", boardId: "x" }]);
    });
    it("is empty for the old per-agent map and anything else that is no list", () => {
        expect(parseBoardEntries({ a1: { project: "arc", boardId: "x" } })).toEqual([]);
        expect(parseBoardEntries(null)).toEqual([]);
    });
    it("reads no board from a key with no id", () => {
        expect(parseBoardKey("arc/")).toBeUndefined();
        expect(parseBoardKey("x")).toBeUndefined();
    });
});

describe("openBoardCellIn", () => {
    it("puts the board right of the chat it was opened from", () => {
        const next = openBoardCellIn(g(["a"]), X, "a");
        expect(next.ids).toEqual(["a", X]);
        expect(next.focused).toBe("a");
    });

    it("goes right of the chat in a grid with room, and leaves the focus where it was", () => {
        const next = openBoardCellIn(g(["a", "t"], "t"), X, "a");
        expect(next.ids).toHaveLength(3);
        expect(next.ids.indexOf(X)).toBeGreaterThan(next.ids.indexOf("a"));
        expect(next.focused).toBe("t");
    });

    it("goes right of the focused cell when the chat has no cell here", () => {
        const next = openBoardCellIn(g(["t", "u"], "u"), X, "a");
        expect(next.ids).toEqual(expect.arrayContaining(["t", "u", X]));
        expect(next.ids.indexOf(X)).toBeGreaterThan(next.ids.indexOf("u"));
        expect(next.focused).toBe("u");
    });

    it("sits beside another board: two boards in one split", () => {
        const next = openBoardCellIn(g(["a", Y], "a"), X, "a");
        expect(next.ids).toEqual(expect.arrayContaining(["a", X, Y]));
    });

    it("is unchanged when the board cell is already there", () => {
        const grid = g(["a", "b", "c", X], "a");
        expect(openBoardCellIn(grid, X, "a")).toEqual(grid);
    });

    it("full grid replaces the last other cell", () => {
        const grid = g(["x", "a", "y", "z"], "a");
        const next = openBoardCellIn(grid, X, "a");
        expect(next.ids).toEqual(["x", "a", "y", X]);
        expect(placesOf(next)).toEqual(placesOf(grid));
        expect(next.focused).toBe("a");
    });

    it("a full grid keeps the focused cell even when it is the last one", () => {
        const next = openBoardCellIn(g(["x", "a", "y", "z"], "z"), X, "a");
        expect(next.ids).toEqual(["x", "a", X, "z"]);
        expect(next.focused).toBe("z");
    });

    it("starts a grid of its own for a chat with no cell in an empty grid", () => {
        expect(openBoardCellIn(g([]), X, "a")).toEqual({ ids: ["a", X], focused: "a" });
    });
});

describe("replaceBoardCellIn", () => {
    it("puts the new board in the old one's square", () => {
        const grid = g(["a", X, "b"], "b");
        const next = replaceBoardCellIn(grid, X, Y);
        expect(next.ids).toEqual(["a", Y, "b"]);
        expect(placesOf(next)).toEqual(placesOf(grid));
        expect(next.focused).toBe("b");
    });
    it("drops the old cell when the new board already has one", () => {
        expect(replaceBoardCellIn(g(["a", X, Y], "a"), X, Y).ids).toEqual(["a", Y]);
    });
    it("is unchanged when the old board has no cell", () => {
        const grid = g(["a"]);
        expect(replaceBoardCellIn(grid, X, Y)).toEqual(grid);
    });
});
