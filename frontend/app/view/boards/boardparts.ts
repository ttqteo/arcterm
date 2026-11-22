// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// A board's parts: the regions you read one at a time. A dense board fitted to the canvas shows its text at 6 or 7px;
// a part opens at a size its text reads at (partViewport), from the one the pointer is over (partAt) or the header's
// stepper. The parts are the board's frames when it has two or more
// (drawn by hand with Excalidraw's frame tool), else the clusters its shapes form on the board: shapes closer than a
// gap join one part, and the gap widens until there are at most MAX_PARTS. Arrows and lines join nothing, since they
// cross between parts. A part is named by its top-most text, the drawer's prompt asks for a title there.

export const MAX_PARTS = 16;
// hand-drawn boards keep 20 to 60px between neighbours inside a part (measured on a 78-shape thesis board)
const GAPS = [40, 60, 100, 200, 400, 800];
const LABEL_MAX = 32;
// Excalidraw's default text is 20px: at 0.7 it reads at 14px, the app's body size
export const READ_ZOOM = 0.7;
const MAX_ZOOM = 1;
const PAD = 40;

export interface PartElement {
    id: string;
    type: string;
    x: number;
    y: number;
    width: number;
    height: number;
    isDeleted?: boolean;
    containerId?: string | null;
    text?: string;
    name?: string | null;
}

export interface BoardPart {
    id: string;
    label: string;
    x: number;
    y: number;
    w: number;
    h: number;
}

export interface Viewport {
    zoom: number;
    scrollX: number;
    scrollY: number;
}

const FRAME_TYPES = new Set(["frame", "magicframe"]);
// they cross between parts, so they would join every part they touch
const LOOSE_TYPES = new Set(["arrow", "line"]);

interface Box {
    x: number;
    y: number;
    r: number;
    b: number;
    // the top-most text in this box: its own, or the label bound to it
    text: string;
}

function firstLine(text: string | undefined | null): string {
    const line = (text ?? "")
        .split("\n")
        .map((l) => l.trim())
        .find((l) => l !== "");
    if (line == null) {
        return "";
    }
    return line.length > LABEL_MAX ? `${line.slice(0, LABEL_MAX - 1).trimEnd()}…` : line;
}

// rows top to bottom, each row left to right: a part starts a new row once its top is below half the row's first part
function readingOrder<T extends { x: number; y: number; h: number }>(parts: T[]): T[] {
    const byTop = [...parts].sort((a, b) => a.y - b.y || a.x - b.x);
    const rows: T[][] = [];
    for (const p of byTop) {
        const row = rows[rows.length - 1];
        if (row != null && p.y < row[0].y + row[0].h / 2) {
            row.push(p);
        } else {
            rows.push([p]);
        }
    }
    return rows.flatMap((row) => row.sort((a, b) => a.x - b.x));
}

function clusters(boxes: Box[], gap: number): Box[][] {
    const parent = boxes.map((_, i) => i);
    const find = (i: number): number => {
        while (parent[i] !== i) {
            parent[i] = parent[parent[i]];
            i = parent[i];
        }
        return i;
    };
    for (let i = 0; i < boxes.length; i++) {
        for (let j = i + 1; j < boxes.length; j++) {
            const a = boxes[i];
            const b = boxes[j];
            if (a.x - gap <= b.r && b.x - gap <= a.r && a.y - gap <= b.b && b.y - gap <= a.b) {
                parent[find(i)] = find(j);
            }
        }
    }
    const groups = new Map<number, Box[]>();
    boxes.forEach((box, i) => {
        const root = find(i);
        groups.set(root, [...(groups.get(root) ?? []), box]);
    });
    return [...groups.values()];
}

function clusterPart(group: Box[], index: number): BoardPart {
    const x = Math.min(...group.map((b) => b.x));
    const y = Math.min(...group.map((b) => b.y));
    const r = Math.max(...group.map((b) => b.r));
    const b = Math.max(...group.map((bx) => bx.b));
    const titled = group.filter((bx) => bx.text !== "").sort((p, q) => p.y - q.y || p.x - q.x);
    return { id: `part-${index}`, label: titled[0]?.text ?? "", x, y, w: r - x, h: b - y };
}

export function boardParts(elements: readonly PartElement[]): BoardPart[] {
    const live = elements.filter((el) => !el.isDeleted);
    const frames = live.filter((el) => FRAME_TYPES.has(el.type));
    if (frames.length >= 2) {
        const parts = frames.map((f) => ({
            id: f.id,
            label: firstLine(f.name),
            x: f.x,
            y: f.y,
            w: f.width,
            h: f.height,
        }));
        return named(readingOrder(parts));
    }
    const labels = new Map<string, string>();
    for (const el of live) {
        if (el.type === "text" && el.containerId) {
            labels.set(el.containerId, firstLine(el.text));
        }
    }
    const boxes: Box[] = live
        .filter((el) => !LOOSE_TYPES.has(el.type) && !FRAME_TYPES.has(el.type))
        .filter((el) => !(el.type === "text" && el.containerId))
        .map((el) => {
            // a line or arrow can have a negative width; a shape never should, but a box is a box
            const x = Math.min(el.x, el.x + el.width);
            const y = Math.min(el.y, el.y + el.height);
            return {
                x,
                y,
                r: x + Math.abs(el.width),
                b: y + Math.abs(el.height),
                text: el.type === "text" ? firstLine(el.text) : (labels.get(el.id) ?? ""),
            };
        });
    if (boxes.length < 2) {
        return [];
    }
    for (const gap of GAPS) {
        const groups = clusters(boxes, gap);
        if (groups.length <= MAX_PARTS) {
            if (groups.length < 2) {
                return [];
            }
            return named(readingOrder(groups.map((g, i) => clusterPart(g, i))));
        }
    }
    return [];
}

