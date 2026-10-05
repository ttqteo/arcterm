// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Pure: what the Doc review view draws from a prose diff and the review state — which rows the Changes tab shows,
// which sentences carry a comment, what the tray offers and says, the toolbar's meta line, and where a focus item
// or a `#anchor` scrolls. docreviewpane.tsx renders it.

import type { BaselineFrom } from "./docbaseline";
import { cutLabel } from "./docprose";
import type { LastSend } from "./docreviewstore";
import { canRequest, orderComments, type ProseComment } from "./proseanchor";
import type { ParagraphChange, SectionChange, SentenceChange } from "./prosediff";

// below this pane width the comment column folds under its paragraph
export const COMMENT_COLUMN_MIN_PANE = 720;

export function isNarrow(paneWidth: number): boolean {
    return paneWidth < COMMENT_COLUMN_MIN_PANE;
}

export type ReviewRow =
    | { kind: "section"; key: string; section: SectionChange; stats: string }
    | { kind: "unchanged"; key: string; label: string }
    | { kind: "paragraph"; key: string; section: SectionChange; paragraph: ParagraphChange; comments: ProseComment[] };

// A comment anchors to the after-document, so it belongs to a section or paragraph that is still there; a removed
// one keeps its before-document number, which could collide with an after-document one.
const holds = (c: ProseComment, s: SectionChange) => s.status !== "removed" && c.sectionIndex === s.index;
const holdsParagraph = (c: ProseComment, s: SectionChange, p: ParagraphChange) =>
    holds(c, s) && p.status !== "removed" && c.paragraph === p.index;

// Changed sections, each heading and every paragraph of it; a run of unchanged sections folds into one row unless
// wholeFile. A section that holds a comment never folds, so the comment always has its paragraph beside it.
export function reviewRows(changes: SectionChange[], comments: ProseComment[], wholeFile: boolean): ReviewRow[] {
    const ordered = orderComments(comments);
    const rows: ReviewRow[] = [];
    let run: SectionChange[] = [];
    const flush = () => {
        if (run.length > 0) {
            rows.push({ kind: "unchanged", key: `run${rows.length}`, label: runLabel(run) });
            run = [];
        }
    };
    changes.forEach((section, i) => {
        if (!wholeFile && section.status === "same" && !ordered.some((c) => holds(c, section))) {
            run.push(section);
            return;
        }
        flush();
        // keyed by position: a removed section and the after section at its index share an index
        rows.push({ kind: "section", key: `s${i}`, section, stats: sectionStats(section.counts) });
        section.paragraphs.forEach((paragraph, j) => {
            rows.push({
                kind: "paragraph",
                key: `s${i}p${j}`,
                section,
                paragraph,
                comments: ordered.filter((c) => holdsParagraph(c, section, paragraph)),
            });
        });
    });
    flush();
    return rows;
}

function countGroups(counts: { insert: number; delete: number; modify: number }): string[] {
    const diff = [counts.insert > 0 ? `+${counts.insert}` : "", counts.delete > 0 ? `−${counts.delete}` : ""]
        .filter(Boolean)
        .join(" ");
    return [diff, counts.modify > 0 ? `${counts.modify} edited` : ""].filter(Boolean);
}

// beside a section's heading: `+2 −1 1 edited`
export function sectionStats(counts: { insert: number; delete: number; modify: number }): string {
    return countGroups(counts).join(" ");
}

// An unnumbered section's label is its title cut short, which would print the same words twice.
export function showsLabel(s: { label: string; title: string }): boolean {
    return s.label !== cutLabel(s.title);
}

// `§2 Background · unchanged` for one section, `1. – 4. · unchanged` for a run
export function runLabel(sections: { label: string; title: string }[]): string {
    if (sections.length === 1) {
        const s = sections[0];
        return `${showsLabel(s) ? `${s.label} ${s.title}` : s.title} · unchanged`;
    }
    return `${sections[0].label} – ${sections[sections.length - 1].label} · unchanged`;
}

// Saved comments are numbered as the answer numbers them (formatRequest sends no drafts), so a chip's number is
// the one the agent reads back; a draft takes the next free number.
export function commentNumbers(comments: ProseComment[]): Map<string, number> {
    const ordered = orderComments(comments);
    const numbers = new Map<string, number>();
    for (const c of [...ordered.filter((c) => !c.draft), ...ordered.filter((c) => c.draft)]) {
        numbers.set(c.id, numbers.size + 1);
    }
    return numbers;
}

