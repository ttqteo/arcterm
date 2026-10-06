// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Pure: comments on a rendered markdown file in the Agent panel's File tab, and the one message that sends them
// (docs/superpowers/specs/2026-10-06-md-comments-design.md). A comment is anchored to file lines. Blocks come from
// the rendered DOM's data-src-start / data-src-end stamps (rehype-srclines.ts), in document order, where a parent
// is listed before its children. No React.

import { isUnderRoot, toRel } from "@/app/cockpit/openfileroute";
import { isMarkdownPath } from "@/app/view/code/codeclassify";
import { resolveDocLink } from "@/app/view/code/codelink";
import { QUOTE_LINES, QUOTE_WIDTH } from "./linecomments";
import { QUOTE_MAX } from "./proseanchor";

export type QuoteKind = "selection" | "source" | "none";
export type BlockKind = "block" | "tr" | "table" | "img";

export interface MdBlock {
    kind: BlockKind;
    start: number;
    end: number;
    src?: string; // an image's src as written in the file
}

export interface MdComment {
    id: string;
    seq: number; // creation order: a tiebreak within a line, and the order files are listed in
    file: string; // absolute, as the panel opened it
    root: string | null; // FileRef.root: what the message's path is relative to
    startLine: number;
    endLine: number; // >= startLine
    quoteKind: QuoteKind;
    quote: string[]; // what the card and the message show after "> ", already cut
    image?: string; // an image comment: its src as written
    note: string;
}

// what a gesture comments on; the comment box (mdcommentstore.ts MdBox) carries the same fields
export interface MdTarget {
    startLine: number;
    endLine: number;
    quoteKind: QuoteKind;
    quote: string[];
    image?: string;
    anchor?: { start: number; end: number }; // a + box: the block it opened on, which Shift+click stretches from
}

export function blockKind(tagName: string): BlockKind {
    const t = tagName.toLowerCase();
    return t === "tr" || t === "table" || t === "img" ? t : "block";
}

// the file lines a frontmatter split took off the top: the rendered body's line 1 is the file's line 1 + this
export function bodyOffset(text: string, body: string): number {
    return text.slice(0, text.length - body.length).split("\n").length - 1;
}

function cutChars(s: string, max: number): string {
    const chars = Array.from(s);
    return chars.length <= max ? s : chars.slice(0, max).join("").trimEnd() + "…";
}

export function selectionQuote(text: string): string[] {
    const q = text.replace(/\s+/g, " ").trim();
    return q === "" ? [] : [cutChars(q, QUOTE_MAX)];
}

// the range's non-blank source lines, up to QUOTE_LINES, each cut to QUOTE_WIDTH, then how many were left out
export function sourceQuote(fileLines: string[], start: number, end: number): string[] {
    const lines = fileLines.slice(start - 1, end).filter((l) => l.trim() !== "");
    const shown = lines.slice(0, QUOTE_LINES).map((l) => cutChars(l.trimEnd(), QUOTE_WIDTH));
    const more = lines.length - shown.length;
    return more > 0 ? [...shown, `… (${more} more ${more === 1 ? "line" : "lines"})`] : shown;
}

export function spanOf(lines: { start: number; end: number }[]): { start: number; end: number } | null {
    if (lines.length === 0) {
        return null;
    }
    return { start: Math.min(...lines.map((l) => l.start)), end: Math.max(...lines.map((l) => l.end)) };
}

// a holds b: b's lines sit inside a's; of two blocks on the same lines the earlier is the parent
function holds(blocks: MdBlock[], a: number, b: number): boolean {
    const x = blocks[a];
    const y = blocks[b];
    if (a === b || x.start > y.start || y.end > x.end) {
        return false;
    }
    return x.start !== y.start || x.end !== y.end || a < b;
}

// those of idxs that hold none of the others
function innermost(blocks: MdBlock[], idxs: number[]): number[] {
    return idxs.filter((i) => !idxs.some((j) => holds(blocks, i, j)));
}

function holding(blocks: MdBlock[], line: number): number[] {
    const out: number[] = [];
    blocks.forEach((b, i) => {
        if (b.kind !== "img" && b.start <= line && line <= b.end) {
            out.push(i);
        }
    });
    return out;
}

// the block a link's line marks: the innermost one holding it, else the first after it; -1 when there is none
export function blockForLine(blocks: MdBlock[], line: number): number {
    const inner = innermost(blocks, holding(blocks, line));
    if (inner.length > 0) {
        return inner[inner.length - 1];
    }
    return blocks.findIndex((b) => b.kind !== "img" && b.start > line);
}

// the block a comment's card hangs after: an image comment's image; else the innermost block holding its last line,
// where a table row gives way to its table (a card cannot sit between rows); a line between blocks takes the last
// block before it
export function hostIndex(blocks: MdBlock[], c: { endLine: number; image?: string }): number {
    if (c.image != null) {
        const img = blocks.findIndex(
            (b) => b.kind === "img" && b.src === c.image && b.start <= c.endLine && c.endLine <= b.end
        );
        if (img >= 0) {
            return img;
        }
    }
    const inner = innermost(blocks, holding(blocks, c.endLine));
    if (inner.length === 0) {
        for (let i = blocks.length - 1; i >= 0; i--) {
            if (blocks[i].kind !== "img" && blocks[i].kind !== "tr" && blocks[i].end <= c.endLine) {
                return i;
            }
        }
        return -1;
    }
    const host = inner[inner.length - 1];
    if (blocks[host].kind === "tr") {
        for (let i = host - 1; i >= 0; i--) {
            if (blocks[i].kind === "table" && holds(blocks, i, host)) {
                return i;
            }
        }
    }
    return host;
}