// a part with no text is named by its place in the reading order
function named(parts: BoardPart[]): BoardPart[] {
    return parts.map((p, i) => ({ ...p, label: p.label || `Part ${i + 1}` }));
}

// The view that reads one part: as large as fits the whole part, at most 1:1 and never below READ_ZOOM, so its text
// always reads. A part larger than the view at that zoom shows its top-left first, to scroll on from; one that fits
// is centred. Excalidraw maps a scene point to the view as (point + scroll) * zoom.
export function partViewport(part: BoardPart, viewW: number, viewH: number): Viewport {
    const fitW = (viewW - 2 * PAD) / Math.max(1, part.w);
    const fitH = (viewH - 2 * PAD) / Math.max(1, part.h);
    const zoom = Math.min(MAX_ZOOM, Math.max(READ_ZOOM, Math.min(fitW, fitH)));
    const wide = part.w * zoom > viewW - 2 * PAD;
    const tall = part.h * zoom > viewH - 2 * PAD;
    const scrollX = wide ? PAD / zoom - part.x : viewW / (2 * zoom) - (part.x + part.w / 2);
    const scrollY = tall ? PAD / zoom - part.y : viewH / (2 * zoom) - (part.y + part.h / 2);
    return { zoom, scrollX, scrollY };
}

// where a part's top-left corner shows in the view, for its label
export function partOnView(
    part: BoardPart,
    vp: Viewport
): { left: number; top: number; width: number; height: number } {
    return {
        left: (part.x + vp.scrollX) * vp.zoom,
        top: (part.y + vp.scrollY) * vp.zoom,
        width: part.w * vp.zoom,
        height: part.h * vp.zoom,
    };
}

// Reading by part is for a board too big to read whole: one whose parts all fit the view at READ_ZOOM needs none, so
// a small board shows no stepper and no Read label
export function needsParts(parts: readonly BoardPart[], viewW: number, viewH: number): boolean {
    if (parts.length < 2) {
        return false;
    }
    const x = Math.min(...parts.map((p) => p.x));
    const y = Math.min(...parts.map((p) => p.y));
    const w = Math.max(...parts.map((p) => p.x + p.w)) - x;
    const h = Math.max(...parts.map((p) => p.y + p.h)) - y;
    return w * READ_ZOOM > viewW - 2 * PAD || h * READ_ZOOM > viewH - 2 * PAD;
}

// the part under a point of the board (scene coordinates): the smallest one holding it, since frames can nest; null
// over empty board
export function partAt(parts: readonly BoardPart[], x: number, y: number): number | null {
    let best: number | null = null;
    parts.forEach((p, i) => {
        if (x < p.x || x > p.x + p.w || y < p.y || y > p.y + p.h) {
            return;
        }
        if (best == null || p.w * p.h < parts[best].w * parts[best].h) {
            best = i;
        }
    });
    return best;
}

// a point of the view (px from the canvas's top-left) on the board
export function viewToScene(vp: Viewport, left: number, top: number): { x: number; y: number } {
    return { x: left / vp.zoom - vp.scrollX, y: top / vp.zoom - vp.scrollY };
}

// the next part from `index` (null: the whole board) by `step`, wrapping; the first or last from the whole board
export function stepPart(count: number, index: number | null, step: 1 | -1): number | null {
    if (count === 0) {
        return null;
    }
    if (index == null) {
        return step === 1 ? 0 : count - 1;
    }
    return (index + step + count) % count;
}

// a viewport eased toward another: zoom geometrically, so it feels even in and out, and the scroll so the view's
// centre moves in a straight line
export function lerpViewport(from: Viewport, to: Viewport, t: number, viewW: number, viewH: number): Viewport {
    const zoom = from.zoom * Math.pow(to.zoom / from.zoom, t);
    const cx = (vp: Viewport) => viewW / (2 * vp.zoom) - vp.scrollX;
    const cy = (vp: Viewport) => viewH / (2 * vp.zoom) - vp.scrollY;
    const x = cx(from) + (cx(to) - cx(from)) * t;
    const y = cy(from) + (cy(to) - cy(from)) * t;
    return { zoom, scrollX: viewW / (2 * zoom) - x, scrollY: viewH / (2 * zoom) - y };
}
