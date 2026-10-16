// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// How the boss moves through one floor of the Cockpit office (cockpit office spec, "The boss"; office floors spec):
// walls stop it, doors let it through, a jump to a desk walks out of its room, along the hall and in through the other
// door, and the desk the boss stands at is the selected card. A project's room is one room, its table zones are not
// rooms one walks between; the chip of what did not fit, the notice board and the lift are places to stand like a desk.
// Walkers to the lounge take the same paths. Pure: no React, no DOM.

import type { WalkDir } from "@/app/view/office/plansprite";
import {
    BOARD_KEY,
    LIFT_KEY,
    type Box,
    type Desk,
    type Plan,
    type Point,
    type Room,
    type Seat,
} from "./officeplanmodel";

export type Dir = WalkDir;

export const STEP_PX = 3; // one pixel-art cell: moves happen in whole cells
export const BOSS_SPEED = 160;
export const JUMP_SPEED = 400;
export const WALKER_SPEED = 60;
const DOOR_REACH = 14;
// how far from a desk's or seat's spot the boss may stand and still be at it, like a game's interaction zone: the
// desk's width, and from the spot up to the desk
const REACH_X = 40;
const REACH_Y = 30;
// the hall's walking lane, clear of the board and the lift
const LANE_FROM_RIGHT = 36;

const DELTA: Record<Dir, Point> = {
    up: { x: 0, y: -1 },
    down: { x: 0, y: 1 },
    left: { x: -1, y: 0 },
    right: { x: 1, y: 0 },
};
const inside = (p: Point, b: Box) => p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h;

/** Where anyone may stand: every room (an empty one too), every door, and the hall's floor. */
export function canStand(plan: Plan, p: Point): boolean {
    return (
        plan.hallFloor.some((b) => inside(p, b)) ||
        plan.rooms.some((r) => inside(p, r.box) || (r.door != null && inside(p, r.door)))
    );
}

const furnitureCache = new WeakMap<Plan, Box[]>();

// a plant drawn at (x, y) by scenery.ts: its pot, so one may pass behind its leaves
const pot = (x: number, y: number): Box => ({ x: x + 6, y: y + 26, w: 22, h: 18 });

/** What the boss's feet stay off: each desk with the person at it and its name, each meeting table with its chairs,
 *  and what scenery.ts draws on the floor: the lounge's sofa with the people on it, its coffee machine, and the
 *  plants (each room's, where it has one), and the Needs you notice board and the lift in the hall. A desk's spot and a
 *  table's stay clear, so the boss stands in front of a desk, never on it; so do the board's and the lift's, above
 *  the lift's dial and the strip over it that holds `Floor n`. */
function furniture(plan: Plan): Box[] {
    let boxes = furnitureCache.get(plan);
    if (boxes == null) {
        const l = plan.lounge;
        const b = plan.board.box;
        const { doors, dial } = plan.lift;
        boxes = [
            { x: b.x - 8, y: b.y - 8, w: b.w + 16, h: b.h + 16 },
            { x: doors.x - 8, y: dial.y - 18, w: doors.w + 16, h: doors.y + doors.h - (dial.y - 18) },
            ...plan.desks.map((d) => ({ x: d.x - 8, y: d.y - 20, w: 96, h: 100 })),
            ...plan.rooms.flatMap((r) =>
                r.table ? [{ x: r.table.x - 8, y: r.table.y - 20, w: r.table.w + 16, h: r.table.h + 53 }] : []
            ),
            { x: l.x + 34, y: l.y + 122, w: 162, h: 66 },
            { x: l.x + 166, y: l.y + 93, w: 36, h: 60 },
            pot(l.x + 200, l.y + 172),
            ...plan.rooms.flatMap((r) => (r.plant ? [pot(r.plant.x, r.plant.y)] : [])),
        ];
        furnitureCache.set(plan, boxes);
    }
    return boxes;
}

/** Where the boss may walk and stop: the floor, less the furniture. A jump's path may still cross a desk. */
export function canWalk(plan: Plan, p: Point): boolean {
    return canStand(plan, p) && !furniture(plan).some((b) => inside(p, b));
}

/** Up to `dist` px toward dir, a cell at a time, stopping before the first spot the boss may not walk on; from on top
 *  of furniture (a desk that came to where it stood), only walls stop it, so it can walk off. */
