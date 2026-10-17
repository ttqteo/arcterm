// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// How the boss moves through one floor of the Cockpit office (cockpit office spec, "The boss"; office floors spec):
// walls and furniture stop it, doors let it through, a jump to a desk walks out of its room through the middle of its
// door, across the hall around what stands there and in through the other door, and the desk the boss stands at is the
// selected card. A project's room is one room, its table zones are not
// rooms one walks between; the chip of what did not fit, the notice board and the lift are places to stand like a desk.
// Walkers to the lounge take the same paths. Pure: no React, no DOM.

import { PET_GRID } from "@/app/view/jarvis/petsprite";
import type { WalkDir } from "@/app/view/office/plansprite";
import {
    BOARD_KEY,
    BOSS_HALF_W,
    BOSS_HEADROOM,
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
// the boss is the pet, drawn here with art cells this big: at the footer's 3 px its 16-cell grid stands about 40 px,
// well under a person's 23 cells at the plan's 3 px (69 px); at 5 px it stands as tall as they do
export const BOSS_CELL_PX = 5;
export const BOSS_PX = PET_GRID * BOSS_CELL_PX;
export const BOSS_SPEED = 240;
// Shift held: the arrows walk the boss this many times as fast
export const BOSS_RUN = 2;
export const JUMP_SPEED = 400;
export const WALKER_SPEED = 60;
// a path's stops either side of a door: far enough out that the boss's body clears the wall's end
const DOOR_REACH = BOSS_HALF_W + 4;
// how far from a desk's or seat's spot the boss may stand and still be at it, like a game's interaction zone: the
// desk's width, and from the spot up to the desk
const REACH_X = 40;
const REACH_Y = 30;

const DELTA: Record<Dir, Point> = {
    up: { x: 0, y: -1 },
    down: { x: 0, y: 1 },
    left: { x: -1, y: 0 },
    right: { x: 1, y: 0 },
};
const inside = (p: Point, b: Box) => p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h;

const floorCache = new WeakMap<Plan, Box[]>();

/** Where the boss's feet may be, so all of it stays on the floor: each room (an empty one too) and the hall, less a body's
 *  half width by each side wall and its headroom under the wall behind it (BOSS_HALF_W, BOSS_HEADROOM); and each door's
 *  opening, as wide as a body each side of it, so the boss walks through it from one room's floor to the other's. */
function floor(plan: Plan): Box[] {
    let boxes = floorCache.get(plan);
    if (boxes == null) {
        const clear = (b: Box): Box => ({
            x: b.x + BOSS_HALF_W,
            y: b.y + BOSS_HEADROOM,
            w: b.w - 2 * BOSS_HALF_W,
            h: b.h - BOSS_HEADROOM,
        });
        boxes = [
            ...plan.hallFloor.map(clear),
            ...plan.rooms.map((r) => clear(r.box)),
            ...plan.rooms.flatMap((r) =>
                r.door ? [{ x: r.door.x - BOSS_HALF_W, y: r.door.y, w: r.door.w + 2 * BOSS_HALF_W, h: r.door.h }] : []
            ),
        ];
        floorCache.set(plan, boxes);
    }
    return boxes;
}

/** Where the boss may stand: on a room's floor (an empty one too), in a door, on the hall's, with none of its body over a
 *  wall or in the next room. */
export function canStand(plan: Plan, p: Point): boolean {
    return floor(plan).some((b) => inside(p, b));
}

const furnitureCache = new WeakMap<Plan, Box[]>();

// a plant drawn at (x, y) by scenery.ts: its pot, so one may pass behind its leaves
const pot = (x: number, y: number): Box => ({ x: x + 6, y: y + 26, w: 22, h: 18 });

/** What the boss's feet stay off: each desk with the person at it and its name, each meeting table with its chairs,
 *  and what scenery.ts draws on the floor: the lounge's sofa with the people on it, its coffee machine, and the
 *  plants (each room's, where it has them), and the Needs you notice board and the lift in the hall. A desk's spot and a
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
            // the sofa from its arms' top (142) less the 7 px the boss's ring reaches under its feet, so it walks up to
            // an empty sofa; over a seat someone takes, from their head, a body's half width either side of them
            { x: l.x + 34, y: l.y + 135, w: 162, h: 53 },
            ...plan.loungers
                .filter((p) => p.at === "sofa")
                .map(({ box: s }) => ({ x: s.x - BOSS_HALF_W, y: s.y - 1, w: s.w + 2 * BOSS_HALF_W, h: s.h + 1 })),
            { x: l.x + 166, y: l.y + 93, w: 36, h: 60 },
            pot(l.x + 200, l.y + 172),
            ...plan.rooms.flatMap((r) => (r.plants ?? []).map((p) => pot(p.x, p.y))),
        ];
        furnitureCache.set(plan, boxes);
    }
    return boxes;
}

/** Where the boss may walk and stop: the floor, less the furniture. A path between two spots goes round it too. */
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

type Line = (a: Point, b: Point) => boolean;

/** Whether the line from a to b stays on the floor: every point a px apart, b included. */
function onFloorLine(plan: Plan, a: Point, b: Point): boolean {
    const n = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y));
    for (let i = 1; i <= n; i++) {
        if (!canStand(plan, { x: a.x + ((b.x - a.x) * i) / n, y: a.y + ((b.y - a.y) * i) / n })) {
            return false;
        }
    }
    return true;
}

