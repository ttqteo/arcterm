// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The pure half of dropping an agent on the grid: which drags count, which zone of a cell a point is in, which
// zones a cell offers, and what to say about the zone. The overlay (griddropoverlay.tsx) only draws it.

import { removeCell, splitZones, type DropZone, type GridState } from "./agentgrid";
import { mentionToken } from "./agentrowmodel";
import type { AgentVM } from "./agentsviewmodel";

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

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

// The zone of `rect` that (x, y) is in. Distances are fractions of the cell's own width and height, so a wide
// cell and a tall one both keep a quarter. In a corner the nearer edge wins; on a tie the horizontal edge does.
export function zoneFromPoint(rect: Rect, x: number, y: number): DropZone {
    if (!(rect.width > 0) || !(rect.height > 0) || Number.isNaN(x) || Number.isNaN(y)) {
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

// The zones a drop of `dragId` on the cell `targetId` offers: the centre always, and the edges along which the
// target can be split (agentgrid.ts splitZones), judged in the grid as it is once the dragged cell, when it is one,
// has left it. So the overlay shows only what the drop does: a cell side by side with another has no left or right
// edge, and a full grid offers only the swap.
export function allowedZones(state: GridState, targetId: string, dragId: string): DropZone[] {
    const grid = state.ids.includes(dragId) ? removeCell(state, dragId) : state;
    return ["center", ...splitZones(grid, grid.ids.indexOf(targetId))];
}

// A drop on the cell `targetId`, resolved against `state`: the grid as it is when the drop lands (gridstore's
// currentGrid), not as it was when the overlay last rendered, so the index handed to dropAgentOnGrid is always a
// position in the list that call reads. Null when the target has left the grid since. A zone the grid no longer
// offers (it filled up mid-drag) becomes the swap.
export function resolveDrop(
    state: GridState,
    targetId: string,
    dragId: string,
    zone: DropZone
): { index: number; zone: DropZone } | null {
    const index = state.ids.indexOf(targetId);
    if (index < 0) {
        return null;
    }
    return { index, zone: allowedZones(state, targetId, dragId).includes(zone) ? zone : "center" };
}

export type ZoneBox = Rect;

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

// an edge says where the agent lands: the half of the cell it takes
const ZONE_LABEL: Record<Exclude<DropZone, "center">, string> = {
    left: "Place left",
    right: "Place right",
    top: "Place above",
    bottom: "Place below",
};

// `moving`: the dragged agent already has a cell, so the centre swaps instead of replacing.
export function zoneLabel(zone: DropZone, moving: boolean): string {
    if (zone === "center") {
        return moving ? "Swap" : "Replace";
    }
    return ZONE_LABEL[zone];
}

// A drop with Alt (Option on a Mac) held types the dragged agent's @mention at the cell's prompt instead of placing it,
// and the Claude mod sends what follows on to the dragged agent (mention-core.ts). The terminal it types into, or null
// when the cell takes no mention: only claude's prompt routes one, and a sleeping agent has no prompt.
export function mentionTarget(cell: Pick<AgentVM, "agent" | "blockId" | "sleeping">): string | null {
    return cell.agent === "claude" && cell.sleeping == null && cell.blockId ? cell.blockId : null;
}

// the space lets the message be typed straight after it
export function mentionDropText(draggedId: string): string {
    return mentionToken(draggedId) + " ";
}
