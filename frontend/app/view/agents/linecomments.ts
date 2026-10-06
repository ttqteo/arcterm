// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Line comments on a diff, and the one message that sends them to an agent. Pure: the store
// (linecommentstore.ts) keeps the comments, the Review view and the tray render them.

export type CommentSide = "new" | "old";

export interface LineComment {
    id: string;
    source: string; // "worktree" or a commit hash
    file: string; // repository-relative path
    side: CommentSide;
    startLine: number;
    endLine: number; // >= startLine
    quote: string[]; // the range's lines as shown, taken when the comment is added
    note: string;
}

export interface CommentSource {
    id: string; // "worktree" or a hash
    label: string; // "your changes", or "commit abc1234 (subject)"
}

export const QUOTE_LINES = 3;
export const QUOTE_WIDTH = 120;

const WORKTREE = "worktree";

// Byte order, the order the review patch lists files in — not localeCompare.
function cmpStr(a: string, b: string): number {
    return a < b ? -1 : a > b ? 1 : 0;
}

// sources: in the order they were first commented on; "worktree" sorts first whatever its position.
// A source missing from the list sorts after every listed one.
function sourceRank(sources: CommentSource[]): (id: string) => number {
    const rank = new Map<string, number>();
    sources.forEach((s, i) => rank.set(s.id, s.id === WORKTREE ? -1 : i));
    rank.set(WORKTREE, -1);
    return (id) => rank.get(id) ?? sources.length;
}

// The sources in the order they were first commented on, which is the order comments were added in. The Review
// cards and the tray's message both build their sources here, so a card's number is the number the agent reads;
// labelOf names each one for the message (the cards need no labels: only the ids affect the order).
export function commentSources(comments: LineComment[], labelOf: (id: string) => string = () => ""): CommentSource[] {
    const seen = new Set<string>();
    const out: CommentSource[] = [];
    for (const c of comments) {
        if (!seen.has(c.source)) {
            seen.add(c.source);
            out.push({ id: c.source, label: labelOf(c.source) });
        }
    }
    return out;
}

export function orderComments(comments: LineComment[], sources: CommentSource[]): LineComment[] {
    const rankOf = sourceRank(sources);
    return [...comments].sort(
        (a, b) =>
            rankOf(a.source) - rankOf(b.source) ||
            cmpStr(a.source, b.source) ||
            cmpStr(a.file, b.file) ||
            (a.side === b.side ? 0 : a.side === "new" ? -1 : 1) ||
            a.startLine - b.startLine ||
            a.endLine - b.endLine
    );
}

export function commentRef(c: LineComment): string {
    const lines = c.endLine > c.startLine ? `${c.startLine}-${c.endLine}` : `${c.startLine}`;
    if (c.side === "old") {
        return `${c.file}:${lines} ${c.endLine > c.startLine ? "(removed lines)" : "(removed line)"}`;
    }
    return `${c.file}:${lines}`;
}

function sourceLabel(id: string, sources: CommentSource[]): string {
    return sources.find((s) => s.id === id)?.label ?? (id === WORKTREE ? "your changes" : `commit ${id.slice(0, 7)}`);
}

function cut(line: string): string {
    return line.length > QUOTE_WIDTH ? line.slice(0, QUOTE_WIDTH) + "…" : line;
}

function formatOne(n: number, c: LineComment, suffix: string): string[] {
    const out = [`${n}. ${commentRef(c)}${suffix}`];
    for (const line of c.quote.slice(0, QUOTE_LINES)) {
        out.push(`   > ${cut(line)}`);
    }
    const more = c.quote.length - QUOTE_LINES;
    if (more > 0) {
        out.push(`   > … (${more} more ${more === 1 ? "line" : "lines"})`);
    }
    const note = c.note.trimEnd();
    if (note !== "") {
        for (const line of note.split(/\r?\n/)) {
            out.push(line === "" ? "" : `   ${line}`);
        }
    }
    return out;
}

export function formatLineComments(comments: LineComment[], sources: CommentSource[]): string {
    const ordered = orderComments(comments, sources);
    const ids = new Set(ordered.map((c) => c.source));
    const mixed = ids.size > 1;
    const header = mixed
        ? `Review comments (${ordered.length}):`
        : `Review comments on ${sourceLabel(ordered[0]?.source ?? WORKTREE, sources)} (${ordered.length}):`;
    const blocks = ordered.map((c, i) =>
        formatOne(i + 1, c, mixed ? ` in ${sourceLabel(c.source, sources)}` : "").join("\n")
    );
    return [header, "", blocks.join("\n\n")].join("\n");
}
