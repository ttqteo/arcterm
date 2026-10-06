// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
    commentRef,
    commentSources,
    formatLineComments,
    orderComments,
    type CommentSource,
    type LineComment,
} from "./linecomments";

const WORKTREE: CommentSource = { id: "worktree", label: "your changes" };
const COMMIT_A: CommentSource = { id: "abc1234def", label: "commit abc1234 (Add the merge step)" };
const COMMIT_B: CommentSource = { id: "fed9876cba", label: "commit fed9876 (Fix the cache)" };

let seq = 0;
const lc = (over: Partial<LineComment>): LineComment => ({
    id: `c${++seq}`,
    source: "worktree",
    file: "a.ts",
    side: "new",
    startLine: 1,
    endLine: over.startLine ?? 1,
    quote: ["x"],
    note: "note",
    ...over,
});

describe("commentRef", () => {
    it("names one new-side line", () => {
        expect(commentRef(lc({ file: "src/a.ts", startLine: 42, endLine: 42 }))).toBe("src/a.ts:42");
    });
    it("names a new-side range", () => {
        expect(commentRef(lc({ file: "src/a.ts", startLine: 88, endLine: 94 }))).toBe("src/a.ts:88-94");
    });
    it("names one removed line", () => {
        expect(commentRef(lc({ file: "src/old.ts", side: "old", startLine: 12, endLine: 12 }))).toBe(
            "src/old.ts:12 (removed line)"
        );
    });
    it("names removed lines", () => {
        expect(commentRef(lc({ file: "src/old.ts", side: "old", startLine: 12, endLine: 14 }))).toBe(
            "src/old.ts:12-14 (removed lines)"
        );
    });
});

describe("formatLineComments", () => {
    it("formats one line", () => {
        const c = lc({
            file: "frontend/app/view/agents/diffpane.tsx",
            startLine: 42,
            endLine: 42,
            quote: ["const x = foo();"],
            note: "Why call foo twice?",
        });
        expect(formatLineComments([c], [WORKTREE])).toBe(
            [
                "Review comments on your changes (1):",
                "",
                "1. frontend/app/view/agents/diffpane.tsx:42",
                "   > const x = foo();",
                "   Why call foo twice?",
            ].join("\n")
        );
    });

    it("quotes all of a 3-line range", () => {
        const c = lc({ file: "a.ts", startLine: 5, endLine: 7, quote: ["one", "two", "three"], note: "Hm." });
        expect(formatLineComments([c], [WORKTREE])).toBe(
            [
                "Review comments on your changes (1):",
                "",
                "1. a.ts:5-7",
                "   > one",
                "   > two",
                "   > three",
                "   Hm.",
            ].join("\n")
        );
    });

    it("formats the spec's example", () => {
        const comments = [
            lc({
                file: "src/old.ts",
                side: "old",
                startLine: 12,
                endLine: 12,
                quote: ["return cache.get(key)"],
                note: "Keep the cache.",
            }),
            lc({
                file: "pkg/orchestrate/merge.go",
                startLine: 88,
                endLine: 94,
                quote: [
                    "func finishMerge(ctx context.Context, run *Run) error {",
                    "    if run.Landed {",
                    "        return nil",
                    "    }",
                    "    run.Landed = true",
                    "    return save(run)",
                    "}",
                ],
                note: "Split this function.",
            }),
            lc({
                file: "frontend/app/view/agents/diffpane.tsx",
                startLine: 42,
                endLine: 42,
                quote: ["const x = foo();"],
                note: "Why call foo twice?",
            }),
        ];
        expect(formatLineComments(comments, [WORKTREE])).toBe(
            [
                "Review comments on your changes (3):",
                "",
                "1. frontend/app/view/agents/diffpane.tsx:42",
                "   > const x = foo();",
                "   Why call foo twice?",
                "",
                "2. pkg/orchestrate/merge.go:88-94",
                "   > func finishMerge(ctx context.Context, run *Run) error {",
                "   >     if run.Landed {",
                "   >         return nil",
                "   > … (4 more lines)",
                "   Split this function.",
                "",
                "3. src/old.ts:12 (removed line)",
                "   > return cache.get(key)",
                "   Keep the cache.",
            ].join("\n")
        );
    });

    it("says one more line in the singular", () => {
        const c = lc({ startLine: 1, endLine: 4, quote: ["a", "b", "c", "d"] });
        expect(formatLineComments([c], [WORKTREE])).toContain("   > c\n   > … (1 more line)\n");
    });

    it("cuts a quoted line over 120 characters", () => {
        const long = "x".repeat(130);
        const c = lc({ quote: [long], note: "Too long." });
        const out = formatLineComments([c], [WORKTREE]);
        expect(out).toContain(`   > ${"x".repeat(120)}…\n`);
        expect(out).not.toContain("x".repeat(121));
    });

    it("keeps a line of exactly 120 characters whole", () => {
        const c = lc({ quote: ["y".repeat(120)] });
        expect(formatLineComments([c], [WORKTREE])).toContain(`   > ${"y".repeat(120)}\n`);
    });

    it("formats removed lines", () => {
        const c = lc({ file: "src/old.ts", side: "old", startLine: 12, endLine: 13, quote: ["a", "b"], note: "Why?" });
        expect(formatLineComments([c], [WORKTREE])).toBe(
            [
                "Review comments on your changes (1):",
                "",
                "1. src/old.ts:12-13 (removed lines)",
                "   > a",
                "   > b",
                "   Why?",
            ].join("\n")
        );
    });

    it("names a commit in the header", () => {
        const c = lc({ source: COMMIT_A.id, file: "m.go", startLine: 3, endLine: 3, quote: ["x := 1"] });
        expect(formatLineComments([c], [COMMIT_A]).split("\n")[0]).toBe(
            "Review comments on commit abc1234 (Add the merge step) (1):"
        );
    });

    it("names each comment's source when there is more than one", () => {
        const comments = [
            lc({ source: COMMIT_B.id, file: "b.ts", startLine: 2, endLine: 2, quote: ["b"], note: "B" }),
            lc({ source: COMMIT_A.id, file: "a.ts", startLine: 1, endLine: 1, quote: ["a"], note: "A" }),
            lc({ source: "worktree", file: "z.ts", startLine: 9, endLine: 9, quote: ["z"], note: "Z" }),
        ];
        // first commented on: B, then the worktree, then A; the worktree sorts first whatever its position
        const sources = [COMMIT_B, WORKTREE, COMMIT_A];
        expect(formatLineComments(comments, sources)).toBe(
            [
                "Review comments (3):",
                "",
                "1. z.ts:9 in your changes",
                "   > z",
                "   Z",
                "",
                "2. b.ts:2 in commit fed9876 (Fix the cache)",
                "   > b",
                "   B",
                "",
                "3. a.ts:1 in commit abc1234 (Add the merge step)",
                "   > a",
                "   A",
            ].join("\n")
        );
    });

    it("indents every line of a note", () => {
        const c = lc({ note: "First point.\nSecond point." });
        expect(formatLineComments([c], [WORKTREE]).endsWith("   First point.\n   Second point.")).toBe(true);
    });
});

