// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Pure: a Doc review comment, anchored to sentences of one paragraph of the after-document, and the one answer
// Request changes sends. A comment quotes the *source* of its sentences, not what the view drew, so the agent can
// search the file for it (`\emph{XYZ}` is in the file, "XYZ" in italics is not).

import type { ProseSentence } from "./docprose";

export interface ProseAnchor {
    sectionIndex: number; // SectionChange.index: orders comments, since labels don't sort (`§10`, headings)
    sectionLabel: string;
    paragraph: number; // ¶, 1-based, in the after-document
    sentences: [number, number]; // first and last after-sentence index in that paragraph
    quote: string; // source text of those sentences, whitespace collapsed, ≤ QUOTE_MAX chars + "…"
    selectedText: string;
}

// A suggested edit (docs/superpowers/specs/2026-10-07-doc-review-suggested-edits-design.md): the paragraph's source
// as loaded (`from`), as the user edited it (`to`), and the smallest stretch of the change that is unique in the
// file (`old` → `new`, from replacementFor), which is what the agent is sent. The file itself is never written.
export interface Suggestion {
    from: string;
    to: string;
    old: string;
    new: string;
}

export interface ProseComment extends ProseAnchor {
    id: string;
    note: string;
    draft: boolean;
    suggestion?: Suggestion;
}

export const QUOTE_MAX = 160;

const REQUEST_HEAD = "Request changes";
const NOTE_ARROW = "   → ";
const NOTE_INDENT = " ".repeat(NOTE_ARROW.length);
const QUOTE_INDENT = "   ";

function cutQuote(text: string): string {
    const q = text.replace(/\s+/g, " ").trim();
    const chars = Array.from(q);
    return chars.length <= QUOTE_MAX ? q : chars.slice(0, QUOTE_MAX).join("").trimEnd() + "…";
}

// Sentences made by one macro (`\emph{One. Two.}`) share a source span, so the quote runs from the earliest start
// to the latest end of the covered sentences rather than from the first's start to the last's end.
export function anchorFor(
    source: string,
    para: { sectionIndex: number; label: string; index: number; sentences: ProseSentence[] },
    first: number,
    last: number,
    selectedText: string
): ProseAnchor {
    const lo = Math.min(first, last);
    const hi = Math.max(first, last);
    const covered = para.sentences.slice(lo, hi + 1);
    const start = Math.min(...covered.map((s) => s.source.start));
    const end = Math.max(...covered.map((s) => s.source.end));
    return {
        sectionIndex: para.sectionIndex,
        sectionLabel: para.label,
        paragraph: para.index,
        sentences: [lo, hi],
        quote: covered.length === 0 ? "" : cutQuote(source.slice(start, end)),
        selectedText,
    };
}

// document order; a stable sort, so comments on the same sentence keep the order they were added in
export function orderComments(comments: ProseComment[]): ProseComment[] {
    return [...comments].sort(
        (a, b) => a.sectionIndex - b.sectionIndex || a.paragraph - b.paragraph || a.sentences[0] - b.sentences[0]
    );
}

function noteLines(note: string): string[] {
    const text = note.trim();
    if (text === "") {
        return [];
    }
    return text.split(/\r?\n/).map((line, i) => (i === 0 ? NOTE_ARROW : NOTE_INDENT) + line.trimEnd());
}

// The answer text, e.g.
//   Request changes
//   1. [§3.2 ¶2] "XYZ replaces the payload initialization…"
//      → Say why this de-confounds success rate.
//   General: §3 still reads like a tutorial.
// Drafts are not sent; `General:` only when the note says something.
export function formatRequest(comments: ProseComment[], generalNote: string): string {
    const lines = [REQUEST_HEAD];
    orderComments(comments)
        .filter((c) => !c.draft)
        .forEach((c, i) => {
            const at = `${i + 1}. [${c.sectionLabel} ¶${c.paragraph}]`;
            if (c.suggestion != null) {
                // unclipped: the agent searches the file for the old text, so it must be exact
                lines.push(`${at} Edit: replace`, ...quotedLines(c.suggestion.old), "   with");
                lines.push(...quotedLines(c.suggestion.new), ...noteLines(c.note));
                return;
            }
            lines.push(`${at} "${c.quote}"`, ...noteLines(c.note));
        });
    const general = generalNote.trim();
    if (general !== "") {
        lines.push(`General: ${general}`);
    }
    return lines.join("\n");
}

function quotedLines(text: string): string[] {
    return `"${text}"`.split(/\r?\n/).map((line) => QUOTE_INDENT + line);
}

// the source a paragraph's sentences come from: earliest start to latest end, since one macro's sentences share a span
export function paragraphSpan(sentences: ProseSentence[]): { start: number; end: number } {
    if (sentences.length === 0) {
        return { start: 0, end: 0 };
    }
    return {
        start: Math.min(...sentences.map((s) => s.source.start)),
        end: Math.max(...sentences.map((s) => s.source.end)),
    };
}

