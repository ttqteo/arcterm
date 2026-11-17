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
