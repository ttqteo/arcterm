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

export interface ProseComment extends ProseAnchor {
    id: string;
    note: string;
    draft: boolean;
}

export const QUOTE_MAX = 160;

const REQUEST_HEAD = "Request changes";
const NOTE_ARROW = "   → ";
const NOTE_INDENT = " ".repeat(NOTE_ARROW.length);

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
            lines.push(`${i + 1}. [${c.sectionLabel} ¶${c.paragraph}] "${c.quote}"`, ...noteLines(c.note));
        });
    const general = generalNote.trim();
    if (general !== "") {
        lines.push(`General: ${general}`);
    }
    return lines.join("\n");
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
