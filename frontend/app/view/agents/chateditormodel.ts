// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The text model of the chat message box (chateditor.tsx). The box is a small rich editor, but the plain text stays the
// source of truth: the message as the agent receives it, a file you mentioned written `@<path>` (`@"<path>"` when the
// path holds whitespace), an agent, run or council written `agent:<id>` (refbadge.ts). This file splits that text into
// runs of text, file pills and references, with the same rules as the pills and badges in your sent bubble
// (`mentionTokens`, filementiontokens.ts; `refSpans`, refbadge.ts), and maps an offset in the text to a place in the runs
// and back, so the editor can put the caret where a string offset says and report the caret as one. Pure.
//
// Splitting is lossless: the segments, written back (a text run as it is, a pill as `mentionText`, a reference as its
// `raw`), are the text they came from. So a `@"src/a.ts"` quoted for no reason stays text here, since a pill would write
// it back as `@src/a.ts`; a reference keeps the `@` and the case it was written with.

import { mentionTokens } from "./filementiontokens";
import { refSpans } from "./refbadge";
import type { RefKind } from "./refmention";

/** A run of text, a file pill (`@path`), or a reference (`agent:<id>`, `run:<id>`, `council:<id>`: `raw` is the token as
 *  written, `@` and case kept; `id` is lowercased, and a `tab:` reads as an agent). */
export type Segment =
    | { kind: "text"; text: string }
    | { kind: "pill"; path: string }
    | { kind: "ref"; ref: RefKind; id: string; raw: string };

/** Pure: whether a segment is a thing the caret steps over whole (a pill or a reference), not a run of text. */
export const isAtom = (s: Segment): s is Exclude<Segment, { kind: "text" }> => s.kind !== "text";

/** Pure: how many leading characters of the box's text the editor leaves out: a bash command's `!` (Chat's bash mode) is
 *  drawn as a marker beside the editor, as Claude Code's own box draws it, so the command starts in the editor after a gap.
 *  It stays in the text: the agent receives `!<command>`. */
export function bangSkip(text: string, bash: boolean): number {
    return bash && text.startsWith("!") ? 1 : 0;
}

/** Pure: the part of the box's text the editor shows, past the `skip` characters drawn beside it. */
export function shownText(text: string, skip: number): string {
    return text.slice(skip);
}

/** Pure: what the editor says (its text and caret) as the box's text and caret: the skipped `!` put back in front. */
export function fromShown(shown: string, caret: number, skip: number): { text: string; caret: number } {
    return { text: "!".repeat(skip) + shown, caret: caret + skip };
}

/** Pure: how a pill is written in the message: `@path`, or `@"path"` when the path holds whitespace. */
export function mentionText(path: string): string {
    return /\s/.test(path) ? `@"${path}"` : `@${path}`;
}

/** Pure: `text` as runs of text, file pills and references, in order, with no empty run and no two text runs side by
 *  side. A mention or a reference the caret is in or at the end of (still being typed) stays text, as in `mentionTokens`
 *  and `refSpans`; a reference inside a file mention is part of the file. With `pills: false` (a bash command: the shell
 *  knows no `@` mentions, and the ghost text mirrors the plain text) the text is one run and nothing is made of it,
 *  whatever it holds. */
export function segmentsOf(text: string, caret?: number, opts?: { pills?: boolean }): Segment[] {
    if (opts?.pills === false) {
        return text === "" ? [] : [{ kind: "text", text }];
    }
    const out: Segment[] = [];
    const addText = (run: string) => {
        if (run === "") {
            return;
        }
        const last = out[out.length - 1];
        if (last?.kind === "text") {
            last.text += run;
        } else {
            out.push({ kind: "text", text: run });
        }
    };
    const atoms: { start: number; end: number; seg: Segment }[] = [];
    for (const token of mentionTokens(text, caret)) {
        if (text.slice(token.start, token.end) === mentionText(token.path)) {
            atoms.push({ start: token.start, end: token.end, seg: { kind: "pill", path: token.path } });
        }
    }
    const files = atoms.slice();
    for (const s of refSpans(text, caret)) {
        if (!files.some((f) => s.start < f.end && f.start < s.end)) {
            atoms.push({ start: s.start, end: s.end, seg: { kind: "ref", ref: s.kind, id: s.id, raw: s.raw } });
        }
    }
    atoms.sort((a, b) => a.start - b.start);
    let at = 0;
    for (const atom of atoms) {
        addText(text.slice(at, atom.start));
        out.push(atom.seg);
        at = atom.end;
    }
    addText(text.slice(at));
    return out;
}

/** Pure: how many characters of the text a segment is: the run's length, the mention the pill is written as, or the
 *  reference as written. */