describe("orderComments", () => {
    it("orders by source, then path in byte order, then new before old, then start line", () => {
        const a = lc({ file: "b.ts", side: "old", startLine: 1 });
        const b = lc({ file: "b.ts", side: "new", startLine: 30 });
        const c = lc({ file: "B.ts", side: "new", startLine: 5 }); // "B" < "a" < "b" in byte order
        const d = lc({ file: "a.ts", side: "old", startLine: 2 });
        const e = lc({ file: "a.ts", side: "new", startLine: 10 });
        const f = lc({ file: "a.ts", side: "new", startLine: 3 });
        const g = lc({ source: COMMIT_A.id, file: "A.ts", side: "new", startLine: 1 });
        const out = orderComments([a, b, c, d, e, f, g], [COMMIT_A, WORKTREE]);
        expect(out.map((x) => x.id)).toEqual([c, f, e, d, b, a, g].map((x) => x.id));
    });

    it("does not change its input", () => {
        const a = lc({ file: "b.ts" });
        const b = lc({ file: "a.ts" });
        const input = [a, b];
        orderComments(input, [WORKTREE]);
        expect(input).toEqual([a, b]);
    });
});

describe("commentSources", () => {
    it("lists each source once, in the order it was first commented on, labelled", () => {
        const comments = [
            lc({ source: COMMIT_B.id }),
            lc({ source: "worktree" }),
            lc({ source: COMMIT_B.id }),
            lc({ source: COMMIT_A.id }),
        ];
        const labels: Record<string, string> = { [COMMIT_B.id]: COMMIT_B.label, [COMMIT_A.id]: COMMIT_A.label };
        expect(commentSources(comments, (id) => labels[id] ?? "your changes")).toEqual([COMMIT_B, WORKTREE, COMMIT_A]);
        expect(commentSources(comments).map((s) => s.label)).toEqual(["", "", ""]);
    });
});