/** Whether the line from a to b touches the box, its edges included (the slab test). */
function crosses(a: Point, b: Point, box: Box): boolean {
    let t0 = 0;
    let t1 = 1;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    for (const [p, q] of [
        [-dx, a.x - box.x],
        [dx, box.x + box.w - a.x],
        [-dy, a.y - box.y],
        [dy, box.y + box.h - a.y],
    ]) {
        if (p === 0) {
            if (q < 0) {
                return false;
            }
        } else if (p < 0) {
            t0 = Math.max(t0, q / p);
        } else {
            t1 = Math.min(t1, q / p);
        }
        if (t0 > t1) {
            return false;
        }
    }
    return true;
}

/** Whether the boss walks the line from a to b: on the floor and clear of every piece of furniture. */
function walkLine(plan: Plan, a: Point, b: Point): boolean {
    return onFloorLine(plan, a, b) && !furniture(plan).some((box) => crosses(a, b, box));
}

/** A path drawn taut: from each point, straight to the furthest one after it that a clear line still reaches. */
function taut(clear: Line, path: Point[]): Point[] {
    const out = [path[0]];
    let from = 0;
    for (let i = 1; i < path.length; i++) {
        if (i === path.length - 1 || !clear(path[from], path[i + 1])) {
            out.push(path[i]);
            from = i;
        }
    }
    return out;
}

// a binary heap of lattice points by cost, the least first
class Queue {
    private keys: number[] = [];
    private costs: number[] = [];
    get size() {
        return this.keys.length;
    }
    push(key: number, cost: number) {
        let i = this.keys.length;
        this.keys.push(key);
        this.costs.push(cost);
        while (i > 0) {
            const up = (i - 1) >> 1;
            if (this.costs[up] <= cost) {
                break;
            }
            this.keys[i] = this.keys[up];
            this.costs[i] = this.costs[up];
            i = up;
        }
        this.keys[i] = key;
        this.costs[i] = cost;
    }
    pop(): number {
        const top = this.keys[0];
        const key = this.keys.pop()!;
        const cost = this.costs.pop()!;
        const n = this.keys.length;
        if (n > 0) {
            let i = 0;
            for (;;) {
                const l = 2 * i + 1;
                if (l >= n) {
                    break;
                }
                const c = l + 1 < n && this.costs[l + 1] < this.costs[l] ? l + 1 : l;
                if (this.costs[c] >= cost) {
                    break;
                }
                this.keys[i] = this.keys[c];
                this.costs[i] = this.costs[c];
                i = c;
            }
            this.keys[i] = key;
            this.costs[i] = cost;
        }
        return top;
    }
}

type Ground = "walk" | "stand";

