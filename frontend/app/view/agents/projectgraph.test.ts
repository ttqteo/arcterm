// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { branchesShown, graphCardRows, graphCardSummary, rowChips } from "./projectgraph";

const commit = (hash: string, parents: string[], refs: string[] = []): HistoryCommit => ({
    hash,
    parents,
    author: "ttqteo",
    email: "",
    ts: 1_000,
    subject: `subject ${hash}`,
    refs,
});

const COMMITS = [
    commit("c3", ["c2", "f1"], ["HEAD -> refs/heads/main", "refs/remotes/origin/main"]),
    commit("f1", ["c1"], ["refs/heads/feat/x", "tag: refs/tags/v1.0"]),
    commit("c2", ["c1"]),
    commit("c1", []),
];

describe("graphCardRows", () => {
    it("puts the uncommitted row on top, hung off HEAD, when the checkout is dirty", () => {
        const rows = graphCardRows(COMMITS, "c3", 2, 5_000);
        expect(rows[0]).toMatchObject({ workingTree: true, parents: ["c3"], fileCount: 2 });
        expect(rows).toHaveLength(5);
    });

    it("has no uncommitted row on a clean checkout", () => {
        expect(graphCardRows(COMMITS, "c3", 0, 5_000).some((r) => r.workingTree)).toBe(false);
    });
});

describe("branchesShown", () => {
    it("lists each branch once, the checked-out one first, then local, then remote; no tags", () => {
        const rows = graphCardRows(COMMITS, "c3", 0, 5_000);
        expect(branchesShown(rows).map((r) => `${r.kind}:${r.label}`)).toEqual([
            "head:main",
            "branch:feat/x",
            "remote:origin/main",
        ]);
    });
});

describe("graphCardSummary", () => {
    it("counts the commits, not the uncommitted row, and the branches", () => {
        expect(graphCardSummary(graphCardRows(COMMITS, "c3", 3, 5_000))).toBe("4 commits · 3 branches");
    });

    it("says only the commits when no branch is in view", () => {
        expect(graphCardSummary(graphCardRows([commit("a", [])], "a", 0, 5_000))).toBe("1 commit");
    });
});

describe("rowChips", () => {
    it("folds chips past three into a count", () => {
        const [row] = graphCardRows(
            [commit("a", [], ["refs/heads/a", "refs/heads/b", "refs/heads/c", "refs/heads/d", "refs/heads/e"])],
            "a",
            0,
            5_000
        );
        const { chips, more } = rowChips(row);
        expect(chips.map((c) => c.label)).toEqual(["a", "b", "c"]);
        expect(more).toBe(2);
    });
});
