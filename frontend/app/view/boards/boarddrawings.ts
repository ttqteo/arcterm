// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// A board's drawings: each is an Excalidraw frame, numbered in its customData. Reads which drawings there are,
// which one the view shows, which one a selection names, what is inside one and the view that fits one whole.
// Pure: no React, no Excalidraw runtime.

import type { ExcalidrawElement, ExcalidrawFrameElement } from "@excalidraw/excalidraw/element/types";
import type { Viewport } from "./boardparts";

const DRAWING_KEY = "arcDrawing";
// a drawing fits whole with a tenth of the view left around it
const FIT = 0.9;

export interface Drawing {
    id: string;
    n: number;
    title: string;
    bounds: { minX: number; minY: number; maxX: number; maxY: number };
}

// excalidraw's appState terms: the visible scene runs from -scrollX to -scrollX + width / zoom
export interface ViewRect {
    scrollX: number;
    scrollY: number;
    zoom: number;
    width: number;
    height: number;
}

// what the open canvas of a board publishes for the drawings row: the drawings in order, the one in view, and the ones
// that landed while the view was on an earlier drawing and are not in view yet
export interface BoardDrawings {
    drawings: { id: string; n: number; title: string }[];
    inView: string | null;
    fresh: string[];
}

export function isFrame(el: ExcalidrawElement): el is ExcalidrawFrameElement {
    return el.type === "frame";
}

// null for a frame made by hand in Edit
export function drawingNumber(el: ExcalidrawElement): number | null {
    const n = el.customData?.[DRAWING_KEY];
    return typeof n === "number" ? n : null;
}

export function drawingData(n: number): Record<string, unknown> {
    return { [DRAWING_KEY]: n };
}

function liveFrames(elements: readonly ExcalidrawElement[]): ExcalidrawFrameElement[] {
    return elements.filter((el): el is ExcalidrawFrameElement => isFrame(el) && !el.isDeleted);
}

function toDrawing(f: ExcalidrawFrameElement, n: number): Drawing {
    return {
        id: f.id,
        n,
        title: f.name ?? "",
        bounds: { minX: f.x, minY: f.y, maxX: f.x + f.width, maxY: f.y + f.height },
    };
}

// numbered drawings in order, then hand frames in element order, numbered on from the highest
export function drawingsOf(elements: readonly ExcalidrawElement[]): Drawing[] {
    const frames = liveFrames(elements);
    const numbered = frames
        .filter((f) => drawingNumber(f) != null)
        .map((f) => toDrawing(f, drawingNumber(f)))
        .sort((a, b) => a.n - b.n);
    const max = numbered.length > 0 ? numbered[numbered.length - 1].n : 0;
    const hand = frames.filter((f) => drawingNumber(f) == null).map((f, i) => toDrawing(f, max + i + 1));
    return [...numbered, ...hand];
}

function visibleArea(d: Drawing, view: ViewRect): number {
    const left = -view.scrollX;
    const top = -view.scrollY;
    const w = Math.min(d.bounds.maxX, left + view.width / view.zoom) - Math.max(d.bounds.minX, left);
    const h = Math.min(d.bounds.maxY, top + view.height / view.zoom) - Math.max(d.bounds.minY, top);
    return w > 0 && h > 0 ? w * h : 0;
}

// the drawing covering the most of the view; drawings run oldest to newest, so a tie goes to the newer
export function drawingInView(drawings: readonly Drawing[], view: ViewRect): string | null {
    let best: string | null = null;
    let bestArea = 0;
    for (const d of drawings) {
        const area = visibleArea(d, view);
        if (area > 0 && area >= bestArea) {
            best = d.id;
            bestArea = area;
        }
    }
    return best;
}

// the drawing's live children, its frame left out: what parts and a reading view work from
export function drawingShapes(elements: readonly ExcalidrawElement[], drawingId: string): ExcalidrawElement[] {
    return elements.filter((el) => !el.isDeleted && !isFrame(el) && el.frameId === drawingId);
}

// → and ← between drawings: the drawing after (step 1) or before (-1) the one in view, or null at either end, with no
// drawings, or with none in view and nothing to step to. With none in view, → goes to the first and ← to the last.
export function stepDrawing(drawings: readonly { id: string }[], inView: string | null, step: 1 | -1): string | null {
    if (drawings.length === 0) {
        return null;
    }
    const at = inView == null ? -1 : drawings.findIndex((d) => d.id === inView);
    if (at < 0) {
        return step === 1 ? drawings[0].id : drawings[drawings.length - 1].id;
    }
    return drawings[at + step]?.id ?? null;
}

// The view follows the newest drawing: true with no drawings, or while the newest is the one in view
export function isFollowing(drawings: readonly Drawing[], inView: string | null): boolean {
    return drawings.length === 0 || inView === drawings[drawings.length - 1].id;
}

// The row the canvas publishes next. `fresh` loses the drawing now in view and the ones that are gone. Returns prev
// itself when nothing the row shows changed, so the canvas sets the atom only on a change.
export function rowState(
    prev: BoardDrawings | null,
    drawings: readonly Drawing[],
    inView: string | null
): BoardDrawings {
    const ids = new Set(drawings.map((d) => d.id));
    const fresh = (prev?.fresh ?? []).filter((id) => id !== inView && ids.has(id));
    if (
        prev != null &&
        prev.inView === inView &&
        prev.fresh.length === fresh.length &&
        prev.fresh.every((id, i) => id === fresh[i]) &&
        prev.drawings.length === drawings.length &&
        prev.drawings.every((d, i) => d.id === drawings[i].id && d.n === drawings[i].n && d.title === drawings[i].title)
    ) {
        return prev;
    }
    return { drawings: drawings.map(({ id, n, title }) => ({ id, n, title })), inView, fresh };
}

// What a landed answer does to the view. A drawing not there before is new: fit it while following, else mark it fresh
// (the newest of several, though one answer adds one). Otherwise an edit of the drawing in view is fitted again, as it
// may have grown; an edit of one out of view, or no edit, leaves the view alone.
export function afterLanding(
    beforeIds: readonly string[],
    following: boolean,
    inView: string | null,
    after: readonly Drawing[],
    editedId: string | undefined
): { fit: string | null; fresh: string | null } {
    const had = new Set(beforeIds);
    const added = after.filter((d) => !had.has(d.id));
    if (added.length > 0) {
        const id = added[added.length - 1].id;
        return following ? { fit: id, fresh: null } : { fit: null, fresh: id };
    }
    if (editedId != null && editedId === inView && after.some((d) => d.id === editedId)) {
        return { fit: editedId, fresh: null };
    }
    return { fit: null, fresh: null };
}

// The view that shows one drawing whole: centred, as large as fits the frame in 90% of the view, at most 1:1. Unlike a
// part's view there is no floor on the zoom: the goal is the whole drawing, narrow cell included. Excalidraw maps a
// scene point to the view as (point + scroll) * zoom.
export function drawingViewport(d: Drawing, viewW: number, viewH: number): Viewport {
    const w = d.bounds.maxX - d.bounds.minX;
    const h = d.bounds.maxY - d.bounds.minY;
    const zoom = Math.min(1, FIT * Math.min(viewW / w, viewH / h));
    return {
        zoom,
        scrollX: viewW / (2 * zoom) - (d.bounds.minX + w / 2),
        scrollY: viewH / (2 * zoom) - (d.bounds.minY + h / 2),
    };
}
