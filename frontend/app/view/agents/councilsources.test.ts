// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
    foldSources,
    groupSources,
    hunkLabel,
    MAX_HUNK_ROWS,
    parseSourceRef,
    pastEndWords,
    sourceDir,
    sourceExcerpt,
    sourceFilePath,
} from "./councilsources";

const lines = (n: number) => Array.from({ length: n }, (_, i) => `line ${i + 1}`).join("\n") + "\n";

describe("parseSourceRef", () => {
    it("reads a path and a line", () => {
        expect(parseSourceRef("pkg/council/parse.go:70")).toEqual({
            path: "pkg/council/parse.go",
            lines: { start: 70, end: 70 },
        });
    });

    it("reads a run, either dash, either way round", () => {
        expect(parseSourceRef("a.ts:12-20")?.lines).toEqual({ start: 12, end: 20 });
        expect(parseSourceRef("a.ts:20–12")?.lines).toEqual({ start: 12, end: 20 });
    });

    it("drops a column after the line", () => {
        expect(parseSourceRef("a.ts:12:5")).toEqual({ path: "a.ts", lines: { start: 12, end: 12 } });
    });

    it("keeps a Windows drive and turns its slashes", () => {
        expect(parseSourceRef("C:\\code\\a.ts:3")).toEqual({ path: "C:/code/a.ts", lines: { start: 3, end: 3 } });
    });

    it("reads a bare path as a file with no line", () => {
        expect(parseSourceRef("./docs/README.md")).toEqual({ path: "docs/README.md", lines: null });
    });

    it("is null for a screenshot region and for nothing", () => {
        expect(parseSourceRef("screenshot:shot.png#header")).toBeNull();
        expect(parseSourceRef("  ")).toBeNull();
    });
});

describe("groupSources", () => {
    it("folds a file's refs into one group, its lines ascending, in the order files are first cited", () => {
        const v = groupSources([
            "notes_app/prompts/14_m4.md:46",
            "notes_app/prompts/14_m4.md:44",
            "history/memory/verdict.md:13",
            "notes_app/prompts/14_m4.md:46",
        ]);
        expect(v.groups.map((g) => [g.name, g.label])).toEqual([
            ["14_m4.md", ":44, 46"],
            ["verdict.md", ":13"],
        ]);
        expect(v.groups[0].path).toBe("notes_app/prompts/14_m4.md");
        expect(v.others).toEqual([]);
    });

    it("names two files that share a name by as much of their folders as tells them apart", () => {
        const v = groupSources(["README.md:1", "docs/README.md:2", "docs/guide/a.md:3", "spec/guide/a.md:4"]);
        expect(v.groups.map((g) => g.name)).toEqual([
            "README.md",
            "docs/README.md",
            "docs/guide/a.md",
            "spec/guide/a.md",
        ]);
    });

    it("labels a run and a file cited with no line", () => {
        const v = groupSources(["a.ts:12-20", "a.ts:3", "b.ts"]);
        expect(v.groups.map((g) => g.label)).toEqual([":3, 12–20", ""]);
    });

    it("keeps a screenshot region as cited, apart from the files", () => {
        const v = groupSources(["screenshot:s.png#top", "a.ts:1"]);
        expect(v.groups.map((g) => g.name)).toEqual(["a.ts"]);
        expect(v.others).toEqual(["screenshot:s.png#top"]);
    });
});

describe("sourceFilePath and sourceDir", () => {
    it("puts a relative path under the project and leaves an absolute one", () => {
        expect(sourceFilePath("/Users/me/project/", "notes_app/a.md")).toBe(
            "/Users/me/project/notes_app/a.md"
        );
        expect(sourceFilePath("/Users/me/thesis", "/etc/hosts")).toBe("/etc/hosts");
        expect(sourceFilePath("D:\\code\\x", "C:/y/a.ts")).toBe("C:/y/a.ts");
    });

    it("reads the folder of a path", () => {
        expect(sourceDir("notes_app/prompts/a.md")).toBe("notes_app/prompts/");
        expect(sourceDir("a.md")).toBe("");
    });
});