// the blocks a range marks: those it covers whole that hold no other covered block; else the block of its first line
export function coveredIndexes(blocks: MdBlock[], start: number, end: number): number[] {
    const inside: number[] = [];
    blocks.forEach((b, i) => {
        if (b.kind !== "img" && b.start >= start && b.end <= end) {
            inside.push(i);
        }
    });
    const inner = innermost(blocks, inside);
    if (inner.length > 0) {
        return inner;
    }
    const one = blockForLine(blocks, start);
    return one >= 0 ? [one] : [];
}

// A selection: each end reduced to its innermost stamped block, from the earlier start to the later end. `touched`
// is the blocks the selection's range intersects, as indexes into blocks; the view lists the body's alone, which
// clips a selection reaching past the body. Null when it touches none: no Comment button.
export function selectionTarget(blocks: MdBlock[], touched: number[], text: string): MdTarget | null {
    const span = spanOf(innermost(blocks, touched).map((i) => blocks[i]));
    if (span == null) {
        return null;
    }
    return { startLine: span.start, endLine: span.end, quoteKind: "selection", quote: selectionQuote(text) };
}

// The + on block `index`: a box on that block's lines. With Shift while the open box in this file came from a +
// (`from`, the block it opened on), that range stretched from its first block to this one, in either direction;
// `extend` says to keep the open box and its text.
export function plusTarget(
    blocks: MdBlock[],
    index: number,
    fileLines: string[],
    shift: boolean,
    from: { start: number; end: number } | undefined
): { extend: boolean; target: MdTarget } | null {
    const b = blocks[index];
    if (b == null) {
        return null;
    }
    const extend = shift && from != null;
    const start = extend ? Math.min(from.start, b.start) : b.start;
    const end = extend ? Math.max(from.end, b.end) : b.end;
    return {
        extend,
        target: {
            startLine: start,
            endLine: end,
            quoteKind: "source",
            quote: sourceQuote(fileLines, start, end),
            anchor: extend ? from : { start: b.start, end: b.end },
        },
    };
}

// An image's Comment: the image's lines and its src as written; no quote.
export function imageTarget(blocks: MdBlock[], index: number): MdTarget | null {
    const b = blocks[index];
    if (b?.kind !== "img" || b.src == null) {
        return null;
    }
    return { startLine: b.start, endLine: b.end, quoteKind: "none", quote: [], image: b.src };
}

export function lineRef(c: { startLine: number; endLine: number }): string {
    return c.endLine > c.startLine ? `${c.startLine}-${c.endLine}` : `${c.startLine}`;
}

// the path the agent reads: relative to the panel file's root when the file is under it, else absolute; always "/"
export function refPath(file: string, root: string | null): string {
    if (root != null && isUnderRoot(root, file)) {
        return toRel(root, file);
    }
    return file.replace(/\\/g, "/");
}

export function imageName(src: string): string {
    return src.split(/[\\/]/).pop() ?? src;
}

export function commentRefLabel(c: Pick<MdComment, "file" | "root" | "startLine" | "endLine" | "image">): string {
    const ref = `${refPath(c.file, c.root)}:${lineRef(c)}`;
    return c.image != null ? `${ref} · image ${imageName(c.image)}` : ref;
}

// files in the order they were first commented on; in a file, by start line, then by when each was added
export function orderMdComments(comments: MdComment[]): MdComment[] {
    const first = new Map<string, number>();
    for (const c of comments) {
        first.set(c.file, Math.min(first.get(c.file) ?? Infinity, c.seq));
    }
    return [...comments].sort(
        (a, b) => first.get(a.file) - first.get(b.file) || a.startLine - b.startLine || a.seq - b.seq
    );
}

// a card's number is its item's number in the message
export function cardNumbers(comments: MdComment[]): Map<string, number> {
    return new Map(orderMdComments(comments).map((c, i) => [c.id, i + 1]));
}

function plural(n: number, word: string): string {
    return `${n} ${word}${n === 1 ? "" : "s"}`;
}

export function countLine(comments: MdComment[]): string {
    const files = new Set(comments.map((c) => c.file)).size;
    return `${plural(comments.length, "comment")} on ${plural(files, "file")}`;
}

// line review's shape (linecomments.ts formatLineComments), so the agent reads one format for a diff and a document
export function formatMdComments(comments: MdComment[]): string {
    if (comments.length === 0) {
        return "";
    }
    const ordered = orderMdComments(comments);
    const files = new Set(ordered.map((c) => c.file));
    const header =
        files.size === 1
            ? `Comments on ${refPath(ordered[0].file, ordered[0].root)} (${ordered.length}):`
            : `Comments on ${files.size} files (${ordered.length}):`;
    const items = ordered.map((c, i) => {
        const image = c.image != null ? ` (image ${c.image})` : "";
        const out = [`${i + 1}. ${refPath(c.file, c.root)}:${lineRef(c)}${image}`];
        for (const q of c.quote) {
            out.push(`   > ${q}`);
        }
        const note = c.note.trimEnd();
        if (note !== "") {
            for (const line of note.split(/\r?\n/)) {
                out.push(line === "" ? "" : `   ${line}`);
            }
        }
        return out.join("\n");
    });
    return [header, "", items.join("\n\n")].join("\n");
}

// a link inside the Preview: a relative path becomes a file beside this one; a web link, an in-page anchor and a
// root-relative path (ambiguous outside a repository) are left to the default handling
export function panelLink(
    fileAbs: string,
    href: string
): { abs: string; line: number | null; markdown: boolean } | null {
    if (href.startsWith("/")) {
        return null;
    }
    const target = resolveDocLink(fileAbs.replace(/\\/g, "/"), href);
    if (target == null) {
        return null;
    }
    return { abs: target.rel, line: target.line, markdown: isMarkdownPath(target.rel) };
}