export function stepToward(plan: Plan, from: Point, dir: Dir, dist: number): Point {
    const d = DELTA[dir];
    const ok = canWalk(plan, from) ? canWalk : canStand;
    let at = from;
    for (let moved = STEP_PX; moved <= dist; moved += STEP_PX) {
        const next = { x: from.x + d.x * moved, y: from.y + d.y * moved };
        if (!ok(plan, next)) {
            break;
        }
        at = next;
    }
    return at;
}

/** The room a point is in, or "hall" (the lounge is part of the hall). A table zone is no room: a point in one is in
 *  its project's room. */
export function roomAt(plan: Plan, p: Point): string {
    return plan.rooms.find((r) => r.kind !== "lounge" && r.kind !== "meeting" && inside(p, r.box))?.key ?? "hall";
}

function doorPoints(r: Room): { inner: Point; outer: Point } {
    const d = r.door!;
    const mid = { x: d.x + d.w / 2, y: d.y + d.h / 2 };
    if (r.doorSide === "right") {
        return { inner: { x: d.x - DOOR_REACH, y: mid.y }, outer: { x: d.x + d.w + DOOR_REACH, y: mid.y } };
    }
    if (r.doorSide === "left") {
        return { inner: { x: d.x + d.w + DOOR_REACH, y: mid.y }, outer: { x: d.x - DOOR_REACH, y: mid.y } };
    }
    return { inner: { x: mid.x, y: d.y + d.h + DOOR_REACH }, outer: { x: mid.x, y: d.y - DOOR_REACH } };
}

const dedupe = (pts: Point[]) => pts.filter((p, i) => i === 0 || p.x !== pts[i - 1].x || p.y !== pts[i - 1].y);

/** The way between two spots: straight within a room, else out through one door, along the hall's lane, and in
 * through the other. */
export function pathBetween(plan: Plan, from: Point, to: Point): Point[] {
    const a = roomAt(plan, from);
    const b = roomAt(plan, to);
    if (a === b) {
        return [from, to];
    }
    const roomOf = (k: string) => plan.rooms.find((r) => r.key === k);
    const lane = plan.hall.x + plan.hall.w - LANE_FROM_RIGHT;
    const out: Point[] = [from];
    let hallFrom = from;
    if (a !== "hall") {
        const d = doorPoints(roomOf(a)!);
        out.push(d.inner, d.outer);
        hallFrom = d.outer;
    }
    const enter = b !== "hall" ? doorPoints(roomOf(b)!) : undefined;
    const hallTo = enter ? enter.outer : to;
    out.push({ x: lane, y: hallFrom.y }, { x: lane, y: hallTo.y });
    if (enter) {
        out.push(enter.outer, enter.inner);
    }
    out.push(to);
    return dedupe(out);
}

/** Dots every `gap` px along a path, for the hint `n` shows. */
export function dotsAlong(path: Point[], gap = 14): Point[] {
    const dots: Point[] = [];
    let carry = 0;
    for (let i = 0; i < path.length - 1; i++) {
        const a = path[i];
        const b = path[i + 1];
        const len = Math.hypot(b.x - a.x, b.y - a.y);
        let d = carry;
        while (d < len) {
            dots.push({ x: a.x + ((b.x - a.x) * d) / len, y: a.y + ((b.y - a.y) * d) / len });
            d += gap;
        }
        carry = d - len;
    }
    return dots;
}

/** Walks `dist` px along a path: the point reached, and the path still ahead starting there. */
export function advance(path: Point[], dist: number): { at: Point; rest: Point[] } {
    let left = dist;
    let at = path[0];
    for (let i = 0; i < path.length - 1; i++) {
        const b = path[i + 1];
        const len = Math.hypot(b.x - at.x, b.y - at.y);
        if (len > left) {
            at = { x: at.x + ((b.x - at.x) * left) / len, y: at.y + ((b.y - at.y) * left) / len };
            return { at, rest: [at, ...path.slice(i + 1)] };
        }
        left -= len;
        at = b;
    }
    return { at, rest: [at] };
}

/** The way someone faces going from a to b: the larger of the two moves. */
export function facing(a: Point, b: Point, was: Dir = "down"): Dir {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    if (dx === 0 && dy === 0) {
        return was;
    }
    return Math.abs(dx) >= Math.abs(dy) ? (dx < 0 ? "left" : "right") : dy < 0 ? "up" : "down";
}

/** Where the boss stands for a desk, seat or chip key, or the notice board's, or the lift's. */
export function spotOf(plan: Plan, key: string): Point | undefined {
    if (key === BOARD_KEY) {
        return plan.board.spot;
    }
    if (key === LIFT_KEY) {
        return plan.lift.spot;
    }
    return (
        plan.desks.find((d) => d.key === key)?.spot ??
        plan.seats.find((s) => s.key === key)?.spot ??
        plan.rooms.find((r) => r.chip?.key === key)?.chip?.spot
    );
}

