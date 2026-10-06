// frontend/app/view/code/codetree.test.ts
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { ancestorsOf, buildTree, dirsToList, lazyDirs, visibleRows } from "./codetree";

const PATHS = ["README.md", "src/app/main.ts", "src/app/util.ts", "src/lib.ts", "docs/a/b/c.md"];

describe("buildTree", () => {
    it("puts directories before files, each alphabetically", () => {
        const tree = buildTree(PATHS);
        expect(tree.map((n) => n.name)).toEqual(["docs", "src", "README.md"]);
        expect(tree.map((n) => n.isDir)).toEqual([true, true, false]);
    });

    it("nests children under their directory with full repo-relative paths", () => {
        const tree = buildTree(PATHS);
        const src = tree.find((n) => n.name === "src");
        expect(src?.children.map((n) => n.path)).toEqual(["src/app", "src/lib.ts"]);
    });

    it("keeps a deep single-child chain intact", () => {
        const tree = buildTree(["docs/a/b/c.md"]);
        expect(tree[0].children[0].children[0].children[0].path).toBe("docs/a/b/c.md");
    });

    it("handles a flat list with no directories", () => {
        expect(buildTree(["b.ts", "a.ts"]).map((n) => n.name)).toEqual(["a.ts", "b.ts"]);
    });

    it("returns an empty array for an empty repo", () => {
        expect(buildTree([])).toEqual([]);
    });
});

describe("visibleRows", () => {
    it("shows only top-level rows when nothing is expanded", () => {
        const rows = visibleRows(buildTree(PATHS), new Set());
        expect(rows.map((r) => r.path)).toEqual(["docs", "src", "README.md"]);
        expect(rows.every((r) => r.depth === 0)).toBe(true);
    });

    it("reveals the children of an expanded directory and marks it expanded", () => {
        const rows = visibleRows(buildTree(PATHS), new Set(["src"]));
        expect(rows.map((r) => r.path)).toEqual(["docs", "src", "src/app", "src/lib.ts", "README.md"]);
        expect(rows.find((r) => r.path === "src")?.expanded).toBe(true);
        expect(rows.find((r) => r.path === "src/app")?.depth).toBe(1);
    });

    it("does not reveal grandchildren unless the intermediate directory is also expanded", () => {
        const rows = visibleRows(buildTree(PATHS), new Set(["src", "src/app"]));
        expect(rows.map((r) => r.path)).toContain("src/app/main.ts");
        const shallow = visibleRows(buildTree(PATHS), new Set(["src"]));
        expect(shallow.map((r) => r.path)).not.toContain("src/app/main.ts");
    });
});

describe("ancestorsOf", () => {
    it("lists every directory above a file, outermost first", () => {
        expect(ancestorsOf("docs/a/b/c.md")).toEqual(["docs", "docs/a", "docs/a/b"]);
    });

    it("returns nothing for a root-level file", () => {
        expect(ancestorsOf("README.md")).toEqual([]);
    });
});

describe("ignored entries", () => {
    const tracked = ["src/a.ts", "README.md"];
    const ignored = ["node_modules/", "src/debug.log", ".env"];

    it("shows ignored files and directories, flagged", () => {
        const rows = visibleRows(buildTree(tracked, ignored), new Set(["src"]));
        expect(rows.map((r) => [r.path, r.kind, r.ignored ?? false])).toEqual([
            ["node_modules", "dir", true],
            ["src", "dir", false],
            ["src/a.ts", "file", false],
            ["src/debug.log", "file", true],
            [".env", "file", true],
            ["README.md", "file", false],
        ]);
    });

    it("flags everything listed under an ignored directory", () => {
        const listed = [...ignored, "node_modules/pkg/", "node_modules/top.js"];
        const rows = visibleRows(buildTree(tracked, listed), new Set(["node_modules"]));
        expect(rows.filter((r) => r.path.startsWith("node_modules/")).map((r) => [r.path, r.ignored])).toEqual([
            ["node_modules/pkg", true],
            ["node_modules/top.js", true],
        ]);
    });

    it("keeps a tracked directory unflagged when ignored files sit in it", () => {
        const rows = visibleRows(buildTree(tracked, ignored), new Set());
        expect(rows.find((r) => r.path === "src")?.ignored).toBeUndefined();
    });

    it("lists only the expanded lazy directories not yet listed", () => {
        const lazy = lazyDirs([...ignored, "node_modules/pkg/"]);
        expect([...lazy]).toEqual(["node_modules", "node_modules/pkg"]);
        expect(
            dirsToList(new Set(["src", "node_modules", "node_modules/pkg"]), lazy, new Set(["node_modules"]))
        ).toEqual(["node_modules/pkg"]);
    });
});