/** A floor's lattice: a point every STEP_PX from its top left corner, the step the arrows walk, so a path finds every gap
 *  they do (the 4 px between the lounge's sofa and the hall's wall, the 19 px between two desks). Whether one may walk
 *  or stand at each is worked out the first time a search asks, and kept with the plan; the rest is a search's scratch. */
interface Lattice {
    cols: number;
    rows: number;
    ground: Record<Ground, Uint8Array>; // 0 not yet asked, 1 yes, 2 no
    cost: Float64Array;
    back: Int32Array;
    seen: Uint32Array; // the search that last set cost and back
    shut: Uint32Array; // the search that last took the point off its queue
    search: number;
}
const latticeCache = new WeakMap<Plan, Lattice>();

function latticeOf(plan: Plan): Lattice {
    let l = latticeCache.get(plan);
    if (l == null) {
        const cols = Math.ceil(plan.width / STEP_PX) + 1;
        const rows = Math.ceil(plan.height / STEP_PX) + 1;
        const n = cols * rows;
        l = {
            cols,
            rows,
            ground: { walk: new Uint8Array(n), stand: new Uint8Array(n) },
            cost: new Float64Array(n),
            back: new Int32Array(n),
            seen: new Uint32Array(n),
            shut: new Uint32Array(n),
            search: 0,
        };
        latticeCache.set(plan, l);
    }
    return l;
}

function onGround(plan: Plan, l: Lattice, kind: Ground, i: number, j: number): boolean {
    if (i < 0 || j < 0 || i >= l.cols || j >= l.rows) {
        return false;
    }
    const k = j * l.cols + i;
    const marks = l.ground[kind];
    if (marks[k] === 0) {
        const p = { x: i * STEP_PX, y: j * STEP_PX };
        marks[k] = (kind === "walk" ? canWalk(plan, p) : canStand(plan, p)) ? 1 : 2;
    }
    return marks[k] === 1;
}

// the lattice points round p, at most a step from it, that kind lets one stand on
function around(plan: Plan, l: Lattice, kind: Ground, p: Point): number[] {
    const out: number[] = [];
    for (const i of [Math.floor(p.x / STEP_PX), Math.ceil(p.x / STEP_PX)]) {
        for (const j of [Math.floor(p.y / STEP_PX), Math.ceil(p.y / STEP_PX)]) {
            const k = j * l.cols + i;
            if (onGround(plan, l, kind, i, j) && !out.includes(k)) {
                out.push(k);
            }
        }
    }
    return out;
}

const NEIGHBOURS: [number, number, number][] = [
    [1, 0, 1],
    [-1, 0, 1],
    [0, 1, 1],
    [0, -1, 1],
    [1, 1, Math.SQRT2],
    [1, -1, Math.SQRT2],
    [-1, 1, Math.SQRT2],
    [-1, -1, Math.SQRT2],
];

/** The lattice points from round `from` to the first one `reached` accepts, over the ground `kind` lets one on: A* in
 *  eight directions toward `aim` (none: the nearest such point), a diagonal never cutting a corner. Null when none is. */
