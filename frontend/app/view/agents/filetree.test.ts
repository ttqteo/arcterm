// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { buildFileTree, listOrder, stepInList } from "./filetree";
import type { GitChange } from "./gitstatus";

const f = (path: string, adds = 1, dels = 0): GitChange => ({ path, status: "M", adds, dels });

describe("buildFileTree", () => {
    it("groups files under their directory, directory first", () => {
        const rows = buildFileTree([f("retry/policy.go"), f("retry/budget.go")], new Set());
        expect(rows.map((r) => [r.kind, r.label])).toEqual([
            ["dir", "retry"],
            ["file", "budget.go"],
            ["file", "policy.go"],
        ]);
    });

    it("rolls up counts onto the directory row", () => {
        const rows = buildFileTree([f("retry/policy.go", 10, 2), f("retry/budget.go", 5, 3)], new Set());
        const dir = rows[0];
        expect([dir.files, dir.adds, dir.dels]).toEqual([2, 15, 5]);
    });

    // an indented list of single-child directories is not a tree, it is a staircase
    it("collapses a single-child directory chain into one row", () => {
        const rows = buildFileTree([f("a/b/c/deep.go")], new Set());
        expect(rows.map((r) => r.label)).toEqual(["a/b/c", "deep.go"]);
    });

    it("hides the children of a collapsed directory but keeps its row", () => {
        const rows = buildFileTree([f("retry/policy.go"), f("server/submit.go")], new Set(["retry"]));
        expect(rows.map((r) => r.label)).toEqual(["retry", "server", "submit.go"]);
    });

    it("puts root-level files after the directories", () => {
        const rows = buildFileTree([f("README.md"), f("retry/policy.go")], new Set());
        expect(rows.map((r) => r.label)).toEqual(["retry", "policy.go", "README.md"]);
    });

    it("returns nothing for no files", () => {
        expect(buildFileTree([], new Set())).toEqual([]);
    });
});

describe("listOrder", () => {
    const files = [f("README.md"), f("retry/policy.go"), f("a.go"), f("retry/budget.go")];

    it("follows the tree: directories first, files sorted within", () => {
        expect(listOrder(files, true)).toEqual(["retry/budget.go", "retry/policy.go", "a.go", "README.md"]);
    });

    it("follows the input order when flat", () => {
        expect(listOrder(files, false)).toEqual(["README.md", "retry/policy.go", "a.go", "retry/budget.go"]);
    });

    // a chain of single-child directories is drawn as one row, which must not change where its files fall
    it("lists the files under a folded directory chain where the tree draws them", () => {
        const deep = [
            f("zeta.go"),
            f("web/app/view/b.ts"),
            f("web/app/view/a.ts"),
            f("web/app/store/s.ts"),
            f("docs/guide/intro.md"),
        ];
        // docs/guide and web/app each draw as one row
        expect(buildFileTree(deep, new Set()).map((r) => r.label)).toEqual([
            "docs/guide",
            "intro.md",
            "web/app",
            "store",
            "s.ts",
            "view",
            "a.ts",
            "b.ts",
            "zeta.go",
        ]);
        expect(listOrder(deep, true)).toEqual([
            "docs/guide/intro.md",
            "web/app/store/s.ts",
            "web/app/view/a.ts",
            "web/app/view/b.ts",
            "zeta.go",
        ]);
    });

    it("keeps a collapsed directory's files in the order: they are still next in line", () => {
        const two = [f("retry/policy.go"), f("server/submit.go")];
        // what the list draws with `retry` collapsed hides policy.go; the order a key steps through does not
        expect(
            buildFileTree(two, new Set(["retry"]))
                .filter((r) => r.kind === "file")
                .map((r) => r.id)
        ).toEqual(["server/submit.go"]);
        expect(listOrder(two, true)).toEqual(["retry/policy.go", "server/submit.go"]);
    });

    it("is empty for an empty list", () => {
        expect(listOrder([], true)).toEqual([]);
        expect(listOrder([], false)).toEqual([]);
    });
});

describe("stepInList", () => {
    const order = ["a", "b", "c"];

    it("steps forward and back", () => {
        expect(stepInList(order, "a", 1)).toBe("b");
        expect(stepInList(order, "c", -1)).toBe("b");
    });

    it("returns null past either end", () => {
        expect(stepInList(order, "c", 1)).toBeNull();
        expect(stepInList(order, "a", -1)).toBeNull();
    });

    it("starts at the first file when nothing is open", () => {
        expect(stepInList(order, null, 1)).toBe("a");
        expect(stepInList(order, null, -1)).toBeNull();
    });

    it("starts at the first file when the open one is not listed", () => {
        expect(stepInList(order, "gone", 1)).toBe("a");
        expect(stepInList(order, "gone", -1)).toBe("a");
    });

    it("has nowhere to go in an empty list", () => {
        expect(stepInList([], null, 1)).toBeNull();
        expect(stepInList([], "a", -1)).toBeNull();
    });
});
