// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The text model of the chat message box (chateditor.tsx). The box is a small rich editor, but the plain text stays the
// source of truth: the message as the agent receives it, a file you mentioned written `@<path>` (`@"<path>"` when the
// path holds whitespace). This file splits that text into runs of text and file pills, with the same rule as the pills
// in your sent bubble (`mentionTokens`, filementiontokens.ts), and maps an offset in the text to a place in the runs and
// back, so the editor can put the caret where a string offset says and report the caret as one. Pure.
//
// Splitting is lossless: the segments, written back (a text run as it is, a pill as `mentionText`), are the text they
// came from. So a `@"src/a.ts"` quoted for no reason stays text here, since a pill would write it back as `@src/a.ts`.

import { mentionTokens } from "./filementiontokens";

export type Segment = { kind: "text"; text: string } | { kind: "pill"; path: string };

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

/** Pure: `text` as runs of text and file pills, in order, with no empty run and no two text runs side by side. A mention
 *  the caret is in or at the end of (still being typed) stays text, as in `mentionTokens`. */
export function segmentsOf(text: string, caret?: number): Segment[] {
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
    let at = 0;
    for (const token of mentionTokens(text, caret)) {
        const raw = text.slice(token.start, token.end);
        if (raw !== mentionText(token.path)) {
            continue;
        }
        addText(text.slice(at, token.start));
        out.push({ kind: "pill", path: token.path });
        at = token.end;
    }
    addText(text.slice(at));
    return out;
}

/** Pure: how many characters of the text a segment is: the run's length, or the mention the pill is written as. */
export function segmentLength(s: Segment): number {
    return s.kind === "text" ? s.text.length : mentionText(s.path).length;
}

/** Pure: the offset in the whole text of a place in the segments. In a text run `offset` is characters into it; for a
 *  pill it is 0 (before it) or 1 (after it). An offset out of range is clamped; an index past the list is the end. */
export function plainOffset(segments: Segment[], index: number, offset: number): number {
    let before = 0;
    for (let i = 0; i < segments.length; i++) {
        const length = segmentLength(segments[i]);
        if (i === index) {
            if (segments[i].kind === "pill") {
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
 *  it); an offset inside a pill's text snaps to its end; one out of range is clamped. */
export function locate(segments: Segment[], plain: number): { index: number; offset: number } {
    let start = 0;
    for (let i = 0; i < segments.length; i++) {
        const length = segmentLength(segments[i]);
        const end = start + length;
        if (plain <= end) {
            if (segments[i].kind === "pill") {
                return { index: i, offset: plain <= start ? 0 : 1 };
            }
            return { index: i, offset: Math.max(plain - start, 0) };
        }
        start = end;
    }
    const last = segments.length - 1;
    return last < 0
        ? { index: 0, offset: 0 }
        : { index: last, offset: segments[last].kind === "pill" ? 1 : segmentLength(segments[last]) };
}
