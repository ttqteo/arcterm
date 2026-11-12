// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// The pending comments of one batch as the one prompt the agent receives: what was reviewed, then per
// comment its file and line, the commented line quoted (so the agent can re-find the spot after its line
// numbers move) and the note. Pure; commentsend.ts hands the text over.

import { pairKey, type CommentBatch, type PendingComment } from "./diffcomments";
import type { DiffPairRefs, DiffSide } from "./diffcontent";

const SHA_CHARS = 7;
const FULL_SHA = /^[0-9a-f]{40}/;
const INDENT = "  ";
const CLOSING = "Line numbers are the file as shown in the diff. Address each comment, then say which you changed.";

function shortRef(ref: string): string {
    return FULL_SHA.test(ref) ? ref.slice(0, SHA_CHARS) + ref.slice(40) : ref;
}

function sideName(side: DiffSide): string {
    return side.kind === "worktree" ? "worktree" : shortRef(side.ref);
}

export function pairLabel(refs: DiffPairRefs): string {
    const { original, modified } = refs;
    if (original.kind === "ref" && modified.kind === "worktree") {
        return `worktree against ${shortRef(original.ref)}`;
    }
    if (original.kind === "ref" && modified.kind === "ref" && original.ref === `${modified.ref}^`) {
        return `commit ${shortRef(modified.ref)}`;
    }
    return `${sideName(original)}..${sideName(modified)}`;
}

function plural(n: number, noun: string): string {
    return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

function span(c: PendingComment): string {
    return c.start === c.end ? `${c.start}` : `${c.start}-${c.end}`;
}

function location(c: PendingComment, suffix: string): string {
    if (c.side === "modified") {
        return `${c.path}:${span(c)}${suffix}`;
    }
    const left = sideName(c.refs.original);
    return `${c.path}: removed ${c.start === c.end ? "line" : "lines"} ${span(c)} of ${left}${suffix}`;
}

function commentLines(c: PendingComment, suffix: string): string[] {
    const lines = [INDENT + location(c, suffix)];
    const first = c.quote.find((l) => l.trim() !== "");
    if (first != null) {
        lines.push(`${INDENT}> ${first.trimEnd()}`);
    }
    for (const l of c.note.split(/\r?\n/)) {
        lines.push(INDENT + l);
    }
    return lines;
}

export function buildCommentPrompt(batch: CommentBatch, to: "live" | "new"): string {
    const comments = batch.comments;
    const pairs = new Set(comments.map((c) => pairKey(c.refs)));
    const one = pairs.size === 1;
    const what = to === "live" ? "your changes" : `the changes in ${batch.source.label}`;
    const pair = one ? ` (${pairLabel(comments[0].refs)})` : "";
    const out = [`Review comments on ${what}${pair}, ${plural(comments.length, "comment")}:`, ""];
    for (const c of comments) {
        out.push(...commentLines(c, one ? "" : ` in ${pairLabel(c.refs)}`), "");
    }
    out.push(INDENT + CLOSING);
    return out.join("\n");
}
