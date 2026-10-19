// frontend/app/view/code/codefinder.test.ts
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { parseFinderQuery, rankPaths } from "./codefinder";

describe("rankPaths", () => {
    it("ranks a basename hit above a match scattered through directory names", () => {
        const paths = ["a/g/e/n/t/r/o/w/other.ts", "frontend/app/view/agents/agentrow.tsx"];
        expect(rankPaths("agentrow", paths, 10)[0].path).toBe("frontend/app/view/agents/agentrow.tsx");
    });

    it("still matches on directory names when the basename does not match", () => {
        const paths = ["frontend/app/view/agents/row.tsx"];
        expect(rankPaths("agents", paths, 10).map((m) => m.path)).toEqual(["frontend/app/view/agents/row.tsx"]);
    });

    it("drops paths the query cannot match at all", () => {
        expect(rankPaths("zzz", ["src/main.ts"], 10)).toEqual([]);
    });

    it("is case-insensitive", () => {
        expect(rankPaths("MAIN", ["src/main.ts"], 10)).toHaveLength(1);
    });

    it("returns the first paths unranked for an empty query", () => {
        const paths = ["b.ts", "a.ts", "c.ts"];
        expect(rankPaths("", paths, 2).map((m) => m.path)).toEqual(["b.ts", "a.ts"]);
    });

    it("treats a whitespace-only query as empty", () => {
        expect(rankPaths("   ", ["b.ts", "a.ts"], 1).map((m) => m.path)).toEqual(["b.ts"]);
    });

    it("lists recent files first for an empty query, then the rest in index order", () => {
        const paths = ["a.ts", "b.ts", "c.ts", "d.ts"];
        expect(rankPaths("", paths, 3, ["c.ts", "a.ts"]).map((m) => m.path)).toEqual(["c.ts", "a.ts", "b.ts"]);
    });

    it("skips a recent file the index no longer has", () => {
        expect(rankPaths("", ["a.ts"], 5, ["gone.ts", "a.ts"]).map((m) => m.path)).toEqual(["a.ts"]);
    });

    it("honors the limit", () => {
        const paths = ["m1.ts", "m2.ts", "m3.ts", "m4.ts"];
        expect(rankPaths("m", paths, 2)).toHaveLength(2);
    });

    it("breaks score ties by path so the order is stable", () => {
        const ranked = rankPaths("m", ["z/m.ts", "a/m.ts"], 10);
        expect(ranked[0].path).toBe("a/m.ts");
    });

    it("prefers the file itself over its test sibling on an exact basename stem", () => {
        const paths = ["frontend/app/view/code/codefinder.test.ts", "frontend/app/view/code/codefinder.ts"];
        expect(rankPaths("codefinder", paths, 10)[0].path).toBe("frontend/app/view/code/codefinder.ts");
    });

    it("prefers a basename that starts with the query over one that merely contains it", () => {
        const paths = ["docs/2026-09-04-code-surface-scan.md", "frontend/app/view/code/codestore.ts"];
        expect(rankPaths("code", paths, 10)[0].path).toBe("frontend/app/view/code/codestore.ts");
    });

    it("ands space-separated terms instead of matching the space literally", () => {
        const paths = ["frontend/app/view/agents/usagestats.ts", "pkg/other/nothing.go"];
        expect(rankPaths("usage stats", paths, 10).map((m) => m.path)).toEqual([
            "frontend/app/view/agents/usagestats.ts",
        ]);
    });

    it("lets space-separated terms match in any order across the path", () => {
        const paths = ["pkg/wshrpc/wshserver/wshserver_git.go"];
        expect(rankPaths("git wshserver", paths, 10).map((m) => m.path)).toEqual([
            "pkg/wshrpc/wshserver/wshserver_git.go",
        ]);
    });

    it("drops a path that matches only some of the terms", () => {
        expect(rankPaths("code missing", ["frontend/app/view/code/codestore.ts"], 10)).toEqual([]);
    });

    it("scores a basename that starts with the term at its fuzzy score plus both bonuses", () => {
        expect(rankPaths("m", ["a/m.ts"], 10)).toEqual([{ path: "a/m.ts", score: 39 }]);
    });

    it("scores a basename that merely contains the term without the prefix bonus", () => {
        expect(rankPaths("m", ["docs/xm.ts"], 10)).toEqual([{ path: "docs/xm.ts", score: 21 }]);
    });

    it("scores an uppercase query as the lowercase one", () => {
        expect(rankPaths("M", ["a/m.ts"], 10)).toEqual([{ path: "a/m.ts", score: 39 }]);
    });

    it("keeps the full-path score when it beats the basename score", () => {
        const path = "abcdefghijkl/axxxbxxxcxxxdxxxexxxfxxxg.ts";
        expect(rankPaths("abcdefg", [path], 10)).toEqual([{ path, score: 40 }]);
    });

    it("keeps a path whose only match is in the directories, even at a zero score", () => {
        const path = "axxxbxxxc/q.ts";
        expect(rankPaths("abc", [path], 10)).toEqual([{ path, score: 0 }]);
    });

    it("sums the score of every term", () => {
        expect(rankPaths("a b", ["a/b.ts"], 10)).toEqual([{ path: "a/b.ts", score: 43 }]);
    });

    it("lists the index in order for an empty query when no recent files are given", () => {
        expect(rankPaths("", ["a.ts", "Stryker was here"], 5).map((m) => m.path)).toEqual(["a.ts", "Stryker was here"]);
    });
});

describe("parseFinderQuery", () => {
    it("splits a trailing :line off the path", () => {
        expect(parseFinderQuery("app/store/codestore.ts:152")).toEqual({
            text: "app/store/codestore.ts",
            line: 152,
        });
    });

    it("reads a bare :line as a jump within the open file", () => {
        expect(parseFinderQuery(":152")).toEqual({ text: "", line: 152 });
    });

    it("leaves a query with no line alone", () => {
        expect(parseFinderQuery("codestore.ts")).toEqual({ text: "codestore.ts" });
    });

    it("does not treat digits in a filename as a line", () => {
        expect(parseFinderQuery("file2.ts")).toEqual({ text: "file2.ts" });
    });

    it("treats a trailing colon with no digits as still-typing text", () => {
        expect(parseFinderQuery("codestore.ts:")).toEqual({ text: "codestore.ts:" });
    });

    it("takes only the last :line when there are several", () => {
        expect(parseFinderQuery("a:1:2")).toEqual({ text: "a:1", line: 2 });
    });

    it("trims surrounding whitespace", () => {
        expect(parseFinderQuery("  a.ts:9  ")).toEqual({ text: "a.ts", line: 9 });
    });
});