describe("sourceExcerpt", () => {
    it("lights the cited lines with one line each side, and keeps runs that do not touch apart", () => {
        const x = sourceExcerpt(lines(60), [
            { start: 45, end: 45 },
            { start: 49, end: 49 },
        ]);
        expect(x.hunks.map(hunkLabel)).toEqual(["Lines 44–46", "Lines 48–50"]);
        expect(x.hunks[0].rows.map((r) => [r.n, r.cited])).toEqual([
            [44, false],
            [45, true],
            [46, false],
        ]);
        expect(x.hunks[1].rows[1].text).toBe("line 49");
        expect(x.lineCount).toBe(60);
    });

    it("merges runs that overlap or touch", () => {
        const x = sourceExcerpt(lines(60), [
            { start: 46, end: 46 },
            { start: 44, end: 44 },
            { start: 50, end: 50 },
        ]);
        expect(x.hunks.map(hunkLabel)).toEqual(["Lines 43–47", "Lines 49–51"]);
        const y = sourceExcerpt(lines(60), [
            { start: 10, end: 10 },
            { start: 13, end: 13 },
        ]);
        expect(y.hunks.map(hunkLabel)).toEqual(["Lines 9–14"]);
    });

    it("stops at the file's ends", () => {
        const x = sourceExcerpt(lines(5), [
            { start: 1, end: 1 },
            { start: 5, end: 5 },
        ]);
        expect(x.hunks.map(hunkLabel)).toEqual(["Lines 1–2", "Lines 4–5"]);
    });

    it("names a cited line the file no longer reaches", () => {
        const x = sourceExcerpt(lines(5), [{ start: 146, end: 146 }]);
        expect(x.hunks).toEqual([]);
        expect(x.pastEnd).toEqual([146]);
        expect(pastEndWords(x)).toBe(
            "Line 146 is past the end of the file (5 lines): it has changed since the council ran."
        );
        const y = sourceExcerpt(lines(5), [
            { start: 2, end: 2 },
            { start: 9, end: 9 },
            { start: 12, end: 12 },
        ]);
        expect(pastEndWords(y)).toBe(
            "Lines 9, 12 are past the end of the file (5 lines): it has changed since the council ran."
        );
        expect(pastEndWords(sourceExcerpt(lines(5), [{ start: 2, end: 2 }]))).toBe("");
    });

    it("shows the head of a file cited with no line", () => {
        const x = sourceExcerpt(lines(100), []);
        expect(x.hunks.map(hunkLabel)).toEqual(["Lines 1–40"]);
        expect(x.hunks[0].rows.every((r) => !r.cited)).toBe(true);
    });

    it("cuts a very long cited run", () => {
        const x = sourceExcerpt(lines(1000), [{ start: 1, end: 900 }]);
        expect(x.hunks[0].cut).toBe(true);
        expect(x.hunks[0].rows.filter((r) => r.cited)).toHaveLength(MAX_HUNK_ROWS);
    });

    it("reads Windows line ends", () => {
        const x = sourceExcerpt("a\r\nb\r\nc\r\n", [{ start: 2, end: 2 }]);
        expect(x.hunks[0].rows.map((r) => r.text)).toEqual(["a", "b", "c"]);
        expect(x.lineCount).toBe(3);
    });
});

describe("foldSources", () => {
    it("shows two files and folds the rest into one count", () => {
        expect(foldSources(["a", "b", "c"])).toEqual({ shown: ["a", "b"], more: "+1 file" });
        expect(foldSources(["a", "b", "c", "d"])).toEqual({ shown: ["a", "b"], more: "+2 files" });
    });

    it("folds nothing at two files or fewer", () => {
        expect(foldSources(["a", "b"])).toEqual({ shown: ["a", "b"], more: "" });
        expect(foldSources([])).toEqual({ shown: [], more: "" });
    });
});
