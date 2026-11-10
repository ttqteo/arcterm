// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The part of the chat message box (chateditor.tsx) that is arithmetic on its content, with no Lexical in it, so it can
// be tested. The editor's content is lines (Lexical paragraphs); a line is one `Segment` per Lexical child, in order: a
// text node is a text segment, a file pill a pill segment, and a line break a text segment holding just "\n". The text
// of the whole box is the lines joined with "\n", each pill written as `mentionText(path)`. These functions turn the
// text (chateditormodel.ts) into the line the editor builds, and map a place in the lines (line, child, offset) to an
// offset in the text and back, so a caret can be reported as a string offset and set from one. Pure.

import { locate, mentionText, plainOffset, segmentLength, type Segment } from "./chateditormodel";

/** One Lexical paragraph's children, a segment each. A line break is `{ kind: "text", text: "\n" }`. */
export type EditorLine = Segment[];

/** A place in the lines: the line, the child in it, and the offset in that child (characters into a text node; for a pill
 *  or a line break 0 = before it, 1 = after it). */
export interface EditorPlace {
    line: number;
    index: number;
    offset: number;
}

/** Pure: a segment that is a line break: a text segment of exactly one newline. */
export function isBreak(s: Segment): boolean {
    return s.kind === "text" && s.text === "\n";
}

/** Pure: the text a segment stands for: a text run as it is, a pill as the mention it is written as. */
function segmentText(s: Segment): string {
    return s.kind === "text" ? s.text : mentionText(s.path);
}

/** Pure: the whole box's text for its lines: each line's segments written out, the lines joined with "\n". */
export function linesText(lines: EditorLine[]): string {
    return lines.map((line) => line.map(segmentText).join("")).join("\n");
}

/** Pure: the line the editor builds for a message's segments (`segmentsOf`): a newline inside a text run becomes a line
 *  break of its own with the text around it as text nodes, so the whole message sits in one paragraph the way Lexical's
 *  plain text keeps it. An empty message is an empty line. Writing it back with `linesText([line])` gives the message. */
export function buildLine(segments: Segment[]): EditorLine {
    const out: EditorLine = [];
    for (const s of segments) {
        if (s.kind === "pill") {
            out.push(s);
            continue;
        }
        const pieces = s.text.split("\n");
        pieces.forEach((piece, i) => {
            if (i > 0) {
                out.push({ kind: "text", text: "\n" });
            }
            if (piece !== "") {
                out.push({ kind: "text", text: piece });
            }
        });
    }
    return out;
}

function lineLength(line: EditorLine): number {
    return line.reduce((n, s) => n + segmentLength(s), 0);
}

/** Pure: the offset in the box's text of a place in its lines. A line or child out of range is clamped to the end. */
export function placeOffset(lines: EditorLine[], place: EditorPlace): number {
    let before = 0;
    for (let i = 0; i < lines.length; i++) {
        if (i === place.line) {
            return before + plainOffset(lines[i], place.index, place.offset);
        }
        before += lineLength(lines[i]) + 1;
    }
    return Math.max(before - 1, 0);
}

/** Pure: the place in the lines of an offset in the box's text, the inverse of `placeOffset`. A boundary between two
 *  children belongs to the earlier one (so the end of the text before a pill, the far side of a pill before the text
 *  after it, and the far side of a line break for the start of the next line); an offset inside a pill's text snaps to its
 *  far side; one out of range is clamped. A line with no children answers index 0, offset 0. */
export function placeOf(lines: EditorLine[], plain: number): EditorPlace {
    let start = 0;
    for (let i = 0; i < lines.length; i++) {
        const length = lineLength(lines[i]);
        if (plain <= start + length) {
            return { line: i, ...locate(lines[i], plain - start) };
        }
        start += length + 1;
    }
    const last = lines.length - 1;
    return last < 0
        ? { line: 0, index: 0, offset: 0 }
        : { line: last, ...locate(lines[last], Number.MAX_SAFE_INTEGER) };
}

/** Pure: the index of the pill a Backspace (`backward`) or a Delete would take for a collapsed caret at `index`/`offset`
 *  of the line: the pill right behind the caret, or right ahead of it, with nothing but the caret between. Null when
 *  the caret is inside a text, or a line break (or the line's edge) is the neighbour. */
export function adjacentPill(line: EditorLine, index: number, offset: number, backward: boolean): number | null {
    const seg = line[index];
    if (seg == null) {
        return null;
    }
    const isPill = (i: number) => line[i]?.kind === "pill";
    if (backward) {
        if (offset > 0) {
            return seg.kind === "pill" ? index : null;
        }
        return isPill(index - 1) ? index - 1 : null;
    }
    if (seg.kind === "pill" && offset <= 0) {
        return index;
    }
    // a pill's offset is 0 | 1 (before | after it), not a character count
    const atEnd = seg.kind === "pill" ? offset > 0 : offset >= segmentLength(seg);
    return atEnd && isPill(index + 1) ? index + 1 : null;
}
