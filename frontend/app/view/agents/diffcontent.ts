// frontend/app/view/agents/diffcontent.ts
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Pure: what the diff pane is showing -> which two things to read. The pane renders two full file
// texts rather than a parsed patch, so every state the surface has must answer one question the
// same way: which ref is the left side, which is the right. Keeping that here is what lets history,
// comparison and the working tree share one pane and one loader.

export type CompareForm = "mergebase" | "tips";

export type DiffSelection =
    // head: the sha HEAD pointed at when the change list was read, "" with no commits. end: a bounded
    // range's tip (a landed run), read in place of the file on disk
    | { kind: "worktree"; anchorRef: string; head?: string; end?: string }
    | { kind: "commit"; hash: string }
    | { kind: "compare"; base: string; head: string; mergeBase: string; form: CompareForm };

// The right side of the working-tree diff is the file on disk, which is not a ref at all.
export type DiffSide = { kind: "ref"; ref: string } | { kind: "worktree" };

export interface DiffPairRefs {
    original: DiffSide;
    modified: DiffSide;
}

export function pairRefsFor(sel: DiffSelection): DiffPairRefs {
    switch (sel.kind) {
        // A comment made on this pair stores its refs and names them in the prompt; the symbolic HEAD
        // would name a different commit once the agent commits, so an unanchored tree takes the sha.
        case "worktree":
            return {
                original: { kind: "ref", ref: sel.anchorRef || sel.head || "HEAD" },
                modified: sel.end ? { kind: "ref", ref: sel.end } : { kind: "worktree" },
            };
        // "^" is the first parent, matching gitinfo.commitBase: for a merge that is the conventional
        // "what did this bring in", and for a root commit it simply misses, which the pane renders as
        // an addition — correct, since a root commit adds everything.
        case "commit":
            return { original: { kind: "ref", ref: `${sel.hash}^` }, modified: { kind: "ref", ref: sel.hash } };
        case "compare":
            return {
                original: {
                    kind: "ref",
                    ref: sel.form === "tips" ? sel.base : sel.mergeBase || sel.base,
                },
                modified: { kind: "ref", ref: sel.head },
            };
    }
}

// Where "Open in Code" should land. Not a diff — the first line at which the two texts stop
// agreeing, which is the same answer for every case the pane can show and costs one scan.
export function firstDifferingLine(original: string, modified: string): number {
    const a = original.split("\n");
    const b = modified.split("\n");
    const n = Math.min(a.length, b.length);
    for (let i = 0; i < n; i++) {
        if (a[i] !== b[i]) {
            return i + 1;
        }
    }
    return a.length === b.length ? 1 : n + 1;
}