// words and the whitespace between them, alternating, so joining any run of them gives back the source exactly
function wordTokens(text: string): string[] {
    return text.split(/(\s+)/).filter((t) => t !== "");
}

const isSpace = (t: string | undefined) => t != null && /^\s+$/.test(t);

function occurrences(text: string, needle: string): number {
    let n = 0;
    for (let at = text.indexOf(needle); at >= 0; at = text.indexOf(needle, at + 1)) {
        n++;
    }
    return n;
}

// an old text shorter than this ("A") is unique by accident and hard to spot; it gets context until it is this long
const MIN_OLD = 16;

// The smallest stretch of `from` that holds the whole change and occurs exactly once in the file, and what it becomes:
// the common leading and trailing words are dropped, then context is added back a word at a time on both sides until
// the old text is unique (or is the whole paragraph). What the agent is told to replace.
export function replacementFor(fileText: string, from: string, to: string): { old: string; new: string } {
    const a = wordTokens(from);
    const b = wordTokens(to);
    let prefix = 0;
    while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) {
        prefix++;
    }
    let suffix = 0;
    while (
        suffix < a.length - prefix &&
        suffix < b.length - prefix &&
        a[a.length - 1 - suffix] === b[b.length - 1 - suffix]
    ) {
        suffix++;
    }
    let lo = prefix;
    let hi = a.length - suffix; // a[lo, hi) is the old core; context is a[lo, prefix) and a[a.length - suffix, hi)
    const build = () => {
        const tail = hi - (a.length - suffix);
        return {
            old: a.slice(lo, hi).join(""),
            new:
                a.slice(lo, prefix).join("") +
                b.slice(prefix, b.length - suffix).join("") +
                b.slice(b.length - suffix, b.length - suffix + tail).join(""),
        };
    };
    for (;;) {
        // never start or end on whitespace: a quote that begins with a space is easy to miss when searching
        while (lo < prefix && isSpace(a[lo])) {
            lo++;
        }
        while (hi > a.length - suffix && isSpace(a[hi - 1])) {
            hi--;
        }
        const r = build();
        const enough = r.old.trim().length >= MIN_OLD && occurrences(fileText, r.old) === 1;
        if (enough || (lo === 0 && hi === a.length)) {
            return r;
        }
        lo = Math.max(0, lo - (isSpace(a[lo - 1]) ? 2 : 1));
        hi = Math.min(a.length, hi + (isSpace(a[hi]) ? 2 : 1));
    }
}

export type WordOp = { op: "same" | "delete" | "insert"; text: string };

// a word-level diff of two source strings (an LCS over word tokens), adjacent runs of one op merged
export function wordDiff(before: string, after: string): WordOp[] {
    // each word with the whitespace after it, so a diff never pairs up the spaces between changed words
    const words = (text: string) => text.match(/^\s+|\S+\s*/g) ?? [];
    const a = words(before);
    const b = words(after);
    const lcs: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
    for (let i = a.length - 1; i >= 0; i--) {
        for (let j = b.length - 1; j >= 0; j--) {
            lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
        }
    }
    const out: WordOp[] = [];
    const push = (op: WordOp["op"], text: string) => {
        const last = out[out.length - 1];
        if (last != null && last.op === op) {
            last.text += text;
        } else {
            out.push({ op, text });
        }
    };
    let i = 0;
    let j = 0;
    while (i < a.length || j < b.length) {
        if (i < a.length && j < b.length && a[i] === b[j]) {
            push("same", a[i]);
            i++;
            j++;
        } else if (i < a.length && (j === b.length || lcs[i + 1][j] >= lcs[i][j + 1])) {
            // a deletion first, so a replaced word reads struck then new
            push("delete", a[i]);
            i++;
        } else {
            push("insert", b[j]);
            j++;
        }
    }
    return out;
}

export function canRequest(comments: ProseComment[], generalNote: string): boolean {
    return comments.some((c) => !c.draft) || generalNote.trim() !== "";
}

// A DOM selection reduced to two points (the pane reads them from `data-section`, `data-p`, `data-s` ancestors).
export interface SelPoint {
    section: number;
    paragraph: number;
    sentence: number;
}

function comparePoints(a: SelPoint, b: SelPoint): number {
    return a.section - b.section || a.paragraph - b.paragraph || a.sentence - b.sentence;
}

// A comment anchors to one paragraph: a selection that runs past its first paragraph keeps the rest of that
// paragraph and drops what follows.
export function clipSelection(
    a: SelPoint,
    b: SelPoint,
    lastSentence: (section: number, paragraph: number) => number
): { section: number; paragraph: number; first: number; last: number; clipped: boolean } {
    const [from, to] = comparePoints(a, b) <= 0 ? [a, b] : [b, a];
    const { section, paragraph } = from;
    if (to.section === section && to.paragraph === paragraph) {
        return { section, paragraph, first: from.sentence, last: to.sentence, clipped: false };
    }
    return { section, paragraph, first: from.sentence, last: lastSentence(section, paragraph), clipped: true };
}