export interface SentenceMark {
    draft: boolean; // only drafts cover it: the underline is dashed
    chips: number[]; // comments that end on it
}

// keyed by after-sentence index within one paragraph; every covered sentence is underlined, the last one chipped
export function sentenceMarks(comments: ProseComment[], numbers: Map<string, number>): Map<number, SentenceMark> {
    const marks = new Map<number, SentenceMark>();
    for (const c of orderComments(comments)) {
        const [first, last] = c.sentences;
        for (let s = first; s <= last; s++) {
            const m = marks.get(s) ?? { draft: true, chips: [] };
            m.draft = m.draft && c.draft;
            if (s === last) {
                m.chips.push(numbers.get(c.id) ?? 0);
            }
            marks.set(s, m);
        }
    }
    for (const m of marks.values()) {
        m.chips.sort((a, b) => a - b);
    }
    return marks;
}

export interface TrayState {
    accent: "approve" | "request";
    requestEnabled: boolean;
    saved: number;
    drafts: number;
    hint: string;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

// With nothing to send back, Approve is the accent; the first saved comment or a note makes it Request changes.
export function trayState(comments: ProseComment[], generalNote: string, agentName: string): TrayState {
    const saved = comments.filter((c) => !c.draft).length;
    const drafts = comments.length - saved;
    const hasNote = generalNote.trim() !== "";
    const requestEnabled = canRequest(comments, generalNote);
    const draftLine = drafts > 0 ? `${plural(drafts, "comment is", "comments are")} not added yet.` : "";
    let hint: string;
    if (requestEnabled) {
        const what = saved > 0 ? plural(saved, "comment", "comments") + (hasNote ? " and your note" : "") : "your note";
        hint = [`Sends ${what} to ${agentName} as one answer.`, draftLine].filter(Boolean).join(" ");
    } else {
        hint = draftLine || "Comment on a passage to ask for changes.";
    }
    return { accent: requestEnabled ? "request" : "approve", requestEnabled, saved, drafts, hint };
}

// The ask reads as sent from sentIdsAtom, whichever surface answered; lastSend only says what this tray sent.
export function sentLine(lastSend: LastSend | null, sent: boolean, agentName: string): string | null {
    if (!sent) {
        return null;
    }
    let what = "Sent";
    if (lastSend?.kind === "approve") {
        what = "Sent: Approve";
    } else if (lastSend?.kind === "request") {
        what =
            lastSend.comments > 0
                ? `Sent: Request changes, ${plural(lastSend.comments, "comment", "comments")}`
                : "Sent: Request changes";
    }
    return `${what} · back to the terminal when ${agentName} picks it up`;
}

const pad2 = (n: number) => String(n).padStart(2, "0");

// `+2 −1 · 1 edited · against 5eb0de24, session start`
export function metaLine(changes: SectionChange[], from: BaselineFrom, ref: string, reviewedAt?: number): string {
    const total = { insert: 0, delete: 0, modify: 0 };
    for (const s of changes) {
        total.insert += s.counts.insert;
        total.delete += s.counts.delete;
        total.modify += s.counts.modify;
    }
    const groups = countGroups(total);
    let against: string;
    switch (from) {
        case "session":
            against = `against ${ref}, session start`;
            break;
        case "head":
            against = "against HEAD";
            break;
        case "previous": {
            const at = new Date(reviewedAt ?? 0);
            against = `against what you reviewed at ${pad2(at.getHours())}:${pad2(at.getMinutes())}`;
            break;
        }
        default:
            against = "new file";
    }
    return [...(groups.length > 0 ? groups : ["no prose changes"]), against].join(" · ");
}

const SECTION_SIGN = /^(§\d+(?:\.\d+)*)(?=[\s:,;]|$)/;
// a markdown heading's enumerator, as docprose labels it (`5`, `5.`, `5.2`); focusTarget checks it against the
// labels, while a chip only splits off one with a dot, so a leading year or count stays part of the text
const ENUMERATOR = /^(\d+(?:\.\d+)*\.?)(?=[\s:,;]|$)/;
const DOTTED = /^(\d+\.(?:\d+\.?)*)(?=[\s:,;]|$)/;
const PARAGRAPH = /^[\s:,;]*¶\s*(\d+)/;

// A focus item's leading label (`§5.2`, `5.`), which a chip shows apart from its text.
export function leadLabel(text: string): { label: string; rest: string } | null {
    const m = SECTION_SIGN.exec(text) ?? DOTTED.exec(text);
    if (m == null) {
        return null;
    }
    return { label: m[1], rest: text.slice(m[1].length).trim() };
}

// Where a focus item scrolls: a leading `§` label, else a leading enumerator equal to a section's label, else the
// section whose title the text names (the longest, so a short title can't claim a sentence about a longer one).
// `¶n` after the label names a paragraph. null: the item names no section, so it is inert.
export function focusTarget(
    text: string,
    sections: { label: string; title: string }[]
): { sectionIndex: number; paragraph?: number } | null {
    for (const re of [SECTION_SIGN, ENUMERATOR]) {
        const m = re.exec(text);
        const at = m == null ? -1 : sections.findIndex((s) => s.label === m[1]);
        if (at >= 0) {
            const p = PARAGRAPH.exec(text.slice(m[1].length));
            return p != null ? { sectionIndex: at, paragraph: Number(p[1]) } : { sectionIndex: at };
        }
    }
    const lower = text.toLowerCase();
    let best = -1;
    sections.forEach((s, i) => {
        const title = s.title.trim().toLowerCase();
        if (title !== "" && lower.includes(title) && (best < 0 || title.length > sections[best].title.length)) {
            best = i;
        }
    });
    return best >= 0 ? { sectionIndex: best } : null;
}

// GitHub's heading slug: lower case, punctuation dropped (letters and marks of any script kept), spaces to hyphens
export function headingId(title: string): string {
    return title
        .normalize("NFC")
        .trim()
        .toLowerCase()
        .replace(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu, "")
        .replace(/ /g, "-");
}

// a markdown heading as written: its enumerator is the label, kept apart from the title
export function sectionHeading(s: { label: string; title: string }): string {
    return /^\d/.test(s.label) && showsLabel(s) ? `${s.label} ${s.title}` : s.title;
}

function decode(s: string): string {
    try {
        return decodeURIComponent(s);
    } catch {
        return s;
    }
}

// the section a `#anchor` link names, or null
export function anchorTarget(sections: { label: string; title: string }[], hash: string): number | null {
    const want = decode(hash.replace(/^#/, "")).normalize("NFC").toLowerCase();
    const at = sections.findIndex((s) => headingId(sectionHeading(s)) === want);
    return at >= 0 ? at : null;
}

export interface ImageMark {
    kind: "added" | "removed" | "same";
    src: string;
    alt: string;
}

// A sentence that is only an image draws as a figure: an added one with a `+ image` caption and a diff-added
// frame, a removed one as its `− image` caption alone. An image inside a sentence of text has no caption.
export function imageMark(change: SentenceChange): ImageMark | null {
    const sentence = change.after ?? change.before;
    const words = sentence?.tokens.filter((t) => t.text.trim() !== "" || t.kind === "image") ?? [];
    if (words.length !== 1 || words[0].kind !== "image") {
        return null;
    }
    const kind = change.op === "insert" ? "added" : change.op === "delete" ? "removed" : "same";
    return { kind, src: words[0].href ?? "", alt: words[0].text };
}

// A link or image src as written (relative, maybe percent-encoded, maybe with a #fragment) resolved against the
// file's folder, in the file's own separator style.
export function resolveRelative(file: string, href: string): string {
    const rel = decode(href.replace(/[?#].*$/, ""));
    if (/^(?:[a-zA-Z]:)?[\\/]/.test(rel)) {
        return rel;
    }
    const sep = file.includes("\\") ? "\\" : "/";
    const parts = file.split(/[\\/]/).slice(0, -1);
    for (const seg of rel.split(/[\\/]/)) {
        if (seg === "..") {
            parts.pop();
        } else if (seg !== "." && seg !== "") {
            parts.push(seg);
        }
    }
    return parts.join(sep);
}
