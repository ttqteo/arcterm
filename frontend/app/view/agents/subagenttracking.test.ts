// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { enterRefreshes } from "./subagenttracking";

describe("enterRefreshes", () => {
    it("enterRefreshes reads a new id", () => {
        const tracked = new Map([["a", "/a.jsonl"]]);
        expect(
            enterRefreshes(tracked, [
                { id: "a", transcriptPath: "/a.jsonl" },
                { id: "b", transcriptPath: "/b.jsonl" },
            ])
        ).toEqual(["b"]);
    });
    it("enterRefreshes reads an id whose path arrived", () => {
        const tracked = new Map<string, string | undefined>([["a", undefined]]);
        expect(enterRefreshes(tracked, [{ id: "a", transcriptPath: "/a.jsonl" }])).toEqual(["a"]);
    });
    it("enterRefreshes reads an id whose path changed", () => {
        const tracked = new Map<string, string | undefined>([["a", "/old.jsonl"]]);
        expect(enterRefreshes(tracked, [{ id: "a", transcriptPath: "/new.jsonl" }])).toEqual(["a"]);
    });
    it("enterRefreshes skips an unchanged id", () => {
        const tracked = new Map<string, string | undefined>([
            ["a", "/a.jsonl"],
            ["b", undefined],
        ]);
        expect(enterRefreshes(tracked, [{ id: "a", transcriptPath: "/a.jsonl" }, { id: "b" }])).toEqual([]);
    });
});
