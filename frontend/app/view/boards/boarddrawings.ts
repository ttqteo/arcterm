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

// what the open canvas of a board publishes for the drawings row and the ask: the drawings in order, the one in view,
// the ones that landed while the view was on an earlier drawing and are not in view yet, and the drawing every selected
// shape belongs to (null when none is selected or they span drawings)
export interface BoardDrawings {
    drawings: { id: string; n: number; title: string }[];
    inView: string | null;
    fresh: string[];
    selected: string | null;
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

// the one live frame every selected shape belongs to (a selected frame belongs to itself), else the one in view
export function askedDrawing(
    elements: readonly ExcalidrawElement[],
    selectedIds: readonly string[],
    inView: string | null
): string | null {
    const byId = new Map(elements.filter((el) => !el.isDeleted).map((el) => [el.id, el]));
    const frames = new Set<string | null>();
    for (const id of selectedIds) {
        const el = byId.get(id);
        if (el != null) {
            frames.add(isFrame(el) ? el.id : el.frameId);
        }
    }
    if (frames.size !== 1) {
        return inView;
    }
    const [frameId] = frames;
    const frame = byId.get(frameId ?? "");
    return frame != null && isFrame(frame) ? frame.id : inView;
}

// the drawing's live children, its frame left out: what parts and a reading view work from
export function drawingShapes(elements: readonly ExcalidrawElement[], drawingId: string): ExcalidrawElement[] {
    return elements.filter((el) => !el.isDeleted && !isFrame(el) && el.frameId === drawingId);
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
