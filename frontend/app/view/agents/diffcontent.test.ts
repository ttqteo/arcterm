// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { firstDifferingLine, pairRefsFor } from "./diffcontent";

describe("pairRefsFor", () => {
    it("diffs the working tree against its anchor, reading the modified side from disk", () => {
        expect(pairRefsFor({ kind: "worktree", anchorRef: "abc1234" })).toEqual({
            original: { kind: "ref", ref: "abc1234" },
            modified: { kind: "worktree" },
        });
    });

    it("falls back to HEAD when the working-tree range has no anchor", () => {
        expect(pairRefsFor({ kind: "worktree", anchorRef: "" }).original).toEqual({ kind: "ref", ref: "HEAD" });
    });

    // a comment anchored to the symbolic HEAD reads as "against HEAD", which names a different commit
    // once the agent commits; the sha HEAD pointed at when the pair was read does not move
    it("anchors an unanchored working tree to the HEAD sha it was read against", () => {
        expect(pairRefsFor({ kind: "worktree", anchorRef: "", head: "f00dfeed" }).original).toEqual({
            kind: "ref",
            ref: "f00dfeed",
        });
    });

    it("keeps an explicit anchor over the HEAD sha", () => {
        expect(pairRefsFor({ kind: "worktree", anchorRef: "abc1234", head: "f00dfeed" }).original).toEqual({
            kind: "ref",
            ref: "abc1234",
        });
    });

    it("falls back to HEAD in a repository with no commits", () => {
        expect(pairRefsFor({ kind: "worktree", anchorRef: "", head: "" }).original).toEqual({
            kind: "ref",
            ref: "HEAD",
        });
    });

    // a commit's own change is measured against its first parent, which is what the caret means and
    // what the backend's commitBase already does for the change list
    it("diffs a commit against its first parent", () => {
        expect(pairRefsFor({ kind: "commit", hash: "deadbee" })).toEqual({
            original: { kind: "ref", ref: "deadbee^" },
            modified: { kind: "ref", ref: "deadbee" },
        });
    });

    it("anchors a merge-base comparison at the merge base, not at base", () => {
        expect(
            pairRefsFor({ kind: "compare", base: "main", head: "feature", mergeBase: "m1m1m1m", form: "mergebase" })
        ).toEqual({
            original: { kind: "ref", ref: "m1m1m1m" },
            modified: { kind: "ref", ref: "feature" },
        });
    });

    it("uses base itself for a tip-to-tip comparison", () => {
        expect(
            pairRefsFor({ kind: "compare", base: "main", head: "feature", mergeBase: "m1m1m1m", form: "tips" })
        ).toEqual({
            original: { kind: "ref", ref: "main" },
            modified: { kind: "ref", ref: "feature" },
        });
    });

    // the divergence read can be in flight when a file is clicked; base is the honest fallback
    it("falls back to base when the merge base is not known yet", () => {
        expect(
            pairRefsFor({ kind: "compare", base: "main", head: "feature", mergeBase: "", form: "mergebase" }).original
        ).toEqual({ kind: "ref", ref: "main" });
    });

    // a landed run's working-tree row reads base vs the run's tip, not base vs whatever is on disk now
    it("reads the modified side at the end ref when the range is bounded", () => {
        expect(pairRefsFor({ kind: "worktree", anchorRef: "b41d000", end: "c0ffee1" })).toEqual({
            original: { kind: "ref", ref: "b41d000" },
            modified: { kind: "ref", ref: "c0ffee1" },
        });
    });

    it("reads the file on disk when end is empty", () => {
        expect(pairRefsFor({ kind: "worktree", anchorRef: "b41d000", end: "" }).modified).toEqual({
            kind: "worktree",
        });
    });
});

describe("firstDifferingLine", () => {
    it("returns the first line that differs, 1-based", () => {
        expect(firstDifferingLine("a\nb\nc\n", "a\nb\nZ\n")).toBe(3);
    });

    it("returns 1 for identical content, so a jump target always exists", () => {
        expect(firstDifferingLine("a\nb\n", "a\nb\n")).toBe(1);
    });

    it("points at the first added line when one side is longer", () => {
        expect(firstDifferingLine("a\n", "a\nb\n")).toBe(2);
    });

    it("points at line 1 when the original side is empty (a new file)", () => {
        expect(firstDifferingLine("", "hello\n")).toBe(1);
    });

    // A deletion is the same question from the other side: the original is longer, so the scan runs
    // out of modified lines and the answer is the first line that no longer exists.
    it("points at the first deleted line when the modified side is shorter", () => {
        expect(firstDifferingLine("a\nb\nc\n", "a\nb\n")).toBe(3);
    });
});
