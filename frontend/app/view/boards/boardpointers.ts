// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Board pointers: words of a Chat reply that point at shapes of the board beside it, so a click shows them. Two kinds:
// a link the reply wrote, [words](#shape-<id>), with ids from `wsh board shapes` (the arc mod hands the list over when a
// prompt carries the board), and, for the rest and for older replies, words matched by text. Only words that read as
// quoting the board are matched: a quoted phrase ("…", “…”), a bold phrase, a short table cell, and a date (23/10) that
// starts a shape's text. A phrase must be long enough to mean something and sit whole in a shape's text (or a shape's
// text whole in it); one that fits more than MAX_SHAPES shapes is too vague and points at none. Pure: the shapes come
// from Excalidraw's elements, the phrases from remarkboardphrase.ts.

// a phrase naming more shapes than this says nothing about where to look
export const MAX_SHAPES = 5;
// the shortest phrase, in characters, that may point (a date aside)
const MIN_CHARS = 8;

export interface PointerShape {
    id: string; // the element a click shows: a text's container (the box it sits in), else the text itself, or a frame
    text: string;
    norm: string;
    frame?: boolean; // a drawing (frame), named by its title: a phrase can point at it, a date cannot
}

interface ElementLike {
    id: string;
    type: string;
    isDeleted?: boolean;
    text?: string;
    originalText?: string;
    containerId?: string | null;
    name?: string | null;
}

// lowercased, NFC, whitespace (line breaks too) collapsed, the quotes and end punctuation around it dropped
export function normalize(s: string): string {
    return s
        .normalize("NFC")
        .toLowerCase()
        .replace(/[\u2012-\u2015\u2212]/g, "-")
        .replace(/\s+/g, " ")
        .trim()
        .replace(/^["'“”‘’«»([]+|["'“”‘’«»)\].,;:!?…]+$/g, "")
        .trim();
}

export function pointerShapes(elements: readonly ElementLike[]): PointerShape[] {
    const out: PointerShape[] = [];
    for (const e of elements) {
        if (e.isDeleted) {
            continue;
        }
        if (e.type === "frame") {
            const norm = normalize(e.name ?? "");
            if (norm !== "") {
                out.push({ id: e.id, text: e.name!, norm, frame: true });
            }
            continue;
        }
        if (e.type !== "text") {
            continue;
        }
        const text = e.originalText ?? e.text ?? "";
        const norm = normalize(text);
        if (norm !== "") {
            out.push({ id: e.containerId || e.id, text, norm });
        }
    }
    return out;
}

const DATE = /^\d{1,2}\/\d{1,2}$/;

// whether `needle` sits in `hay` as whole words (not inside a longer word or number)
function hasWords(hay: string, needle: string): boolean {
    let at = hay.indexOf(needle);
    while (at >= 0) {
        const before = at === 0 ? "" : hay[at - 1];
        const after = hay[at + needle.length] ?? "";
        if (!/[\p{L}\p{N}]/u.test(before) && !/[\p{L}\p{N}]/u.test(after)) {
            return true;
        }
        at = hay.indexOf(needle, at + 1);
    }
    return false;
}

const words = (s: string) => s.split(" ").length;

// The phrase quotes part of a shape: it sits there as whole words and is either three words or more, or half the
// shape's text. Two common words ("chưa thử", "harness giúp") recur in prose and in many shapes, so they point at none.
function phraseInShape(phrase: string, shape: string): boolean {
    return hasWords(shape, phrase) && (words(phrase) >= 3 || phrase.length * 2 >= shape.length);
}

// The phrase wraps a shape's whole text (a table cell that quotes a box): only when that text is most of the phrase.
// A short label inside a long heading ("quyết định" in "Mức 3 — luật quyết định trên test") is the heading's own word.
function shapeInPhrase(phrase: string, shape: string): boolean {
    return shape.length >= MIN_CHARS && shape.length >= phrase.length * SHAPE_SHARE && hasWords(phrase, shape);
}

// how much of a phrase a shape's whole text must be for the phrase to point at it (shapeInPhrase)
const SHAPE_SHARE = 0.6;

// The shapes a phrase names, by id; empty when it names none or too many.
export function matchPhrase(phrase: string, shapes: readonly PointerShape[]): string[] {
    const n = normalize(phrase);
    let hits: PointerShape[];
    if (DATE.test(n)) {
        // a date points at the shapes it starts: "23/10 m4: …", not one that only mentions it
        hits = shapes.filter((s) => !s.frame && s.norm.startsWith(n) && !/[\p{N}/]/u.test(s.norm[n.length] ?? ""));
    } else {
        if (n.length < MIN_CHARS) {
            return [];
        }
        hits = shapes.filter((s) => phraseInShape(n, s.norm) || shapeInPhrase(n, s.norm));
    }
    const ids = [...new Set(hits.map((s) => s.id))];
    return ids.length > MAX_SHAPES ? [] : ids;
}

// A text node split into plain text and the phrases that may point: a quoted phrase (the quotes stay outside it) and a
// date. Null when it holds neither.
export type TextPart = { text: string } | { phrase: string };

const QUOTED = /"([^"\n]{3,200})"|“([^”\n]{3,200})”/g;
const DATE_IN = /(?<![\p{N}/])\d{1,2}\/\d{1,2}(?![\p{N}/])/gu;

