// frontend/app/view/code/codeblame.test.ts
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { blameClick, blameEntries, blameIsCurrent, type BlameEntry, type BlameState } from "./codeblame";

const ZERO = "0".repeat(40);
const A = "a".repeat(40);
const B = "b".repeat(40);

function hunk(start: number, lines: number, sha: string, subject = "subject"): GitBlameHunk {
    return { start, lines, sha, author: "Ada", authortime: 1_700_000_000, subject };
}

function rtn(hunks: GitBlameHunk[], extra?: Partial<CommandGitBlameRtnData>): CommandGitBlameRtnData {
    return { hunks, isrepo: true, ...extra };
}

describe("blameEntries", () => {
    it("merges adjacent groups of one commit and keeps non-adjacent ones apart", () => {
        const entries = blameEntries(rtn([hunk(1, 2, A), hunk(3, 1, A), hunk(4, 2, B), hunk(6, 1, A)]), 6);
        expect(entries.map((e) => [e.start, e.lines, e.sha])).toEqual([
            [1, 3, A],
            [4, 2, B],
            [6, 1, A],
        ]);
    });

    it("carries the short sha, author, time and subject of a committed entry", () => {
        const [e] = blameEntries(rtn([hunk(1, 1, A, "seed the file")]), 1);
        expect(e).toMatchObject({
            short: "aaaaaaa",
            author: "Ada",
            authorTime: 1_700_000_000,
            subject: "seed the file",
            committed: true,
        });
    });

    it("marks a zero sha as not committed", () => {
        const [e] = blameEntries(rtn([hunk(1, 1, ZERO)]), 1);
        expect(e.committed).toBe(false);
    });

    it("answers one uncommitted entry over the whole file for an untracked file", () => {
        const entries = blameEntries(rtn([], { untracked: true }), 7);
        expect(entries).toHaveLength(1);
        expect(entries[0]).toMatchObject({ start: 1, lines: 7, committed: false });
    });

    it("attaches a run only to the entries of the credited sha", () => {
        const entries = blameEntries(
            rtn([hunk(1, 1, A), hunk(2, 1, B)], { runs: { [B]: { runid: "run-1", goal: "fix the retry" } } }),
            2
        );
        expect(entries[0].run).toBeUndefined();
        expect(entries[1].run).toEqual({ runId: "run-1", goal: "fix the retry" });
    });

    it("answers nothing outside a repository", () => {
        expect(blameEntries({ hunks: [], isrepo: false }, 3)).toEqual([]);
    });
});

describe("blameClick", () => {
    const base: BlameEntry = {
        start: 1,
        lines: 1,
        sha: A,
        short: "aaaaaaa",
        author: "Ada",
        authorTime: 0,
        subject: "s",
        committed: true,
    };

    it("opens the crediting run", () => {
        expect(blameClick({ ...base, run: { runId: "run-1", goal: "g" } })).toEqual({
            kind: "open-run",
            runId: "run-1",
        });
    });

    it("copies the sha of a commit with no run", () => {
        expect(blameClick(base)).toEqual({ kind: "copy-sha", sha: A });
    });

    it("does nothing for an uncommitted entry", () => {
        expect(blameClick({ ...base, sha: ZERO, committed: false })).toEqual({ kind: "none" });
    });
});

describe("blameIsCurrent", () => {
    const ready: BlameState = { kind: "ready", path: "a.go", modtime: 10, entries: [] };

    it("holds for the same path and modtime", () => {
        expect(blameIsCurrent(ready, "a.go", 10)).toBe(true);
    });

    it("fails for another path or another modtime", () => {
        expect(blameIsCurrent(ready, "b.go", 10)).toBe(false);
        expect(blameIsCurrent(ready, "a.go", 11)).toBe(false);
    });

    it("fails while loading, after an error, or before any load", () => {
        expect(blameIsCurrent({ kind: "loading", path: "a.go" }, "a.go", 10)).toBe(false);
        expect(blameIsCurrent({ kind: "error", path: "a.go", message: "x" }, "a.go", 10)).toBe(false);
        expect(blameIsCurrent({ kind: "idle" }, "a.go", 10)).toBe(false);
    });
});
