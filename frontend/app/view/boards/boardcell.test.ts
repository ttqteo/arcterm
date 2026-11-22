// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { placesOf, type GridState } from "../agents/agentgrid";
import { boardCellAgent, boardCellId, boardCellIds, isBoardCell, openBoardCellIn } from "./boardcell";

const g = (ids: string[], focused: string | null = ids[0] ?? null): GridState => ({ ids, focused });

describe("the board cell id", () => {
    it("round trips an agent id", () => {
        expect(boardCellId("a1")).toBe("board:a1");
        expect(boardCellAgent("board:a1")).toBe("a1");
        expect(isBoardCell("board:a1")).toBe(true);
    });
    it("is undefined for an agent or terminal id, and for a bare prefix", () => {
        expect(boardCellAgent("a1")).toBeUndefined();
        expect(isBoardCell("a1")).toBe(false);
        expect(boardCellAgent("board:")).toBeUndefined();
    });
});

describe("boardCellIds", () => {
    it("is a board cell for each agent that is eligible and has a board open", () => {
        expect(boardCellIds(new Set(["a", "b"]), new Set(["b", "c"]))).toEqual(["board:b"]);
    });
    it("is none with no board open", () => {
        expect(boardCellIds(new Set(["a"]), new Set())).toEqual([]);
    });
});

describe("openBoardCellIn", () => {
    it("puts the board right of a lone agent", () => {
        const next = openBoardCellIn(g(["a"]), "a");
        expect(next.ids).toEqual(["a", "board:a"]);
        expect(next.focused).toBe("a");
    });

    it("adds the board to a grid with room and keeps the agent the focused cell", () => {
        const next = openBoardCellIn(g(["a", "t"], "t"), "a");
        expect(next.ids).toHaveLength(3);
        expect(next.ids).toEqual(expect.arrayContaining(["a", "t", "board:a"]));
        expect(next.ids.indexOf("board:a")).toBeGreaterThan(next.ids.indexOf("a"));
        expect(next.focused).toBe("a");
    });

    it("is unchanged when the board cell is already there", () => {
        const grid = g(["a", "b", "c", "board:a"], "a");
        expect(openBoardCellIn(grid, "a")).toEqual(grid);
    });

    it("full grid replaces the last other cell", () => {
        const grid = g(["x", "a", "y", "z"], "a");
        const next = openBoardCellIn(grid, "a");
        expect(next.ids).toEqual(["x", "a", "y", "board:a"]);
        expect(placesOf(next)).toEqual(placesOf(grid));
        expect(next.focused).toBe("a");
    });

    it("a full grid keeps the focused cell even when it is the last one", () => {
        const next = openBoardCellIn(g(["x", "a", "y", "z"], "z"), "a");
        expect(next.ids).toEqual(["x", "a", "board:a", "z"]);
        expect(next.focused).toBe("a");
    });

    it("starts a grid of its own for an agent with no cell here", () => {
        expect(openBoardCellIn(g(["x", "y"]), "a")).toEqual({ ids: ["a", "board:a"], focused: "a" });
    });
});