export function segmentLength(s: Segment): number {
    return s.kind === "text" ? s.text.length : s.kind === "ref" ? s.raw.length : mentionText(s.path).length;
}

/** An atom (a file pill or a reference) found in a text, with where it is: `start` to `end` is the token as written. */
export interface AtomRun {
    start: number;
    end: number;
    seg: Exclude<Segment, { kind: "text" }>;
}

/** Pure: the file mentions and references in `text` that are finished, with their offsets, in order: what the box makes a
 *  pill or a badge of once typed or pasted, by the rules of `segmentsOf` (`caret` as there: a token the caret is in or at
 *  the end of is still being typed, and left out; with no caret every finished token counts). */
export function atomRunsIn(text: string, caret?: number): AtomRun[] {
    const out: AtomRun[] = [];
    let at = 0;
    for (const seg of segmentsOf(text, caret)) {
        const end = at + segmentLength(seg);
        if (isAtom(seg)) {
            out.push({ start: at, end, seg });
        }
        at = end;
    }
    return out;
}

/** Where a caret stands once a text's runs are swapped for pills and badges (`caretAmongRuns`): `gap` is the text between
 *  the runs (0 before the first run, `n` after run `n - 1`) and `offset` the characters into it; `before` is the run the
 *  caret sits right before with no text between them. */
export type RunCaret = { gap: number; offset: number } | { before: number };

/** Pure: the caret's place among the runs of its text once they are swapped, so the swap can put it back where it was in
 *  the text. A caret in the text between runs, or against a run's start with text before it, is in that text (the end of
 *  it); one at a run's start with no text before it (the caret at 0 and a token starting there: `xagent:7cd99627 ` with
 *  the `x` deleted) is `before` that run, which `replace` would otherwise carry to its far side. A caret inside a run is
 *  null: `atomRunsIn` leaves a token the caret is in or ends. `runs` are in order and apart. */
export function caretAmongRuns(runs: { start: number; end: number }[], caret: number): RunCaret | null {
    for (let gap = 0; gap <= runs.length; gap++) {
        const from = gap === 0 ? 0 : runs[gap - 1].end;
        if (caret < from) {
            return null;
        }
        const to = gap === runs.length ? Number.POSITIVE_INFINITY : runs[gap].start;
        if (caret <= to) {
            return from === to ? { before: gap } : { gap, offset: caret - from };
        }
    }
    return null;
}

/** Pure: which of the two spaces around a pill that is taken away goes with it, so deleting `đọc @a/b.ts tiếp` leaves
 *  `đọc tiếp` and not two spaces. `before` and `after` are the text right before and right after the pill in its line ("" at
 *  the line's edge or beside another pill). "after" when a space follows and the pill is at the line's start or has a space
 *  before it; "before" when the pill ends the line after a space; null otherwise (a single space, or punctuation, stays). */
export function gapToDrop(before: string, after: string): "before" | "after" | null {
    if (after.startsWith(" ") && (before === "" || before.endsWith(" "))) {
        return "after";
    }
    if (after === "" && before.endsWith(" ")) {
        return "before";
    }
    return null;
}

/** Pure: the offset in the whole text of a place in the segments. In a text run `offset` is characters into it; for a
 *  pill or a reference it is 0 (before it) or 1 (after it). An offset out of range is clamped; an index past the list is
 *  the end. */
export function plainOffset(segments: Segment[], index: number, offset: number): number {
    let before = 0;
    for (let i = 0; i < segments.length; i++) {
        const length = segmentLength(segments[i]);
        if (i === index) {
            if (isAtom(segments[i])) {
                return before + (offset > 0 ? length : 0);
            }
            return before + Math.min(Math.max(offset, 0), length);
        }
        before += length;
    }
    return before;
}

/** Pure: the place in the segments of an offset in the whole text, the inverse of `plainOffset`. A boundary between two
 *  segments belongs to the earlier one (the end of the text before a pill, the far side of a pill before the text after
 *  it); an offset inside a pill's or a reference's text snaps to its end; one out of range is clamped. */
export function locate(segments: Segment[], plain: number): { index: number; offset: number } {
    let start = 0;
    for (let i = 0; i < segments.length; i++) {
        const length = segmentLength(segments[i]);
        const end = start + length;
        if (plain <= end) {
            if (isAtom(segments[i])) {
                return { index: i, offset: plain <= start ? 0 : 1 };
            }
            return { index: i, offset: Math.max(plain - start, 0) };
        }
        start = end;
    }
    const last = segments.length - 1;
    return last < 0
        ? { index: 0, offset: 0 }
        : { index: last, offset: isAtom(segments[last]) ? 1 : segmentLength(segments[last]) };
}
