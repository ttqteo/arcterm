// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { splitMenuState } from "./splitmenu";

const agent = (id: string, blockId: string | undefined = `b-${id}`, project?: string) => ({
    id,
    name: `agent-${id}`,
    blockId,
    project,
});

describe("splitMenuState", () => {
    it("offers every other live agent when the grid is just the focused one", () => {
        const s = splitMenuState([agent("a"), agent("b"), agent("c")], ["a"]);
        expect(s.targets.map((t) => t.id)).toEqual(["b", "c"]);
        expect(s.cells).toBe(1);
        expect(s.full).toBe(false);
    });

    it("leaves out an agent that is already a cell", () => {
        const s = splitMenuState([agent("a"), agent("b"), agent("c")], ["a", "b"]);
        expect(s.targets.map((t) => t.id)).toEqual(["c"]);
        expect(s.cells).toBe(2);
    });

    it("leaves out an agent with no terminal", () => {
        // a launch whose terminal has not started has no block yet
        const s = splitMenuState([agent("a"), { id: "b", name: "agent-b" }], ["a"]);
        expect(s.targets).toEqual([]);
    });

    it("is empty with a single agent running", () => {
        const s = splitMenuState([agent("a")], ["a"]);
        expect(s.targets).toEqual([]);
        expect(s.full).toBe(false);
    });

    it("is full at four cells, still naming who is left out", () => {
        const s = splitMenuState([agent("a"), agent("b"), agent("c"), agent("d"), agent("e")], ["a", "b", "c", "d"]);
        expect(s.full).toBe(true);
        expect(s.targets.map((t) => t.id)).toEqual(["e"]);
    });

    it("takes the limit as an argument", () => {
        expect(splitMenuState([agent("a")], ["a", "b"], 2).full).toBe(true);
    });

    it("carries the project for the menu's second line", () => {
        const s = splitMenuState([agent("a"), agent("b", "b-b", "thesis")], ["a"]);
        expect(s.targets).toEqual([{ id: "b", name: "agent-b", project: "thesis" }]);
    });
});
