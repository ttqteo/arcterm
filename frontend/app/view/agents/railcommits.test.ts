// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
    commitRange,
    commitsOpenByDefault,
    commitsSummary,
    RAIL_COMMITS_CAP,
    railCommitRows,
    railCommitTitle,
    railWhere,
} from "./railcommits";

const NOW = 1_800_000_000_000;
const commit = (hash: string, parents: string[], minsAgo = 5): HistoryCommit => ({
    hash,
    parents,
    author: "ttqteo",
    email: "t@example.invalid",
    ts: NOW - minsAgo * 60_000,
    subject: `subject ${hash}`,
});

describe("railWhere", () => {
    const repo = { cwd: "D:\\src\\arcterm\\.worktrees\\97938ba4", branch: "wave/97938ba4", isRepo: true };

    it("names a linked worktree by its short name, the path in full", () => {
        expect(railWhere({ ...repo, worktree: ".worktrees/97938ba4" }, "arcterm")).toEqual({
            branch: "wave/97938ba4",
            place: "97938ba4",
            kind: "worktree",
            path: repo.cwd,
        });
    });

    it("names the main checkout by its project, else its folder", () => {
        const main = { cwd: "D:\\src\\arcterm", branch: "main", isRepo: true };
        expect(railWhere(main, "arcterm")).toMatchObject({ place: "arcterm", kind: "checkout" });
        expect(railWhere(main, "")).toMatchObject({ place: "arcterm", kind: "checkout" });
    });

    it("has nothing to say without a cwd or outside a repository", () => {
        expect(railWhere({ ...repo, cwd: null }, "arcterm")).toBeNull();
        expect(railWhere({ ...repo, isRepo: false }, "arcterm")).toBeNull();
    });
});

describe("commitRange", () => {
    const branchDiff = { base: "main", ref: "mb123", changes: { files: [], adds: 0, dels: 0 } };

    it("is the merge base on Branch, the session start on Session", () => {
        expect(commitRange("branch", { ref: "s0", branchDiff })).toEqual({
            from: "mb123",
            root: "branch",
            base: "main",
        });
        expect(commitRange("session", { ref: "s0", branchDiff })).toEqual({ from: "s0", root: "session" });
    });

    it("falls back to Session where there is no branch view, as the files list does", () => {
        expect(commitRange("branch", { ref: "s0" })).toEqual({ from: "s0", root: "session" });
    });

    it("has no range when the session start is unknown", () => {
        expect(commitRange("session", { ref: "" })).toBeNull();
        expect(commitRange("session", {})).toBeNull();
    });
});

describe("railCommitRows", () => {
    const branch = { from: "m1", root: "branch" as const, base: "main" };

    it("puts the uncommitted row on top, the commits, then the range's root", () => {
        const v = railCommitRows([commit("c2", ["c1"]), commit("c1", ["m1"])], branch, {
            head: "c2",
            uncommitted: 3,
            now: NOW,
        });
        expect(v.rows.map((r) => r.hash)).toEqual(["", "c2", "c1", "m1"]);
        expect(v.rows[0]).toMatchObject({ workingTree: true, fileCount: 3, parents: ["c2"] });
        expect(v.rows[3]).toMatchObject({ boundary: true, subject: "branched off here", parents: [] });
        expect(v.rows[3].refs).toEqual([{ label: "main", kind: "branch" }]);
        expect(v.count).toBe(2);
        expect(v.more).toBe(false);
    });

    it("roots a session range at the session's start", () => {
        const v = railCommitRows(
            [commit("c1", ["s0"])],
            { from: "s0", root: "session" },
            { head: "c1", uncommitted: 0, now: NOW }
        );
        expect(v.rows.map((r) => r.hash)).toEqual(["c1", "s0"]);
        expect(v.rows[1]).toMatchObject({ boundary: true, subject: "session started here", refs: [] });
    });

    it("caps the list and drops the root, which is no longer next to the last row", () => {
        const many = Array.from({ length: RAIL_COMMITS_CAP + 1 }, (_, i) => commit(`c${i}`, [`c${i + 1}`]));
        const v = railCommitRows(many, branch, { head: "c0", uncommitted: 0, now: NOW });
        expect(v.count).toBe(RAIL_COMMITS_CAP);
        expect(v.more).toBe(true);
        expect(v.rows.some((r) => r.boundary)).toBe(false);
    });

    it("is empty with no commits and nothing uncommitted, and holds the uncommitted row alone otherwise", () => {
        expect(railCommitRows([], branch, { head: "m1", uncommitted: 0, now: NOW }).rows).toEqual([]);
        const v = railCommitRows([], branch, { head: "m1", uncommitted: 2, now: NOW });
        expect(v.rows.map((r) => r.hash)).toEqual(["", "m1"]);
        expect(v.count).toBe(0);
    });
});

describe("railCommitTitle", () => {
    it("is sha · subject · author · age", () => {
        const v = railCommitRows(
            [commit("abcdef1234", ["m1"], 12)],
            { from: "m1", root: "session" },
            {
                head: "abcdef1234",
                uncommitted: 0,
                now: NOW,
            }
        );
        expect(railCommitTitle(v.rows[0])).toBe(`abcdef1 · subject abcdef1234 · ttqteo · ${v.rows[0].when}`);
    });
});

describe("folding", () => {
    it("opens at five commits or fewer", () => {
        expect(commitsOpenByDefault(5)).toBe(true);
        expect(commitsOpenByDefault(6)).toBe(false);
    });

    it("sums a folded section up by its newest commit and, on Branch, its base", () => {
        const v = railCommitRows(
            [commit("c1", ["m1"], 12)],
            { from: "m1", root: "branch", base: "main" },
            {
                head: "c1",
                uncommitted: 0,
                now: NOW,
            }
        );
        expect(commitsSummary(v, { from: "m1", root: "branch", base: "main" })).toBe(
            `newest ${v.rows[0].when} · since main`
        );
        expect(commitsSummary(v, { from: "m1", root: "session" })).toBe(`newest ${v.rows[0].when}`);
        expect(commitsSummary({ rows: [], count: 0, more: false }, { from: "m1", root: "session" })).toBe("");
    });
});
