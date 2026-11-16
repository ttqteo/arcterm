// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { nextCellOrder } from "./cellorder";

describe("nextCellOrder", () => {
    it("starts in the roster's order", () => {
        expect(nextCellOrder([], ["a", "b", "t1"])).toEqual(["a", "b", "t1"]);
    });

    it("keeps a launch's place when it turns from a terminal into an agent that sorts first", () => {
        // before: agents [a], terminals [new]; after: agents [new, a], terminals []
        const first = nextCellOrder([], ["a", "new"]);
        const next = nextCellOrder(first, ["new", "a"]);
        expect(next).toBe(first);
        expect(next).toEqual(["a", "new"]);
    });

    it("puts a tab that opens after the rest, wherever the roster sorts it", () => {
        expect(nextCellOrder(["a", "b"], ["c", "a", "b"])).toEqual(["a", "b", "c"]);
    });

    it("drops a closed tab and keeps the others where they were", () => {
        expect(nextCellOrder(["a", "b", "c"], ["c", "a"])).toEqual(["a", "c"]);
    });

    it("returns the same array when nothing changed", () => {
        const prev = ["a", "b"];
        expect(nextCellOrder(prev, ["b", "a"])).toBe(prev);
    });
});
