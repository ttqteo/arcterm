// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The Cockpit office's arrangement (office floors spec, "The arrangement" and "Arranging rooms"): which floor and
// slot each project's room takes, kept per viewer, and the moves the person makes. Pure: no React, no storage.

import type { Dir } from "./officeboss";

export const SLOTS = 4; // a floor is 2 x 2: slot = row * 2 + column
export interface RoomPlace {
    floor: number;
    slot: number;
}
export interface OfficeLayout {
    v: 1;
    rooms: Record<string, RoomPlace>;
}
export type Placements = Record<string, RoomPlace>;
export const EMPTY_LAYOUT: OfficeLayout = { v: 1, rooms: {} };

const isPlace = (p: unknown): p is RoomPlace =>
    p != null &&
    typeof p === "object" &&
    Number.isInteger((p as RoomPlace).floor) &&
    (p as RoomPlace).floor >= 0 &&
    Number.isInteger((p as RoomPlace).slot) &&
    (p as RoomPlace).slot >= 0 &&
    (p as RoomPlace).slot < SLOTS;

/** Pure: a stored arrangement, or the empty one for anything unreadable. */
export function parseLayout(raw: unknown): OfficeLayout {
    if (raw == null || typeof raw !== "object" || (raw as OfficeLayout).v !== 1) {
        return EMPTY_LAYOUT;
    }
    const rooms: Record<string, RoomPlace> = {};
    const src = (raw as OfficeLayout).rooms;
    if (src != null && typeof src === "object") {
        for (const [k, p] of Object.entries(src)) {
            if (isPlace(p)) {
                rooms[k] = { floor: p.floor, slot: p.slot };
            }
        }
    }
    return { v: 1, rooms };
}

const keyOf = (p: RoomPlace) => `${p.floor}:${p.slot}`;

function firstEmpty(taken: Set<string>, from = 0): RoomPlace {
    for (let floor = from; ; floor++) {
        for (let slot = 0; slot < SLOTS; slot++) {
            if (!taken.has(`${floor}:${slot}`)) {
                return { floor, slot };
            }
        }
    }
}

/** Pure: where the rooms on screen go. `projects` is the visible rooms in arranging order (Home first, then by
 *  name). A saved place is kept when no earlier project took it; the rest take the first empty slot from G up and are
 *  saved there. An absent project keeps its entry but holds no slot. */
export function placeRooms(
    layout: OfficeLayout,
    projects: readonly string[]
): { at: Placements; layout: OfficeLayout } {
    const at: Placements = {};
    const taken = new Set<string>();
    for (const p of projects) {
        const saved = layout.rooms[p];
        if (saved && !taken.has(keyOf(saved))) {
            at[p] = saved;
            taken.add(keyOf(saved));
        }
    }
    const rooms = { ...layout.rooms };
    for (const p of projects) {
        if (at[p] == null) {
            at[p] = firstEmpty(taken);
            taken.add(keyOf(at[p]));
            rooms[p] = at[p];
        }
    }
    return { at, layout: { v: 1, rooms } };
}

/** Pure: `project` moved to `target`; the visible room there, if any, takes `project`'s place. */
export function swapRooms(layout: OfficeLayout, at: Placements, project: string, target: RoomPlace): OfficeLayout {
    const from = at[project];
    const other = Object.keys(at).find((k) => k !== project && keyOf(at[k]) === keyOf(target));
    const rooms = { ...layout.rooms, [project]: target };
    if (other && from) {
        rooms[other] = from;
    }
    return { v: 1, rooms };
}

/** Pure: `project` moved into the first empty slot of `floor`, or null when the floor is full. */
export function moveToFloor(layout: OfficeLayout, at: Placements, project: string, floor: number): OfficeLayout | null {
    const taken = new Set(
        Object.entries(at)
            .filter(([k]) => k !== project)
            .map(([, p]) => keyOf(p))
    );
    for (let slot = 0; slot < SLOTS; slot++) {
        if (!taken.has(`${floor}:${slot}`)) {
            return { v: 1, rooms: { ...layout.rooms, [project]: { floor, slot } } };
        }
    }
    return null;
}

/** Pure: the floor a room dropped on "+ New floor" builds. */
export function newFloor(at: Placements): number {
    return Math.max(-1, ...Object.values(at).map((p) => p.floor)) + 1;
}

/** Pure: the floors that hold a visible room, from G up; G alone when none does. */
export function floorsShown(at: Placements): number[] {
    const s = [...new Set(Object.values(at).map((p) => p.floor))].sort((a, b) => a - b);
    return s.length ? s : [0];
}

/** Pure: the slot one step toward dir on the 2 x 2 grid; at an edge it stays put. */
export function stepSlot(slot: number, dir: Dir): number {
    const row = Math.floor(slot / 2);
    const col = slot % 2;
    if (dir === "left" || dir === "right") {
        return row * 2 + (dir === "left" ? 0 : 1);
    }
    return (dir === "up" ? 0 : 1) * 2 + col;
}

export const floorLabel = (floor: number) => (floor === 0 ? "G" : String(floor));
