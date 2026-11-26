// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Tidy: one drawing laid out again as a layered graph (dagre), for a drawing whose shapes the drawer placed by hand and
// whose arrows cross or bunch. The shapes are the graph's nodes (a group, such as a chart, is one node), the arrows
// bound at both ends are its edges, and dagre gives each node a place and each edge a route around the others. The
// drawing keeps its top-left corner and its flow (left to right or top down, as most of its arrows ran); a shape with
// no arrow and loose text or lines move with the node they were nearest. The frame fits the new layout, and drawings to
// its right move over by what it grew. Pure: no React, no Excalidraw runtime.

import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { layout } from "dagre-d3-es/src/dagre/index.js";
import { Graph } from "dagre-d3-es/src/graphlib/index.js";
import { drawingShapes, isFrame } from "./boarddrawings";
import { bump, elementBounds, padded, routeArrow, unionBounds, type Bounds } from "./boardmodel";

const NODE_SEP = 40; // between nodes in one rank
const EDGE_SEP = 20; // between edges that run side by side
// between ranks; dagre halves it when any edge has a label, to give the label a rank of its own
const RANK_SEP = 100;

type Point = [number, number];

function centerOf(b: Bounds): Point {
    return [(b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2];
}

function isLinear(el: ExcalidrawElement): boolean {
    return el.type === "arrow" || el.type === "line" || el.type === "freedraw";
}

function isElbowed(el: ExcalidrawElement): boolean {
    return "elbowed" in el && el.elbowed === true;
}

function containerOf(el: ExcalidrawElement): string | null {
    return el.type === "text" ? (el.containerId ?? null) : null;
}

// the node a shape belongs to: its outermost group, or itself
function unitKey(el: ExcalidrawElement): string {
    return el.groupIds.length > 0 ? `group:${el.groupIds[el.groupIds.length - 1]}` : el.id;
}

interface Unit {
    key: string;
    ids: string[];
    bounds: Bounds;
}

interface Edge {
    arrowId: string;
    from: string;
    to: string;
    label: { width: number; height: number } | null;
}

/** Pure: the drawing's nodes. A grouped shape of any kind joins its group's node; an ungrouped shape is a node of its
 *  own unless it is an arrow, a line, or text (bound text moves with its container, loose text with what it is near). */
export function layoutUnits(shapes: readonly ExcalidrawElement[]): Map<string, Unit> {
    const byKey = new Map<string, ExcalidrawElement[]>();
    for (const el of shapes) {
        if (containerOf(el) != null) {
            continue;
        }
        if (el.groupIds.length === 0 && (isLinear(el) || el.type === "text")) {
            continue;
        }
        const key = unitKey(el);
        byKey.set(key, [...(byKey.get(key) ?? []), el]);
    }
    const units = new Map<string, Unit>();
    for (const [key, els] of byKey) {
        units.set(key, { key, ids: els.map((el) => el.id), bounds: unionBounds(els) });
    }
    return units;
}

/** Pure: left to right ("LR") when the arrows ran more across than down between the shapes they join, else top down
 *  ("TB"); with no arrow, the drawing's own shape decides. */
export function flowOf(units: ReadonlyMap<string, Unit>, edges: readonly Edge[], content: Bounds): "LR" | "TB" {
    let across = 0;
    let down = 0;
    for (const e of edges) {
        const [ax, ay] = centerOf(units.get(e.from).bounds);
        const [bx, by] = centerOf(units.get(e.to).bounds);
        across += Math.abs(bx - ax);
        down += Math.abs(by - ay);
    }
    if (across === 0 && down === 0) {
        return content.maxX - content.minX >= content.maxY - content.minY ? "LR" : "TB";
    }
    return across >= down ? "LR" : "TB";
}

function nearestUnit(units: ReadonlyMap<string, Unit>, at: Point): string | null {
    let best: string | null = null;
    let bestD = Infinity;
    for (const u of units.values()) {
        const [cx, cy] = centerOf(u.bounds);
        const d = Math.hypot(cx - at[0], cy - at[1]);
        if (d < bestD) {
            best = u.key;
            bestD = d;
        }
    }
    return best;
}

function moved(el: ExcalidrawElement, dx: number, dy: number, now: number): ExcalidrawElement {
    return dx === 0 && dy === 0 ? el : bump(el, { x: el.x + dx, y: el.y + dy }, now);
}

/** Pure: the board's elements with one drawing tidied, or null when there is nothing to lay out (no such drawing, or
 *  fewer than two nodes). The caller lands the result as one undo step. */
export function tidyDrawing(
    elements: readonly ExcalidrawElement[],
    drawingId: string,
    now: number
): ExcalidrawElement[] | null {
    const frame = elements.find((el) => el.id === drawingId && isFrame(el) && !el.isDeleted);
    if (frame == null) {
        return null;
    }
    const shapes = drawingShapes(elements, drawingId);
    const units = layoutUnits(shapes);
    if (units.size < 2) {
        return null;
    }
    const unitOfId = new Map<string, string>();
    for (const u of units.values()) {
        u.ids.forEach((id) => unitOfId.set(id, u.key));
    }
    const labelOf = new Map<string, ExcalidrawElement>();
    for (const el of shapes) {
        const c = containerOf(el);
        if (c != null) {
            labelOf.set(c, el);
        }
    }

    // the edges: ungrouped, unbent-by-Excalidraw arrows bound at both ends to two different nodes
    const edges: Edge[] = [];
    for (const el of shapes) {
        if (el.type !== "arrow" || el.groupIds.length > 0 || isElbowed(el)) {
            continue;
        }
        const from = unitOfId.get(el.startBinding?.elementId ?? "");
        const to = unitOfId.get(el.endBinding?.elementId ?? "");
        if (from == null || to == null || from === to) {
            continue;
        }
        const label = labelOf.get(el.id);
        edges.push({ arrowId: el.id, from, to, label: label ? { width: label.width, height: label.height } : null });
    }

    // where the nodes were: arrows and loose text follow them, so they do not set the corner the layout keeps
    const content = unionBounds(shapes.filter((el) => unitOfId.has(el.id)));
    const rankdir = flowOf(units, edges, content);
    const g = new Graph({ multigraph: true });
    g.setGraph({ rankdir, nodesep: NODE_SEP, edgesep: EDGE_SEP, ranksep: RANK_SEP });
    g.setDefaultEdgeLabel(() => ({}));
    // dagre orders a rank by insertion first: across the flow, as the drawing had them, so the tidy reads like it
    const across = rankdir === "LR" ? 1 : 0;
    const ordered = [...units.values()].sort((a, b) => centerOf(a.bounds)[across] - centerOf(b.bounds)[across]);
    for (const u of ordered) {
        g.setNode(u.key, { width: u.bounds.maxX - u.bounds.minX, height: u.bounds.maxY - u.bounds.minY });
    }
    for (const e of edges) {
        const label = e.label ? { width: e.label.width, height: e.label.height, labelpos: "c" } : {};
        g.setEdge(e.from, e.to, label, e.arrowId);
    }
    layout(g, {});

    // dagre's layout starts at 0,0; the drawing keeps its top-left corner
    let minX = Infinity;
    let minY = Infinity;
    for (const u of units.values()) {
        const n = g.node(u.key);
        minX = Math.min(minX, n.x - n.width / 2);
        minY = Math.min(minY, n.y - n.height / 2);
    }
    const offX = content.minX - minX;
    const offY = content.minY - minY;
    const delta = new Map<string, Point>();
    for (const u of units.values()) {
        const n = g.node(u.key);
        delta.set(u.key, [n.x - n.width / 2 + offX - u.bounds.minX, n.y - n.height / 2 + offY - u.bounds.minY]);
    }

    // every element of the drawing takes a delta: a node's shapes its node's, an arrow with one end bound that end's,
    // anything else loose the nearest node's, and bound text its container's
    const routed = new Set(edges.map((e) => e.arrowId));
    const shift = new Map<string, Point>();
    for (const el of shapes) {
        if (containerOf(el) != null || routed.has(el.id)) {
            continue;
        }
        let key = unitOfId.get(el.id);
        if (key == null && el.type === "arrow") {
            key = unitOfId.get(el.startBinding?.elementId ?? "") ?? unitOfId.get(el.endBinding?.elementId ?? "");
        }
        key ??= nearestUnit(units, centerOf(elementBounds(el)));
        shift.set(el.id, delta.get(key) ?? [0, 0]);
    }
    for (const el of shapes) {
        const c = containerOf(el);
        if (c != null && !routed.has(c)) {
            shift.set(el.id, shift.get(c) ?? [0, 0]);
        }
    }

    const els = elements.map((el) => {
        const d = shift.get(el.id);
        return d == null ? el : moved(el, d[0], d[1], now);
    });

    // an edge takes dagre's route between its moved nodes, then routeArrow lays its ends on their outlines and its label
    // on its middle
    const index = new Map(els.map((el, i) => [el.id, i]));
    for (const e of edges) {
        const i = index.get(e.arrowId);
        const route = (g.edge(e.from, e.to, e.arrowId)?.points ?? []) as { x: number; y: number }[];
        if (route.length < 2) {
            continue;
        }
        const abs: Point[] = route.map((p) => [p.x + offX, p.y + offY]);
        const [sx, sy] = abs[0];
        els[i] = bump(els[i], { x: sx, y: sy, points: abs.map(([x, y]) => [x - sx, y - sy]) }, now);
        routeArrow(els, i, now);
    }

    // the frame fits the new layout; drawings that began right of it move over by what it grew
    const fi = index.get(drawingId);
    const oldRight = frame.x + frame.width;
    const fit = unionBounds(els.filter((el) => el.frameId === drawingId && !el.isDeleted));
    els[fi] = bump(els[fi], padded(fit), now);
    const grew = els[fi].x + els[fi].width - oldRight;
    if (grew > 0) {
        const rightFrames = new Set(
            els
                .filter((el) => isFrame(el) && !el.isDeleted && el.id !== drawingId && el.x >= oldRight)
                .map((el) => el.id)
        );
        els.forEach((el, i) => {
            if (el.isDeleted || el.id === drawingId || el.frameId === drawingId) {
                return;
            }
            const right =
                el.frameId != null
                    ? rightFrames.has(el.frameId)
                    : rightFrames.has(el.id) || elementBounds(el).minX >= oldRight;
            if (right) {
                els[i] = moved(el, grew, 0, now);
            }
        });
    }
    // Excalidraw's store tells a changed element by its versionNonce, not its version: without a new one the tidy is not
    // an undo step at all, and one Ctrl+Z takes back whatever came before it
    return els.map((el, i) =>
        el === elements[i] ? el : ({ ...el, versionNonce: Math.floor(Math.random() * 2 ** 31) } as ExcalidrawElement)
    );
}

function lerp(a: number, b: number, t: number): number {
    return a + (b - a) * t;
}

/** Pure: a frame of the move from `before` to `after` (tidyDrawing's), t from 0 to 1, for the canvas to draw while the
 *  shapes travel. Every element that moved slides from where it was; an arrow, whose route changes shape, runs straight
 *  from its sliding start to its sliding end until the last frame lays its route. Same versions as `before`, so a frame
 *  is never a change of its own to save or undo. */
export function tidyFrame(
    before: readonly ExcalidrawElement[],
    after: readonly ExcalidrawElement[],
    t: number
): ExcalidrawElement[] {
    const was = new Map(before.map((el) => [el.id, el]));
    return after.map((el) => {
        const from = was.get(el.id);
        if (from == null || from === el) {
            return from ?? el;
        }
        const props: Record<string, unknown> = {
            x: lerp(from.x, el.x, t),
            y: lerp(from.y, el.y, t),
            width: lerp(from.width, el.width, t),
            height: lerp(from.height, el.height, t),
        };
        if ("points" in el && "points" in from && from.points.length > 0 && el.points.length > 0) {
            const a0 = from.points[0];
            const a1 = from.points[from.points.length - 1];
            const b0 = el.points[0];
            const b1 = el.points[el.points.length - 1];
            const sx = lerp(from.x + a0[0], el.x + b0[0], t);
            const sy = lerp(from.y + a0[1], el.y + b0[1], t);
            const ex = lerp(from.x + a1[0], el.x + b1[0], t);
            const ey = lerp(from.y + a1[1], el.y + b1[1], t);
            props.x = sx;
            props.y = sy;
            props.points = [
                [0, 0],
                [ex - sx, ey - sy],
            ];
            props.width = Math.abs(ex - sx);
            props.height = Math.abs(ey - sy);
        }
        return { ...from, ...props } as ExcalidrawElement;
    });
}
