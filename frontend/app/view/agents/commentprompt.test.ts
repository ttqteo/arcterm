// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { buildCommentPrompt, pairLabel } from "./commentprompt";
import type { CommentBatch, PendingComment } from "./diffcomments";
import type { DiffPairRefs } from "./diffcontent";

const SHA = "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678";
const WORKTREE: DiffPairRefs = { original: { kind: "ref", ref: "a1b2c3d" }, modified: { kind: "worktree" } };
const COMMIT: DiffPairRefs = { original: { kind: "ref", ref: `${SHA}^` }, modified: { kind: "ref", ref: SHA } };
const COMPARE: DiffPairRefs = { original: { kind: "ref", ref: "main" }, modified: { kind: "ref", ref: "feature" } };

const comment = (over: Partial<PendingComment>): PendingComment => ({
    id: "c",
    path: "src/retry/policy.go",
    side: "modified",
    start: 4,
    end: 4,
    quote: ["    return 8"],
    refs: WORKTREE,
    note: "note",
    at: 1,
    ...over,
});
const batch = (comments: PendingComment[], label = "loom"): CommentBatch => ({
    source: { key: "agent:a1", kind: "agent", label, cwd: "/repo", agentId: "a1" },
    at: 1,
    comments,
});

// the Prompt board's batch
const BOARD = batch([
    comment({
        id: "1",
        start: 4,
        end: 4,
        quote: ["    return 8"],
        note: "Why 8? The incident note says five retries were enough. Put the reason in a comment above the return.",
    }),
    comment({
        id: "2",
        start: 7,
        end: 9,
        quote: ["func Floor() int {", "    return 1", "}"],
        note: "A floor of 1 means a zero budget can never be configured. Return 0 here and let Budget enforce the minimum.",
    }),
    comment({
        id: "3",
        path: "src/retry/legacy.go",
        side: "original",
        start: 1,
        end: 3,
        quote: ["package retry", "", "func Legacy() {}"],
        note: "Keep Legacy() for one release; the scheduler still calls it.",
    }),
]);

describe("pairLabel", () => {
    it("names a working-tree pair against its anchor", () => {
        expect(pairLabel(WORKTREE)).toBe("worktree against a1b2c3d");
    });

    it("shortens a 40-hex ref to 7", () => {
        expect(pairLabel({ original: { kind: "ref", ref: SHA }, modified: { kind: "worktree" } })).toBe(
            "worktree against a1b2c3d"
        );
    });

    it("names a commit pair by its commit", () => {
        expect(pairLabel(COMMIT)).toBe("commit a1b2c3d");
    });

    it("names a comparison base..head", () => {
        expect(pairLabel(COMPARE)).toBe("main..feature");
    });
});

describe("buildCommentPrompt", () => {
    it("renders the Prompt board's batch to a live agent", () => {
        expect(buildCommentPrompt(BOARD, "live")).toBe(
            [
                "Review comments on your changes (worktree against a1b2c3d), 3 comments:",
                "",
                "  src/retry/policy.go:4",
                "  >     return 8",
                "  Why 8? The incident note says five retries were enough. Put the reason in a comment above the return.",
                "",
                "  src/retry/policy.go:7-9",
                "  > func Floor() int {",
                "  A floor of 1 means a zero budget can never be configured. Return 0 here and let Budget enforce the minimum.",
                "",
                "  src/retry/legacy.go: removed lines 1-3 of a1b2c3d",
                "  > package retry",
                "  Keep Legacy() for one release; the scheduler still calls it.",
                "",
                "  Line numbers are the file as shown in the diff. Address each comment, then say which you changed.",
            ].join("\n")
        );
    });

    it("names the source's label in a new agent's header", () => {
        const first = buildCommentPrompt(BOARD, "new").split("\n")[0];
        expect(first).toBe("Review comments on the changes in loom (worktree against a1b2c3d), 3 comments:");
    });

    it("has no trailing newline", () => {
        expect(buildCommentPrompt(BOARD, "live").endsWith("changed.")).toBe(true);
    });

    it("says comment, not comments, for one", () => {
        const first = buildCommentPrompt(batch([comment({})]), "live").split("\n")[0];
        expect(first).toBe("Review comments on your changes (worktree against a1b2c3d), 1 comment:");
    });

    it("drops the header's pair and suffixes each location when the batch spans two pairs", () => {
        const text = buildCommentPrompt(
            batch([comment({ id: "1" }), comment({ id: "2", start: 7, end: 9, refs: COMMIT })]),
            "live"
        );
        const lines = text.split("\n");
        expect(lines[0]).toBe("Review comments on your changes, 2 comments:");
        expect(lines[2]).toBe("  src/retry/policy.go:4 in worktree against a1b2c3d");
        expect(lines[6]).toBe("  src/retry/policy.go:7-9 in commit a1b2c3d");
    });

    it("names a commit pair's removed range against the parent", () => {
        const text = buildCommentPrompt(
            batch([comment({ side: "original", start: 2, end: 5, refs: COMMIT, quote: ["x"] })]),
            "live"
        );
        expect(text).toContain("  src/retry/policy.go: removed lines 2-5 of a1b2c3d^\n");
        expect(text.split("\n")[0]).toContain("(commit a1b2c3d)");
    });

    it("names one removed line in the singular", () => {
        const text = buildCommentPrompt(batch([comment({ side: "original", start: 2, end: 2 })]), "live");
        expect(text).toContain("  src/retry/policy.go: removed line 2 of a1b2c3d\n");
    });

    it("quotes the range's first non-blank line, keeping its indentation and trimming the end", () => {
        const text = buildCommentPrompt(
            batch([comment({ start: 7, end: 9, quote: ["", "   ", "\tif x {  ", "}"] })]),
            "live"
        );
        expect(text).toContain("\n  > \tif x {\n");
    });

    it("leaves the quote out when every quoted line is blank", () => {
        const text = buildCommentPrompt(batch([comment({ quote: ["", "  "] })]), "live");
        expect(text.split("\n").slice(2, 4)).toEqual(["  src/retry/policy.go:4", "  note"]);
    });

    it("indents each line of a multi-line note", () => {
        const text = buildCommentPrompt(batch([comment({ note: "first\n\nthird" })]), "live");
        expect(text).toContain("  > " + "    return 8" + "\n  first\n  \n  third\n");
    });

    it("includes lost comments with their original lines and quote", () => {
        const text = buildCommentPrompt(
            batch([comment({ id: "1", start: 12, end: 14, quote: ["gone()", "x"], lost: true, note: "still wrong" })]),
            "live"
        );
        expect(text).toContain("  src/retry/policy.go:12-14\n  > gone()\n  still wrong\n");
        expect(text.split("\n")[0]).toContain("1 comment:");
    });

    it("shortens a 40-hex original ref in a removed range", () => {
        const refs: DiffPairRefs = { original: { kind: "ref", ref: SHA }, modified: { kind: "worktree" } };
        const text = buildCommentPrompt(batch([comment({ side: "original", start: 1, end: 3, refs })]), "live");
        expect(text).toContain("removed lines 1-3 of a1b2c3d\n");
    });
});
