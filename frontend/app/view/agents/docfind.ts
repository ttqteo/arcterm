// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Find in the File tab's Preview of a markdown file (Mod+F): where a query matches the rendered document's text and
// which match is current. The DOM half, reading the text and painting the matches, is docfindbar.tsx.

export interface TextMatch {
    start: number;
    end: number;
}

// between two blocks' text: not whitespace, so no query matches across it
export const BLOCK_SEP = "\u0000";
// a one-letter query in a long document: the count says "+" past this, and only these are painted
export const MAX_MATCHES = 5000;

// every match of query in text, ignoring case and not overlapping. The query is taken literally, but a space in it
// matches any run of whitespace, as a paragraph's line break reads as a space.
export function findMatches(text: string, query: string): TextMatch[] {
    if (query.trim() === "") {
        return [];
    }
    const pattern = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
    const re = new RegExp(pattern, "gi");
    const out: TextMatch[] = [];
    for (let m = re.exec(text); m != null && out.length < MAX_MATCHES; m = re.exec(text)) {
        out.push({ start: m.index, end: m.index + m[0].length });
    }
    return out;
}

// the document's text from its text nodes in order: a part's block is what it belongs to, and a new block starts
// after a separator. starts[i] is where part i begins in the text.
export function joinParts(parts: { text: string; block: unknown }[]): { text: string; starts: number[] } {
    let text = "";
    const starts: number[] = [];
    parts.forEach((p, i) => {
        if (i > 0 && p.block !== parts[i - 1].block) {
            text += BLOCK_SEP;
        }
        starts.push(text.length);
        text += p.text;
    });
    return { text, starts };
}

// the part an offset into the joined text falls in: the last that starts at or before it
export function partAt(starts: number[], offset: number): number {
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (starts[mid] <= offset) {
            lo = mid;
        } else {
            hi = mid - 1;
        }
    }
    return lo;
}

// the next (1) or previous (-1) match, round the ends; -1 when there is none
export function stepMatch(current: number, count: number, delta: 1 | -1): number {
    if (count === 0) {
        return -1;
    }
    return (current + delta + count) % count;
}

// where a new query starts: the first match at or below the top of the view, so finding does not jump back to the
// top of the document; the first match when all are above it. `tops` are the matches' tops in document order.
export function firstInView(tops: number[], viewTop: number): number {
    if (tops.length === 0) {
        return -1;
    }
    const i = tops.findIndex((t) => t >= viewTop);
    return i === -1 ? 0 : i;
}

export function matchCount(current: number, count: number): string {
    if (count === 0) {
        return "No results";
    }
    return `${current + 1}/${count}${count >= MAX_MATCHES ? "+" : ""}`;
}
