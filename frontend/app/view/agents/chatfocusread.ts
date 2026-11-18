// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Focus read in Chat, the pure half (docs/superpowers/specs/2026-11-17-chat-focus-read-design.md): a reading line a third
// of the way down the conversation's scroller lights the block it crosses and dims the rest. This file holds the
// geometry, which block is on the line, where J/K step to and where a stopped scroll settles, and the markdown Q quotes
// a code block or a table as. The DOM side, which finds the blocks and marks them, is chatfocusreadview.ts; the toggle and
// the per-agent registry are chatfocusreadstore.ts.

/** A block's place in the scroller's content, in px from the content's top (scrollTop's coordinates). */
export interface Span {
    top: number;
    bottom: number;
}

/** Where the reading line sits, as a share of the scroller's visible height. */
export const LINE_AT = 1 / 3;
/** How far above the line a block's top lands when it is put on the line: the line then crosses its first line. A block
 *  shorter than twice this is centred on the line instead. */
export const TOP_ABOVE = 12;
/** The scroller counts as at its end within this many px of it. */
export const END_SLACK = 2;
/** A stopped scroll settles only when the block nearest the line is at most this far from its place on the line: further
 *  off, the reader is inside a tall block (a long code block) and a settle would yank them back to its top. */
export const SETTLE_MAX = 120;

/** The line's offset from the scroller's visible top, in px. */
export function lineOffset(clientHeight: number): number {
    return Math.round(clientHeight * LINE_AT);
}

/** The scroller's furthest scrollTop. */
export function maxScroll(scrollHeight: number, clientHeight: number): number {
    return Math.max(0, scrollHeight - clientHeight);
}

/** Whether the scroller shows its end. */
export function atEnd(scrollTop: number, scrollHeight: number, clientHeight: number): boolean {
    return scrollTop >= maxScroll(scrollHeight, clientHeight) - END_SLACK;
}

/** The block lit by a line at content y: the one it crosses; in a gap between two, the next one below; below the last,
 *  the last. -1 with no blocks. `spans` are in document order. */
export function litAt(spans: readonly Span[], y: number): number {
    for (let i = 0; i < spans.length; i++) {
        if (spans[i].bottom >= y) {
            return i;
        }
    }
    return spans.length - 1;
}

/** The block nearest a line at content y: the one it crosses, else the closer of the blocks either side of the gap
 *  (the one below on a tie). -1 with no blocks. */
export function nearestAt(spans: readonly Span[], y: number): number {
    const i = litAt(spans, y);
    // none, the line crosses block i, or it is below the last block
    if (i <= 0 || spans[i].top <= y || spans[i].bottom < y) {
        return i;
    }
    // the line is in the gap above block i
    const above = spans[i - 1];
    return y - above.bottom < spans[i].top - y ? i - 1 : i;
}

/** The scrollTop that puts a block on the line: its top TOP_ABOVE px above the line (a short block centred on it),
 *  within the scroller's range. At the end of the conversation the range stops it short, so the block stays below. */
export function scrollTopFor(span: Span, line: number, max: number): number {
    const target = span.top - line + Math.min((span.bottom - span.top) / 2, TOP_ABOVE);
    return Math.min(Math.max(Math.round(target), 0), max);
}

/** The block J (dir 1) or K (dir -1) steps to from the lit one, or null past either end. With none lit, J takes the
 *  first and K none. */
export function stepFrom(lit: number, dir: 1 | -1, count: number): number | null {
    if (count === 0) {
        return null;
    }
    if (lit < 0) {
        return dir > 0 ? 0 : null;
    }
    const next = Math.min(lit, count - 1) + dir;
    return next < 0 || next >= count ? null : next;
}

/** The blocks drawn at half strength beside the lit one: the one before it and the one after, those that exist. None with
 *  nothing lit. */
export function nearOf(lit: number, count: number): number[] {
    if (lit < 0 || lit >= count) {
        return [];
    }
    return [lit - 1, lit + 1].filter((i) => i >= 0 && i < count);
}

/** Where a scroll that stopped settles: the block nearest the line and the scrollTop that puts it there. Null at the
 *  scroller's end (a settle there would pull the reader off the bottom Chat follows), when that block already sits on
 *  the line, and when it is more than SETTLE_MAX off (the reader is inside a tall block). */
export function settleTo(
    spans: readonly Span[],
    scrollTop: number,
    clientHeight: number,
    scrollHeight: number
): { index: number; top: number } | null {
    if (spans.length === 0 || atEnd(scrollTop, scrollHeight, clientHeight)) {
        return null;
    }
    const line = lineOffset(clientHeight);
    const index = nearestAt(spans, scrollTop + line);
    const top = scrollTopFor(spans[index], line, maxScroll(scrollHeight, clientHeight));
    const off = Math.abs(top - scrollTop);
    return off <= 1 || off > SETTLE_MAX ? null : { index, top };
}

/** A code block as Q quotes it: a fenced block, its language after the fence. */
export function fencedText(lang: string, lines: readonly string[]): string {
    return "```" + lang.trim() + "\n" + lines.join("\n") + "\n```";
}

function cellText(cell: string): string {
    return cell.replace(/\s+/g, " ").trim().replace(/\|/g, "\\|");
}

/** A table as Q quotes it: a markdown table rebuilt from its rows of cells, the first row as the header. "" with no
 *  rows. A short row is padded to the widest. */
export function tableText(rows: readonly (readonly string[])[]): string {
    if (rows.length === 0) {
        return "";
    }
    const width = Math.max(1, ...rows.map((r) => r.length));
    const line = (r: readonly string[]) =>
        "| " + Array.from({ length: width }, (_, i) => cellText(r[i] ?? "")).join(" | ") + " |";
    const sep = "| " + Array.from({ length: width }, () => "---").join(" | ") + " |";
    return [line(rows[0]), sep, ...rows.slice(1).map(line)].join("\n");
}

// how many agents the stored list keeps: the agents that turned it on last, so ended agents' ids never pile up
export const FOCUS_READ_KEEP = 100;

/** The stored list of agents whose Chat reads one block at a time: off for every agent unless listed (a reading mode is
 *  something you turn on). The old global value ("true" / "false") turns on none: it said nothing about an agent. */
export function parseFocusReadIds(raw: string | null): string[] {
    if (raw == null) {
        return [];
    }
    try {
        const v: unknown = JSON.parse(raw);
        return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x !== "") : [];
    } catch {
        return [];
    }
}

/** The list with one agent turned on (moved to the end, the newest) or off, kept to the last FOCUS_READ_KEEP. */
export function withFocusRead(ids: readonly string[], agentId: string, on: boolean): string[] {
    const rest = ids.filter((id) => id !== agentId);
    return on ? [...rest, agentId].slice(-FOCUS_READ_KEEP) : rest;
}
