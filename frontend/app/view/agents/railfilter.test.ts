// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { filterRows, matchSpan } from "./railfilter";

const PATHS = [
    "README.md",
    "obsidian_harness/huong_harness.html",
    "obsidian_harness/lit_review.html",
    "paper/sections/harness.tex",
    "paper/main.tex",
];

describe("matchSpan", () => {
    it("finds the query case-insensitively", () => {
        expect(matchSpan("README.md", "read")).toEqual([0, 4]);
        expect(matchSpan("huong_harness.html", " Harn ")).toEqual([6, 10]);
    });

    it("is null for a blank query or a miss", () => {
        expect(matchSpan("README.md", "  ")).toBeNull();
        expect(matchSpan("README.md", "tex")).toBeNull();
    });
});

describe("filterRows", () => {
    it("lists matching files under their folders, opened", () => {
        const { rows, count } = filterRows(PATHS, "harn");
        expect(count).toBe(2);
        expect(rows.map((r) => `${r.depth}:${r.kind}:${r.path}:${r.expanded}`)).toEqual([
            "0:dir:obsidian_harness:true",
            "1:file:obsidian_harness/huong_harness.html:false",
            "0:dir:paper:true",
            "1:dir:paper/sections:true",
            "2:file:paper/sections/harness.tex:false",
        ]);
    });

    it("matches a file's name, not the folders above it", () => {
        expect(filterRows(PATHS, "obsidian").count).toBe(0);
    });

    it("is empty on a miss", () => {
        expect(filterRows(PATHS, "zzz")).toEqual({ rows: [], count: 0 });
    });
});
