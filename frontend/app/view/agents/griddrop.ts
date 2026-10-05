// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The pure half of dropping an agent on the grid: which drags count, which zone of a cell a point is in, which
// zones a grid of N cells offers, and what to say about the zone. The overlay (griddropoverlay.tsx) only draws it.

import { MAX_CELLS, type DropZone } from "./agentgrid";

// Carried by a drag that starts on an agent row or a cell bar; its data is the agent's id. A drag without it
// (an OS file, say) is none of the grid's business.
export const AGENT_DRAG_MIME = "application/x-arc-agent";

// The outer quarter of each side is an edge zone; what is left in the middle is the centre.
export const EDGE_FRACTION = 0.25;

export interface Rect {
    left: number;
    top: number;
    width: number;
    height: number;
}

export function isAgentDrag(types: ArrayLike<string> | null | undefined): boolean {
    return types != null && Array.from(types).includes(AGENT_DRAG_MIME);
}

const clamp01 = (n: number) => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0.5);

// The zone of `rect` that (x, y) is in. Distances are fractions of the cell's own width and height, so a wide
// cell and a tall one both keep a quarter. In a corner the nearer edge wins; on a tie the horizontal edge does.
export function zoneFromPoint(rect: Rect, x: number, y: number): DropZone {
    if (!(rect.width > 0) || !(rect.height > 0)) {
        return "center";
    }
    const u = clamp01((x - rect.left) / rect.width);
    const v = clamp01((y - rect.top) / rect.height);
    const toLeft = u;
    const toRight = 1 - u;
    const toTop = v;
    const toBottom = 1 - v;
    const nearest = Math.min(toLeft, toRight, toTop, toBottom);
    if (nearest >= EDGE_FRACTION) {
        return "center";
    }
    if (nearest === toLeft) {
        return "left";
    }
    if (nearest === toRight) {
        return "right";
    }
    if (nearest === toTop) {
        return "top";
    }
    return "bottom";
}

const ALL_ZONES: readonly DropZone[] = ["center", "left", "right", "top", "bottom"];

// A full grid has no room to insert, so only the swap remains.
export function allowedZones(cellCount: number): readonly DropZone[] {
    return cellCount >= MAX_CELLS ? ["center"] : ALL_ZONES;
}

// A drop on the cell `targetId`, resolved against `ids`: the grid as it is when the drop lands (gridstore's
// currentGrid), not as it was when the overlay last rendered, so the index handed to dropAgentOnGrid is always a
// position in the list that call reads. Null when the target has left the grid since. A zone the grid no longer
// offers (it filled up mid-drag) becomes the swap.
export function resolveDrop(
    ids: readonly string[],
    targetId: string,
    zone: DropZone
): { index: number; zone: DropZone } | null {
    const index = ids.indexOf(targetId);
    if (index < 0) {
        return null;
    }
    return { index, zone: allowedZones(ids.length).includes(zone) ? zone : "center" };
}

export interface ZoneBox {
    left: number;
    top: number;
    width: number;
    height: number;
}

// The highlight for a zone, as percentages of the cell: an edge previews the half the agent will take.
const ZONE_BOX: Record<DropZone, ZoneBox> = {
    center: { left: 25, top: 25, width: 50, height: 50 },
    left: { left: 0, top: 0, width: 50, height: 100 },
    right: { left: 50, top: 0, width: 50, height: 100 },
    top: { left: 0, top: 0, width: 100, height: 50 },
    bottom: { left: 0, top: 50, width: 100, height: 50 },
};

export function zoneBox(zone: DropZone): ZoneBox {
    return ZONE_BOX[zone];
}

// `moving`: the dragged agent already has a cell, so the centre swaps instead of replacing.
export function zoneLabel(zone: DropZone, moving: boolean): string {
    if (zone === "center") {
        return moving ? "Swap" : "Replace";
    }
    return zone === "left" || zone === "top" ? "Place before" : "Place after";
}
