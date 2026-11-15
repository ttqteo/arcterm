// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { filterRows, matchSpan, rowMatchSpan } from "./railfilter";

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

    it("matches the whole path when the query has a slash", () => {
        expect(filterRows(PATHS, "obsidian_harness/").count).toBe(2);
        expect(filterRows(PATHS, "sections/harness.tex").count).toBe(1);
        expect(filterRows(PATHS, "Paper/Sections/Harness.TEX").count).toBe(1);
        expect(filterRows(PATHS, "./paper/main.tex").count).toBe(1);
        expect(filterRows(PATHS, "paper\\main.tex").count).toBe(1);
    });

    it("finds a file from a longer path that ends with it", () => {
        expect(filterRows(PATHS, "/Users/me/thesis/paper/main.tex").count).toBe(1);
        expect(filterRows(PATHS, "thesis/paper/main.tex").count).toBe(1);
        expect(filterRows(PATHS, "thesis/paper/other.tex").count).toBe(0);
    });
});

describe("rowMatchSpan", () => {
    const file = { kind: "file" as const, path: "paper/sections/harness.tex", name: "harness.tex" };

    it("bolds the query in the name for a name query", () => {
        expect(rowMatchSpan(file, "harn")).toEqual([0, 4]);
    });

    it("bolds the part of the name a path query covers", () => {
        expect(rowMatchSpan(file, "sections/harn")).toEqual([0, 4]);
        expect(rowMatchSpan(file, "sections/harness.tex")).toEqual([0, 11]);
        expect(rowMatchSpan(file, "/abs/paper/sections/harness.tex")).toEqual([0, 11]);
        expect(rowMatchSpan(file, "paper/sec")).toBeNull();
        expect(rowMatchSpan({ kind: "dir", path: "paper", name: "paper" }, "paper/")).toBeNull();
    });
});
