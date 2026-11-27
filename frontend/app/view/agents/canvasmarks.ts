// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Pure: the marks a user draws on a board, and what they become when sent to the agent.

import { handoffLine } from "@/app/view/code/codehandoff";
import { contextKey, contextPhrase, type MarkContext } from "./protomodel";

export const MARK_MIN_PX = 10;

export type Box = { x0: number; y0: number; x1: number; y1: number };
export type DOMRectLike = { left: number; top: number; width: number; height: number };

// A clean picture of the board (no Arc overlay in it) taken when a mark was drawn: the picture, the part of the frame it
// shows (CSS px from the frame's inside, where a mark's x and y start), and its device px per CSS px
export type MarkShot = { png: Blob; rect: DOMRectLike; scale: number };

// x, y, w, h are CSS px from the frame's inside. ctx is the screen and the variants the board showed when it was drawn;
// shot stays null when no picture could be taken (no host), and the mark stands without it
export type Mark = {
    id: number;
    x: number;
    y: number;
    w: number;
    h: number;
    note: string;
    ctx: MarkContext;
    shot: MarkShot | null;
};

// the context of a board that reports no screen and no slot: a static board, or one drawn with no context given
export const NO_CONTEXT: MarkContext = { screen: null, slots: [] };

// numbered captures only; three digits at least, so a name past 999 still counts toward the next one
const FEEDBACK_NAME = /^(\d{3,})\.png$/;
const FEEDBACK_PAD = 3;

// never reused, so a picture that arrives late finds its mark by id, not another one drawn after a Clear
let lastMarkId = 0;

export function boxToMark(b: Box, ctx: MarkContext = NO_CONTEXT): Mark | null {
    const w = Math.abs(b.x1 - b.x0);
    const h = Math.abs(b.y1 - b.y0);
    if (w <= MARK_MIN_PX || h <= MARK_MIN_PX) {
        return null;
    }
    return { id: ++lastMarkId, x: Math.min(b.x0, b.x1), y: Math.min(b.y0, b.y1), w, h, note: "", ctx, shot: null };
}

export function addMark(marks: Mark[], b: Box, ctx: MarkContext = NO_CONTEXT): Mark[] {
    const m = boxToMark(b, ctx);
    return m == null ? marks : [...marks, m];
}

export function removeMark(marks: Mark[], i: number): Mark[] {
    return marks.filter((_, j) => j !== i);
}

export function setMarkNote(marks: Mark[], i: number, note: string): Mark[] {
    return marks.map((m, j) => (j === i ? { ...m, note } : m));
}

// the capture finishes after the mark was added, and the list may have changed by then; a mark that is gone gets nothing
export function setMarkShot(marks: Mark[], id: number, shot: MarkShot): Mark[] {
    return marks.map((m) => (m.id === id ? { ...m, shot } : m));
}

// a mark and its number in the whole list, which the tray, the layer, the picture and the line all share
export type NumberedMark = { n: number; mark: Mark };

// the marks drawn on one screen with one set of variants, in draw order
export type MarkGroup = { key: string; ctx: MarkContext; marks: NumberedMark[] };

// by context, in the order each first appears; a mark keeps its number in the whole list
export function groupMarks(marks: Mark[]): MarkGroup[] {
    const groups: MarkGroup[] = [];
    marks.forEach((mark, i) => {
        const key = contextKey(mark.ctx);
        let g = groups.find((x) => x.key === key);
        if (g == null) {
            g = { key, ctx: mark.ctx, marks: [] };
            groups.push(g);
        }
        g.marks.push({ n: i + 1, mark });
    });
    return groups;
}

// what the layer draws: the marks of the context on screen
export function marksIn(marks: Mark[], ctx: MarkContext): NumberedMark[] {
    const key = contextKey(ctx);
    const out: NumberedMark[] = [];
    marks.forEach((mark, i) => {
        if (contextKey(mark.ctx) === key) {
            out.push({ n: i + 1, mark });
        }
    });
    return out;
}

// the group's newest picture; a mark whose capture failed has none and an older one stands in
export function groupShot(g: MarkGroup): MarkShot | null {
    for (let i = g.marks.length - 1; i >= 0; i--) {
        const shot = g.marks[i].mark.shot;
        if (shot != null) {
            return shot;
        }
    }
    return null;
}

// a mark's box in the pixels of a picture. Not clamped: a box from a scroll position the picture does not show falls off
// its edge, and drawing it clips
export function shotBox(
    m: Pick<Mark, "x" | "y" | "w" | "h">,
    shot: MarkShot
): { x: number; y: number; w: number; h: number } {
    return {
        x: (m.x - shot.rect.left) * shot.scale,
        y: (m.y - shot.rect.top) * shot.scale,
        w: m.w * shot.scale,
        h: m.h * shot.scale,
    };
}

export function spansContexts(marks: Mark[]): boolean {
    return new Set(marks.map((m) => contextKey(m.ctx))).size > 1;
}

// the tray's name for where a mark was drawn
export function markContextLabel(ctx: MarkContext): string {
    return contextPhrase(ctx) || "the board";
}

export function nextFeedbackName(entryNames: string[]): string {
    let max = 0;
    for (const name of entryNames) {
        const m = FEEDBACK_NAME.exec(name);
        if (m != null) {
            max = Math.max(max, Number(m[1]));
        }
    }
    return `${String(max + 1).padStart(FEEDBACK_PAD, "0")}.png`;
}

export function feedbackRelPath(topic: string, name: string): string {
    return `.superpowers/design/${topic}/feedback/${name}`;
}

// One group's line: the picture, the board, where on it (screen and variants; nothing when there are none, so a static
// board's line is as it always was), then the numbered notes. numbers: each mark's number in the whole list (1 up when
// left out). relPath null: a group sent with no picture, so the line names no file
export function canvasHandoffLine(
    relPath: string | null,
    board: string,
    marks: Mark[],
    ctx: MarkContext = NO_CONTEXT,
    numbers: number[] = marks.map((_, i) => i + 1)
): string {
    const parts = marks.map((m, i) => `${numbers[i]} ${m.note.replace(/\s+/g, " ").trim() || "(no note)"}`);
    const where = contextPhrase(ctx);
    const note = `marks on ${board}${where === "" ? "" : `, ${where}`}: ${parts.join("; ")}`;
    return relPath == null ? note.replace(/\s+/g, " ").trim() : handoffLine({ rel: relPath, note });
}

// a board taller than its pane scrolls, so only the part inside the pane is on screen to capture
export function visibleRect(board: DOMRectLike, clip: DOMRectLike): DOMRectLike {
    const left = Math.max(board.left, clip.left);
    const top = Math.max(board.top, clip.top);
    const right = Math.min(board.left + board.width, clip.left + clip.width);
    const bottom = Math.min(board.top + board.height, clip.top + clip.height);
    return { left, top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
}

// the window capture is in device pixels; the board rect is in CSS pixels
export function cropRect(
    board: DOMRectLike,
    innerWidth: number,
    bitmap: { width: number; height: number }
): { sx: number; sy: number; sw: number; sh: number } {
    const scale = innerWidth > 0 ? bitmap.width / innerWidth : 1;
    const clamp = (v: number, max: number) => Math.min(max, Math.max(0, Math.round(v)));
    const sx = clamp(board.left * scale, bitmap.width);
    const sy = clamp(board.top * scale, bitmap.height);
    return {
        sx,
        sy,
        sw: clamp(board.width * scale, bitmap.width - sx),
        sh: clamp(board.height * scale, bitmap.height - sy),
    };
}