export function splitPhrases(value: string): TextPart[] | null {
    const spans: { start: number; end: number }[] = [];
    for (const m of value.matchAll(QUOTED)) {
        const start = (m.index ?? 0) + 1;
        spans.push({ start, end: start + (m[1] ?? m[2]).length });
    }
    for (const m of value.matchAll(DATE_IN)) {
        const start = m.index ?? 0;
        // a date inside a quoted phrase is part of it
        if (!spans.some((s) => start >= s.start && start < s.end)) {
            spans.push({ start, end: start + m[0].length });
        }
    }
    if (spans.length === 0) {
        return null;
    }
    spans.sort((a, b) => a.start - b.start);
    const out: TextPart[] = [];
    let at = 0;
    for (const s of spans) {
        if (s.start > at) {
            out.push({ text: value.slice(at, s.start) });
        }
        out.push({ phrase: value.slice(s.start, s.end) });
        at = s.end;
    }
    if (at < value.length) {
        out.push({ text: value.slice(at) });
    }
    return out;
}

// the link a reply writes to shapes, as the arc mod asks for it (claude/arc-mod/hooks/refs-core.ts boardShapesContext)
export const SHAPE_LINK = "#shape-";

// The shapes a `#shape-<id>,<id>` link names: each id the start of exactly one shape's id (wsh board shapes cuts them),
// one it fits none or several of left out. Empty for another link, or one whose ids all miss: the board beside is not
// the one it was written for.
export function shapeLinkIds(href: string | undefined, shapes: readonly PointerShape[]): string[] {
    if (href == null || !href.startsWith(SHAPE_LINK)) {
        return [];
    }
    const ids = new Set(shapes.map((s) => s.id));
    const out: string[] = [];
    for (const raw of decodeURIComponent(href.slice(SHAPE_LINK.length)).split(",")) {
        const prefix = raw.trim();
        if (prefix === "") {
            continue;
        }
        const hits = [...ids].filter((id) => id.startsWith(prefix));
        if (hits.length === 1 && !out.includes(hits[0])) {
            out.push(hits[0]);
        }
    }
    return out;
}

interface SceneElementLike {
    id: string;
    type: string;
    isDeleted?: boolean;
    frameId?: string | null;
}

export interface PointPlan {
    drawing: string | null; // the drawing (frame) to show, null for shapes in none
    ids: string[]; // the shapes of `ids` in it
}

// Where a pointer goes: the shapes of `ids` grouped by the drawing each is in (a frame is in itself), in the drawings'
// order. The drawing in view when it holds some, unless `step` (the same pointer pressed again), which goes on to the
// next drawing that holds some; with none in view, the drawing that holds the most. Null when no shape of `ids` is on
// the board any more.
export function pointPlan(
    elements: readonly SceneElementLike[],
    drawingOrder: readonly string[],
    ids: readonly string[],
    inView: string | null,
    step: boolean
): PointPlan | null {
    const groups = new Map<string | null, string[]>();
    for (const e of elements) {
        if (e.isDeleted || !ids.includes(e.id)) {
            continue;
        }
        const d = e.type === "frame" ? e.id : (e.frameId ?? null);
        groups.set(d, [...(groups.get(d) ?? []), e.id]);
    }
    if (groups.size === 0) {
        return null;
    }
    const order = [...drawingOrder.filter((d) => groups.has(d)), ...(groups.has(null) ? [null] : [])];
    // a frame id that is no drawing of the order (it cannot happen with drawingsOf, which lists every frame) goes last
    for (const d of groups.keys()) {
        if (!order.includes(d)) {
            order.push(d);
        }
    }
    const at = inView != null ? order.indexOf(inView) : -1;
    let pick: string | null;
    if (at >= 0) {
        pick = step ? order[(at + 1) % order.length] : order[at];
    } else {
        pick = order.reduce((best, d) => (groups.get(d)!.length > groups.get(best)!.length ? d : best), order[0]);
    }
    return { drawing: pick, ids: groups.get(pick)! };
}

interface BoxLike {
    id: string;
    isDeleted?: boolean;
    x: number;
    y: number;
    width: number;
    height: number;
}

export interface SceneRect {
    id: string;
    x: number;
    y: number;
    w: number;
    h: number;
}

// Each shape of `ids` on the board as a scene rectangle; an arrow or a line drawn leftward or upward has a negative
// size, turned around here.
export function shapeRects(elements: readonly BoxLike[], ids: readonly string[]): SceneRect[] {
    const want = new Set(ids);
    const out: SceneRect[] = [];
    for (const e of elements) {
        if (e.isDeleted || !want.has(e.id)) {
            continue;
        }
        const x = Math.min(e.x, e.x + e.width);
        const y = Math.min(e.y, e.y + e.height);
        out.push({ id: e.id, x, y, w: Math.abs(e.width), h: Math.abs(e.height) });
    }
    return out;
}

// the box around every rectangle, as a drawing's bounds are kept (boarddrawings.Drawing); null for none
export function rectsBounds(
    rects: readonly SceneRect[]
): { minX: number; minY: number; maxX: number; maxY: number } | null {
    if (rects.length === 0) {
        return null;
    }
    return {
        minX: Math.min(...rects.map((r) => r.x)),
        minY: Math.min(...rects.map((r) => r.y)),
        maxX: Math.max(...rects.map((r) => r.x + r.w)),
        maxY: Math.max(...rects.map((r) => r.y + r.h)),
    };
}