/** The desk, seat or chip the boss stands in front of: the nearest whose spot is within reach, in the room it stands
 *  in (a seat is in its project's room, not its table zone); the notice board's or the lift's key in the hall, within
 *  reach of its spot; undefined anywhere else, in the lounge too. */
export function deskAt(plan: Plan, p: Point): string | undefined {
    const room = roomAt(plan, p);
    let best: string | undefined;
    let dist = Number.POSITIVE_INFINITY;
    const consider = (key: string, spot: Point) => {
        const dx = Math.abs(spot.x - p.x);
        const dy = Math.abs(spot.y - p.y);
        const d = Math.hypot(dx, dy);
        if (dx <= REACH_X && dy <= REACH_Y && d < dist) {
            dist = d;
            best = key;
        }
    };
    if (room === "hall") {
        consider(BOARD_KEY, plan.board.spot);
        consider(LIFT_KEY, plan.lift.spot);
        return best;
    }
    for (const s of plan.desks) {
        if (s.room === room) {
            consider(s.key, s.spot);
        }
    }
    for (const s of plan.seats) {
        if (s.room === room) {
            consider(s.key, s.spot);
        }
    }
    const chip = plan.rooms.find((r) => r.key === room)?.chip;
    if (chip) {
        consider(chip.key, chip.spot);
    }
    return best;
}

/** The desk, seat or chip whose card or dialog the boss can open: the cursor's, while the boss stands still at it. The
 *  notice board and the lift have no card: they answer `{ board: true }` and `{ lift: true }`, which open their dialog
 *  boxes and nothing else; a chip answers `{ room, chip: true }`, its dialog box lists what did not fit the room. */
export function cardAt(
    plan: Plan,
    boss: { at: Point; path: readonly Point[]; holding?: Dir } | null,
    cursorId: string | undefined
): { desk?: Desk; seat?: Seat; room?: Room; board?: boolean; chip?: boolean; lift?: boolean } | undefined {
    if (boss == null || cursorId == null || boss.path.length > 1 || boss.holding != null) {
        return undefined;
    }
    if (deskAt(plan, boss.at) !== cursorId) {
        return undefined;
    }
    if (cursorId === BOARD_KEY) {
        return { board: true };
    }
    if (cursorId === LIFT_KEY) {
        return { lift: true };
    }
    const chipRoom = plan.rooms.find((r) => r.chip?.key === cursorId);
    if (chipRoom) {
        return { room: chipRoom, chip: true };
    }
    const desk = plan.desks.find((d) => d.key === cursorId);
    const seat = desk ? undefined : plan.seats.find((s) => s.key === cursorId);
    const room = plan.rooms.find((r) => r.key === (desk?.room ?? seat?.room));
    return room ? { desk, seat, room } : undefined;
}

/** The stop the boss goes to with a room it carried to its new slot: the cursor's, when it is a desk, seat or chip of that
 *  room, else the room's first desk, seat or chip; none when the room holds no one. */
export function carriedStop(plan: Plan, roomKey: string, cursor: string | undefined): string | undefined {
    const chip = plan.rooms.find((r) => r.key === roomKey)?.chip?.key;
    const inRoom = (key: string) =>
        key === chip ||
        plan.desks.some((d) => d.key === key && d.room === roomKey) ||
        plan.seats.some((s) => s.key === key && s.room === roomKey);
    if (cursor != null && inRoom(cursor)) {
        return cursor;
    }
    return plan.desks.find((d) => d.room === roomKey)?.key ?? plan.seats.find((s) => s.room === roomKey)?.key ?? chip;
}

/** What the boss's sprite and the card beside its desk are drawn from. Its spot is in it only while it stands
 * still: a walk step that only moves it gives an equal look, so the office re-renders nothing for it and moves the
 * boss's <img> on the DOM instead. */
export interface BossLook {
    moving: boolean;
    dir: Dir;
    rest?: Point;
}
export function bossLook(boss: { at: Point; path: readonly Point[]; dir: Dir; holding?: Dir } | null): BossLook | null {
    if (boss == null) {
        return null;
    }
    const moving = boss.path.length > 1 || boss.holding != null;
    return moving ? { moving, dir: boss.dir } : { moving, dir: boss.dir, rest: boss.at };
}
