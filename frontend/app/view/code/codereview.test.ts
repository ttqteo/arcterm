// frontend/app/view/code/codereview.test.ts
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
    addComment,
    clearProject,
    fileComments,
    projectComments,
    reanchor,
    removeComment,
    reviewHandoffLine,
    reviewMarkdown,
    selectionLines,
    type ReviewComment,
    type Reviews,
} from "./codereview";

const comment = (over: Partial<ReviewComment> = {}): ReviewComment => ({
    id: "c1",
    path: "src/a.ts",
    startLine: 3,
    endLine: 3,
    anchor: "const x = 1;",
    note: "rename x",
    ...over,
});

const empty: Reviews = new Map();

describe("review store helpers", () => {
    it("adds a comment without mutating the input", () => {
        const next = addComment(empty, "/p", comment());
        expect(empty.size).toBe(0);
        expect(projectComments(next, "/p")).toEqual([comment()]);
    });

    it("keeps comments of other projects when adding", () => {
        const a = addComment(empty, "/p", comment({ id: "a" }));
        const b = addComment(a, "/q", comment({ id: "b" }));
        expect(projectComments(b, "/p").map((c) => c.id)).toEqual(["a"]);
        expect(projectComments(b, "/q").map((c) => c.id)).toEqual(["b"]);
    });

    it("ignores an empty project key", () => {
        expect(addComment(empty, "", comment()).size).toBe(0);
        expect(projectComments(empty, "")).toEqual([]);
    });

    it("removes one comment and drops the project key when it was the last", () => {
        const two = addComment(addComment(empty, "/p", comment({ id: "a" })), "/p", comment({ id: "b" }));
        const one = removeComment(two, "/p", "a");
        expect(projectComments(one, "/p").map((c) => c.id)).toEqual(["b"]);
        expect(two.get("/p")).toHaveLength(2);
        expect(removeComment(one, "/p", "b").has("/p")).toBe(false);
    });

    it("removing an unknown id leaves the comments as they were", () => {
        const one = addComment(empty, "/p", comment());
        expect(projectComments(removeComment(one, "/p", "nope"), "/p")).toEqual([comment()]);
    });

    it("clearProject leaves other projects untouched", () => {
        const both = addComment(addComment(empty, "/p", comment({ id: "a" })), "/q", comment({ id: "b" }));
        const next = clearProject(both, "/p");
        expect(next.has("/p")).toBe(false);
        expect(projectComments(next, "/q").map((c) => c.id)).toEqual(["b"]);
        expect(both.has("/p")).toBe(true);
    });

    it("fileComments filters by path", () => {
        const r = addComment(
            addComment(empty, "/p", comment({ id: "a", path: "x.ts" })),
            "/p",
            comment({ id: "b", path: "y.ts" })
        );
        expect(fileComments(r, "/p", "y.ts").map((c) => c.id)).toEqual(["b"]);
        expect(fileComments(r, "/p", "z.ts")).toEqual([]);
    });
});

describe("selectionLines", () => {
    it("keeps a single-line selection", () => {
        expect(selectionLines({ startLine: 4, endLine: 4, endColumn: 9 })).toEqual({ startLine: 4, endLine: 4 });
    });

    it("keeps a multi-line selection ending mid-line", () => {
        expect(selectionLines({ startLine: 4, endLine: 7, endColumn: 3 })).toEqual({ startLine: 4, endLine: 7 });
    });

    it("excludes a later line the selection only touches at column 1", () => {
        expect(selectionLines({ startLine: 4, endLine: 7, endColumn: 1 })).toEqual({ startLine: 4, endLine: 6 });
    });

    it("keeps a collapsed selection at column 1", () => {
        expect(selectionLines({ startLine: 4, endLine: 4, endColumn: 1 })).toEqual({ startLine: 4, endLine: 4 });
    });
});

describe("reanchor", () => {
    const lines = ["a", "b", "const x = 1;", "d"];

    it("keeps the range when the anchor line is still there", () => {
        expect(reanchor(comment(), lines)).toEqual({ startLine: 3, endLine: 3 });
    });

    it("follows the anchor after lines were inserted above", () => {
        const shifted = ["n1", "n2", "n3", ...lines];
        expect(reanchor(comment(), shifted)).toEqual({ startLine: 6, endLine: 6 });
    });

    it("keeps the length of a multi-line range", () => {
        const shifted = ["n1", "n2", ...lines];
        expect(reanchor(comment({ endLine: 4 }), shifted)).toEqual({ startLine: 5, endLine: 6 });
    });

    it("picks the nearest of several matches", () => {
        const l = ["const x = 1;", "p", "p", "p", "p", "p", "const x = 1;"];
        expect(reanchor(comment({ startLine: 5, endLine: 5 }), l)).toEqual({ startLine: 7, endLine: 7 });
    });

    it("picks the earlier of two equally near matches", () => {
        const tie = ["const x = 1;", "p", "q", "p", "const x = 1;"];
        expect(reanchor(comment({ startLine: 3, endLine: 3 }), tie)).toEqual({ startLine: 1, endLine: 1 });
    });

    it("leaves the range unchanged when the anchor is gone", () => {
        expect(reanchor(comment({ startLine: 2, endLine: 3 }), ["x", "y"])).toEqual({ startLine: 2, endLine: 3 });
    });
});

describe("reviewMarkdown", () => {
    it("opens with a title naming the project", () => {
        expect(reviewMarkdown("arc", [comment()]).split("\n")[0]).toBe("# Code review: arc");
    });

    it("groups by file with sorted paths and orders comments by start line", () => {
        const md = reviewMarkdown("arc", [
            comment({ id: "1", path: "b.ts", startLine: 9, endLine: 9, note: "late" }),
            comment({ id: "2", path: "a.ts", startLine: 5, endLine: 5, note: "second" }),
            comment({ id: "3", path: "a.ts", startLine: 2, endLine: 4, note: "first" }),
        ]);
        expect(md.indexOf("## a.ts")).toBeLessThan(md.indexOf("## b.ts"));
        expect(md.indexOf("first")).toBeLessThan(md.indexOf("second"));
        expect(md).toContain("### a.ts:L2-L4");
        expect(md).toContain("### a.ts:L5\n");
        expect(md).toContain("### b.ts:L9\n");
    });

    it("quotes the anchored line and then gives the note", () => {
        const md = reviewMarkdown("arc", [comment()]);
        expect(md).toContain("### src/a.ts:L3\n\n> const x = 1;\n\nrename x");
    });

    it("preserves newlines in a note", () => {
        const md = reviewMarkdown("arc", [comment({ note: "line one\nline two\n\nline four" })]);
        expect(md).toContain("line one\nline two\n\nline four");
    });
});

describe("reviewHandoffLine", () => {
    it("references the file and asks the agent to address each comment", () => {
        expect(reviewHandoffLine("C:/Users/me/.arc/reviews/arc-1.md")).toBe(
            "review comments in C:/Users/me/.arc/reviews/arc-1.md — address each one"
        );
    });

    it("is always one line", () => {
        expect(reviewHandoffLine("/tmp/a\nb\r\nc.md")).not.toMatch(/[\r\n]/);
    });
});