function search(plan: Plan, kind: Ground, from: Point, reached: (k: number) => boolean, aim?: Point): Point[] | null {
    const l = latticeOf(plan);
    const id = ++l.search;
    const cols = l.cols;
    const ai = aim ? aim.x / STEP_PX : 0;
    const aj = aim ? aim.y / STEP_PX : 0;
    const guess = (i: number, j: number) => {
        if (!aim) {
            return 0;
        }
        const dx = Math.abs(ai - i);
        const dy = Math.abs(aj - j);
        return Math.max(dx, dy) + (Math.SQRT2 - 1) * Math.min(dx, dy);
    };
    const queue = new Queue();
    for (const k of around(plan, l, kind, from)) {
        const i = k % cols;
        const j = (k - i) / cols;
        const c = Math.hypot(i * STEP_PX - from.x, j * STEP_PX - from.y) / STEP_PX;
        l.seen[k] = id;
        l.cost[k] = c;
        l.back[k] = -1;
        queue.push(k, c + guess(i, j));
    }
    while (queue.size > 0) {
        const k = queue.pop();
        if (l.shut[k] === id) {
            continue;
        }
        l.shut[k] = id;
        const i = k % cols;
        const j = (k - i) / cols;
        if (reached(k)) {
            const path: Point[] = [];
            for (let at = k; at !== -1; at = l.back[at]) {
                const ai2 = at % cols;
                path.push({ x: ai2 * STEP_PX, y: ((at - ai2) / cols) * STEP_PX });
            }
            return path.reverse();
        }
        for (const [di, dj, len] of NEIGHBOURS) {
            const ni = i + di;
            const nj = j + dj;
            if (!onGround(plan, l, kind, ni, nj)) {
                continue;
            }
            if (di !== 0 && dj !== 0 && (!onGround(plan, l, kind, ni, j) || !onGround(plan, l, kind, i, nj))) {
                continue;
            }
            const nk = nj * cols + ni;
            const c = l.cost[k] + len;
            if (l.seen[nk] === id && c >= l.cost[nk]) {
                continue;
            }
            l.seen[nk] = id;
            l.cost[nk] = c;
            l.back[nk] = k;
            queue.push(nk, c + guess(ni, nj));
        }
    }
    return null;
}

/** The way from one spot to another on the same side of a door: straight when nothing stands between, else round the
 *  furniture. A spot on furniture (a desk that came to where one stood, a seat on the sofa) is left or reached by the
 *  shortest way off it, over only the floor. Straight, as before, when no way is found. */
function route(plan: Plan, from: Point, to: Point): Point[] {
    const walk = (p: Point) => canWalk(plan, p);
    const walkable: Line = (a, b) => walkLine(plan, a, b);
    const standable: Line = (a, b) => onFloorLine(plan, a, b);
    if (walk(from) && walk(to) && walkable(from, to)) {
        return [from, to];
    }
    const l = latticeOf(plan);
    const onWalk = (k: number) =>
        l.ground.walk[k] === 1 || onGround(plan, l, "walk", k % l.cols, Math.floor(k / l.cols));
    // a spot and the way from it to the nearest point one may walk on: none when it is on the floor already
    const off = (p: Point): Point[] | null => {
        if (walk(p)) {
            return [p];
        }
        const way = search(plan, "stand", p, onWalk);
        return way ? [p, ...way] : null;
    };
    const head = off(from);
    const tail = off(to)?.reverse();
    if (head == null || tail == null) {
        return [from, to];
    }
    const a = head[head.length - 1];
    const b = tail[0];
    let mid: Point[] | null = [a, b];
    if (!walkable(a, b)) {
        const ends = new Set(around(plan, l, "walk", b));
        const way = ends.size > 0 ? search(plan, "walk", a, (k) => ends.has(k), b) : null;
        mid = way ? [a, ...way, b] : null;
    }
    if (mid == null) {
        return [from, to];
    }
    return dedupe([...taut(standable, head), ...taut(walkable, mid).slice(1), ...taut(standable, tail).slice(1)]);
}

/** The way between two spots: within a room round its furniture, else out through the middle of one door, across the
 *  hall and in through the middle of the other, round the furniture on each leg. */
export function pathBetween(plan: Plan, from: Point, to: Point): Point[] {
    const a = roomAt(plan, from);
    const b = roomAt(plan, to);
    const roomOf = (k: string) => plan.rooms.find((r) => r.key === k)!;
    const stops: Point[] = [from];
    if (a !== b && a !== "hall") {
        const d = doorPoints(roomOf(a));
        stops.push(d.inner, d.outer);
    }
    if (a !== b && b !== "hall") {
        const d = doorPoints(roomOf(b));
        stops.push(d.outer, d.inner);
    }
    stops.push(to);
    const out: Point[] = [from];
    for (let i = 0; i < stops.length - 1; i++) {
        out.push(...route(plan, stops[i], stops[i + 1]).slice(1));
    }
    return out.length < 2 ? [from, to] : dedupe(out);
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
