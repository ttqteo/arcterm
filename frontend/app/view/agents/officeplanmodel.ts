// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The Cockpit office's floor plan (cockpit office spec, "The plan" and "Poses"): the cards the grid would draw and
// the Idle section's agents, laid out as a band of rooms per project around a hall, with every room, door, wall,
// desk, seat and label, the office order the keyboard walks, and which rooms have their lights on. Pure: no React,
// no DOM; sizes are CSS pixels at the office's width.

import type { SeatPose } from "@/app/view/office/plansprite";
import { shortAge, type Away } from "./officebehavior";

export interface Box {
    x: number;
    y: number;
    w: number;
    h: number;
}
export interface Point {
    x: number;
    y: number;
}

export interface PlanAgent {
    id: string;
    name: string;
    project?: string;
    state: "asking" | "working" | "idle";
    idleSince?: number;
    // in the Cockpit's Finished window: an idle card the grid still draws
    finished: boolean;
    harness?: string;
}
export interface PlanTask {
    id: string;
    label: string;
    state: string;
    asking: boolean;
    // the run card's row key for this task, a Cockpit cursor stop; none when the card shows no row for it
    key?: string;
    workerId?: string;
}
export interface PlanRun {
    // the run card's id, which is also its lead seat's key
    id: string;
    title: string;
    project?: string;
    createdTs?: number;
    done: boolean;
    leadAsking: boolean;
    tasks: PlanTask[];
}
export interface PlanInput {
    agents: PlanAgent[];
    runs: PlanRun[];
    width: number;
    now: number;
    away: Record<string, Away>;
    night: boolean;
}

export type RoomKind = "agents" | "meeting" | "lounge" | "home";
export type DoorSide = "left" | "right" | "top";
export type ScreenCell = "done" | "work" | "wait" | "fail";
export interface Room {
    key: string;
    kind: RoomKind;
    box: Box;
    door?: Box;
    doorSide?: DoorSide;
    title: string;
    sub: string;
    lit: boolean;
    runId?: string;
    table?: Box;
    more?: number;
    screen?: ScreenCell[];
}
export type Tone = "plain" | "asking" | "done" | "muted";
export type Light = "working" | "asking" | "off";
export type Bubble = "!" | "?" | "×";
export interface Desk {
    key: string;
    room: string;
    x: number; // the desk top's left edge
    y: number; // the desk top's top edge
    spot: Point; // where the boss stands to look at it
    pose: SeatPose;
    animated: boolean;
    light: Light;
    dim: boolean;
    name: string;
    word?: string;
    tone: Tone;
    tip: string;
    bubble?: Bubble;
    harness?: string;
}
export interface Seat {
    key: string;
    room: string;
    runId: string;
    taskId?: string;
    x: number; // the person's left edge
    bottom: number; // the person's bottom edge
    spot: Point;
    pose: SeatPose;
    animated: boolean;
    lane: number; // 0 the lead, 1.. the task's position
    bubble?: Bubble;
    tip: string;
}
export interface Lounger {
    agentId: string;
    at: Away;
    x: number;
    bottom: number;
    box: Box; // the person's sprite
    labelBox: Box; // where the view draws the label, its name cut with an ellipsis when it does not fit
    name: string;
    age: string; // "idle 6m"
    label: string; // `name · age`, the person's title
    harness?: string;
}
export interface Plan {
    width: number;
    height: number;
    body: Box; // under the outer top wall, above the facade
    hall: Box;
    hallFloor: Box[]; // where one may stand in the hall: all of it but Home's booth
    lounge: Box;
    coffee: Point; // feet at the coffee machine
    sofa: Point; // feet on the sofa
    entrance: Box;
    rooms: Room[];
    walls: Box[];
    desks: Desk[];
    seats: Seat[];
    loungers: Lounger[];
    loungeOverflow: string[]; // agent ids with no spot left: their desk is empty, the lounge draws only "+N"
    loungeMore: Box; // where "+N in the lounge" goes
    order: string[];
    asks: string[];
}

export const WALL = 8; // a vertical wall: its top only
export const HWALL = 18; // a horizontal wall: top 8, face 10
export const HALL_W = 234;
export const MIN_W = 900;
export const DESK_DX = 120;
export const DESK_DY = 130;
export const ROOM_TOP = 120; // the first desk row's top below its room's top
export const MEETING_H = 132;
export const SEAT_DX = 56; // the widest seat pitch; a narrow room seats closer
const SEAT_PAD = 12;
export const MAX_SEATS = 12; // the lead and eleven tasks
export const LOUNGE_H = 230;
export const BOOTH_W = 152;
export const FACADE_H = 40;
export const DOOR = 50;
export const LOUNGE_PERSON_W = 36; // a person's sprite: 12 cells of PLAN_CELL px
export const LOUNGE_LABEL_H = 14;
export const POPUP_W = 380; // the card beside the desk
export const POPUP_H = 320;
export const HOME = "Home";
export const OTHER_RUNS = "Other runs";

const RUNNING = new Set(["running"]);
const AT_WORK = new Set(["ready", "running", "reviewing", "verifying", "blocked-merge"]);
const EMPTY = new Set(["pending", "cancelled", "skipped"]);
const FAILED = new Set(["review-failed", "verify-failed", "failed"]);

interface LoungeSpot {
    at: Away;
    x: number; // the person's left edge, from the lounge's left
    bottom: number; // the person's feet, from the lounge's top
    label: Box; // from the lounge's top left
}
// a seated person (back, 36 px) and a standing one with a cup (57 px) as plansprite.ts draws them
const SEATED_H = 36;
const STANDING_H = 57;
const spot = (at: Away, x: number, bottom: number, lx: number, ly: number, lw: number): LoungeSpot => ({
    at,
    x,
    bottom,
    label: { x: lx, y: ly, w: lw, h: LOUNGE_LABEL_H },
});
// The lounge holds fixed spots, filled in this order, around the furniture Building draws (TV on the wall, coffee
// machine at 168..198 x 104..150, sofa at 34..196 x 150..182, plant at 204..226 x 176..210). A label is 104 px, enough
// for a short name and its age on one line, so the sofa's three labels sit one row each under the sofa and the two
// standing places share a row above the machine, under a free line for "+N in the lounge". A spot's label and sprite
// touch no other spot's, which a test pins.
const LOUNGE_SPOTS: LoungeSpot[] = [
    spot("sofa", 38, 168, 4, 186, 104),
    spot("sofa", 82, 168, 48, 200, 104),
    spot("sofa", 126, 168, 92, 214, 104),
    spot("coffee", 170, 88, 126, 90, 104),
    spot("coffee", 38, 88, 4, 90, 104),
];

const byIdle = (a: { idleSince?: number; agentId: string }, b: { idleSince?: number; agentId: string }) => {
    // longest idle first; an unknown age goes last
    const x = a.idleSince ?? Infinity;
    const y = b.idleSince ?? Infinity;
    return x === y ? a.agentId.localeCompare(b.agentId) : x < y ? -1 : 1;
};

/** The people drawn on the floor: everyone at a desk or a seat, the lounge's, the walkers, and the boss. */
export function peopleDrawn(plan: Plan, walking: ReadonlySet<string>, boss: boolean): number {
    const seated =
        plan.desks.filter((d) => d.pose !== "empty" && !walking.has(d.key)).length +
        plan.seats.filter((s) => s.pose !== "empty").length;
    const lounging = plan.loungers.filter((l) => !walking.has(l.agentId)).length;
    return seated + lounging + walking.size + (boss ? 1 : 0);
}

const byName = (a: PlanAgent, b: PlanAgent) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
const byStart = (a: PlanRun, b: PlanRun) => (a.createdTs ?? 0) - (b.createdTs ?? 0) || a.id.localeCompare(b.id);
const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;

type Look = Pick<Desk, "pose" | "animated" | "light" | "dim" | "word" | "tone" | "bubble"> & { state: string };

/** How an agent sits at its desk and what its desk says (the spec's agent poses table). */
export function agentLook(a: PlanAgent, now: number, away: Away | undefined, night: boolean): Look {
    if (a.state === "asking") {
        return {
            pose: "hand",
            animated: true,
            light: "asking",
            dim: false,
            word: "Needs you",
            tone: "asking",
            bubble: "!",
            state: "Needs you",
        };
    }
    if (a.state === "working") {
        return { pose: "sit", animated: true, light: "working", dim: false, tone: "plain", state: "working" };
    }
    if (night) {
        return {
            pose: "empty",
            animated: false,
            light: "off",
            dim: true,
            word: "gone home",
            tone: "muted",
            state: "gone home",
        };
    }
    if (away) {
        const state = away === "coffee" ? "at the coffee machine" : "on the sofa";
        return { pose: "empty", animated: false, light: "off", dim: true, tone: "muted", state };
    }
    // the cheer as one finishes is the view's (cockpitoffice.tsx): this plan's clock is too coarse for 1.5 s
    if (a.finished) {
        return { pose: "doze", animated: false, light: "off", dim: false, word: "done", tone: "done", state: "done" };
    }
    const state = a.idleSince != null ? `idle ${shortAge(now - a.idleSince)}` : "idle";
    return { pose: "doze", animated: false, light: "off", dim: false, tone: "plain", state };
}

/** How a run's worker sits at its table, by its task's state (pkg/orchestrate/dag.go). */
export function taskLook(t: PlanTask): Pick<Seat, "pose" | "animated" | "bubble"> {
    if (t.asking) {
        return { pose: "hand", animated: true, bubble: "!" };
    }
    if (EMPTY.has(t.state)) {
        return { pose: "empty", animated: false };
    }
    if (t.state === "stalled") {
        return { pose: "doze", animated: false, bubble: "?" };
    }
    if (FAILED.has(t.state)) {
        return { pose: "sit", animated: false, bubble: "×" };
    }
    if (t.state === "done") {
        return { pose: "doze", animated: false };
    }
    return { pose: "sit", animated: RUNNING.has(t.state) };
}

/** A task on its run's wall screen. */
export function screenCell(t: PlanTask): ScreenCell {
    if (t.state === "done") {
        return "done";
    }
    if (FAILED.has(t.state) || t.state === "stalled") {
        return "fail";
    }
    return AT_WORK.has(t.state) ? "work" : "wait";
}

/** A meeting room's lights: on while its lead or a worker asks, or a task runs. */
export function runLit(r: PlanRun): boolean {
    return r.leadAsking || r.tasks.some((t) => t.asking || RUNNING.has(t.state));
}

/** A vertical wall with its doors left open. */
/** Pure: the box of the card beside the desk the boss stands at, kept inside the office's box: on the hall's side of
 *  the desk (right of the agents' room, left of a meeting room), POPUP_H tall or the office's height, and where its
 *  pointer to the desk sits on the box's edge. The box sets the card's height: a card fills its box and scrolls,
 *  as it fills its share of a column in the grid. */
export function popupBox(
    size: { width: number; height: number },
    anchor: Point,
    room: Pick<Room, "kind" | "box">
): { box: Box; right: boolean; pointerTop: number } {
    const right = room.kind !== "meeting";
    const h = Math.min(POPUP_H, size.height);
    const x = Math.max(0, Math.min(size.width - POPUP_W, right ? anchor.x + 100 : room.box.x - POPUP_W));
    const y = Math.max(0, Math.min(size.height - h, anchor.y - 60));
    const pointerTop = Math.max(8, Math.min(h - 20, anchor.y + 4 - y));
    return { box: { x, y, w: POPUP_W, h }, right, pointerTop };
}

export function cut(wall: Box, doors: Box[]): Box[] {
    const out: Box[] = [];
    let y = wall.y;
    for (const d of [...doors].sort((a, b) => a.y - b.y)) {
        if (d.y > y) {
            out.push({ ...wall, y, h: d.y - y });
        }
        y = Math.max(y, d.y + d.h);
    }
    if (y < wall.y + wall.h) {
        out.push({ ...wall, y, h: wall.y + wall.h - y });
    }
    return out;
}

export function buildPlan(input: PlanInput): Plan {
    const width = Math.max(MIN_W, Math.round(input.width));
    const colW = Math.floor((width - 4 * WALL - HALL_W) / 2);
    const leftX = WALL;
    const hallX = leftX + colW + WALL;
    const rightX = hallX + HALL_W + WALL;
    const top = HWALL;

    // a band per project with an agent or a run, by name; agents with no project go to Home's booth
    const bands = new Map<string, { agents: PlanAgent[]; runs: PlanRun[] }>();
    const band = (name: string) => {
        let b = bands.get(name);
        if (b == null) {
            b = { agents: [], runs: [] };
            bands.set(name, b);
        }
        return b;
    };
    const home: PlanAgent[] = [];
    for (const a of input.agents) {
        const p = a.project?.trim();
        if (p) {
            band(p).agents.push(a);
        } else {
            home.push(a);
        }
    }
    for (const r of input.runs) {
        band(r.project?.trim() || OTHER_RUNS).runs.push(r);
    }
    const names = [...bands.keys()].sort((a, b) => a.localeCompare(b));
    home.sort(byName);

    const heights = names.map((n) => {
        const b = bands.get(n)!;
        b.agents.sort(byName);
        b.runs.sort(byStart);
        const rows = Math.max(1, Math.ceil(b.agents.length / 3));
        const meetings = Math.max(1, b.runs.length);
        return Math.max(ROOM_TOP + rows * DESK_DY, meetings * MEETING_H + (meetings - 1) * HWALL);
    });
    const boothH = home.length ? 60 + home.length * DESK_DY : 0;
    const bandsH = heights.reduce((s, h) => s + h, 0) + Math.max(0, heights.length - 1) * HWALL;
    // Home's booth sits at the hall's foot: its top wall must clear the last band's door (at most y + 200 down)
    const lastY = bandsH - (heights[heights.length - 1] ?? 0);
    const boothClear = boothH ? lastY + 150 + DOOR + 10 + boothH + HWALL : 0;
    const bodyH = Math.max(bandsH, LOUNGE_H + (boothH ? boothH + HWALL : 0) + 80, boothClear);
    // the last band stretches to the hall when the hall is the taller
    if (heights.length > 0 && bodyH > bandsH) {
        heights[heights.length - 1] += bodyH - bandsH;
    }

    const rooms: Room[] = [];
    const walls: Box[] = [];
    const desks: Desk[] = [];
    const seats: Seat[] = [];
    const lounging: (Omit<Lounger, "x" | "bottom" | "box" | "labelBox"> & { idleSince?: number })[] = [];
    const order: string[] = [];
    const asks: string[] = [];
    const leftDoors: Box[] = [];
    const rightDoors: Box[] = [];

    const placeDesks = (list: PlanAgent[], room: Room, x0: number, y0: number, perRow: number) => {
        list.forEach((a, i) => {
            const x = x0 + (i % perRow) * DESK_DX;
            const y = y0 + Math.floor(i / perRow) * DESK_DY;
            const away = input.away[a.id];
            const { state, ...look } = agentLook(a, input.now, away, input.night);
            desks.push({
                key: a.id,
                room: room.key,
                x,
                y,
                spot: { x: x + 40, y: y + 108 },
                ...look,
                name: a.name,
                tip: `${a.name} · ${state} (Enter opens the card)`,
                harness: a.harness,
            });
            order.push(a.id);
            if (a.state === "asking") {
                asks.push(a.id);
            }
            if (away && !input.night && a.state === "idle") {
                const age = a.idleSince != null ? `idle ${shortAge(input.now - a.idleSince)}` : "idle";
                lounging.push({
                    agentId: a.id,
                    at: away,
                    idleSince: a.idleSince,
                    name: a.name,
                    age,
                    label: `${a.name} · ${age}`,
                    harness: a.harness,
                });
            }
        });
    };

    const placeSeats = (r: PlanRun, room: Room) => {
        const shown = r.tasks.slice(0, MAX_SEATS - 1);
        const far = Math.ceil((shown.length + 1) / 2);
        // the table and its chairs stay SEAT_PAD off the walls: a narrow room (eleven tasks at MIN_W) seats its
        // people closer together rather than past its walls
        const maxW = room.box.w - 2 * SEAT_PAD;
        const dx = Math.min(SEAT_DX, Math.floor((maxW - 30) / far));
        const tw = Math.min(maxW, Math.max(170, far * dx + 30));
        const inner = room.box.x + SEAT_PAD;
        const tx = Math.min(inner + maxW - tw, Math.max(inner, room.box.x + Math.round((room.box.w - tw) / 2) - 20));
        const ty = room.box.y + Math.round(room.box.h / 2) + 12;
        room.table = { x: tx, y: ty, w: tw, h: 33 };
        if (r.tasks.length > shown.length) {
            room.more = r.tasks.length - shown.length;
        }
        const spotY = Math.min(room.box.y + room.box.h - 6, ty + 76);
        const lead = r.leadAsking
            ? { pose: "hand" as const, animated: true, bubble: "!" as const }
            : { pose: (r.done ? "doze" : "sit") as SeatPose, animated: false };
        seats.push({
            key: r.id,
            room: room.key,
            runId: r.id,
            x: tx + 20,
            bottom: ty + 6,
            spot: { x: tx + 38, y: spotY },
            ...lead,
            lane: 0,
            tip: `${r.title} · lead (Enter opens the run)`,
        });
        order.push(r.id);
        if (r.leadAsking) {
            asks.push(r.id);
        }
        shown.forEach((t, i) => {
            const n = i + 1; // seat 0 is the lead
            const farSide = n % 2 === 0;
            const k = Math.floor(n / 2);
            const x = farSide ? tx + 20 + k * dx : tx + 46 + k * dx;
            const look = taskLook(t);
            // the near side shows its back, but an asking worker raises a hand on either side
            const pose: SeatPose =
                look.pose === "empty" ? "empty" : farSide || look.pose === "hand" ? look.pose : "back";
            const key = t.key ?? `${r.id}:${t.id}`;
            seats.push({
                key,
                room: room.key,
                runId: r.id,
                taskId: t.id,
                x,
                bottom: farSide ? ty + 6 : ty + 54,
                spot: { x: x + 18, y: spotY },
                pose,
                animated: (farSide || pose === "hand") && look.animated,
                bubble: look.bubble,
                lane: n,
                tip: `Task ${n} · ${t.label} · ${t.asking ? "Needs you" : t.state}`,
            });
            order.push(key);
            if (t.asking) {
                asks.push(key);
            }
        });
    };

    let y = top;
    names.forEach((name, bi) => {
        const b = bands.get(name)!;
        const h = heights[bi];
        const sub = [
            b.agents.length ? plural(b.agents.length, "agent") : "",
            b.runs.length ? plural(b.runs.length, "run") : "",
        ]
            .filter(Boolean)
            .join(" · ");
        const agentsRoom: Room = {
            key: `room:${name}`,
            kind: "agents",
            box: { x: leftX, y, w: colW, h },
            door: { x: leftX + colW, y: y + Math.min(150, h - DOOR - 10), w: WALL, h: DOOR },
            doorSide: "right",
            title: name,
            sub: sub || "no one here",
            lit: b.agents.some((a) => a.state !== "idle"),
        };
        rooms.push(agentsRoom);
        leftDoors.push(agentsRoom.door!);
        placeDesks(b.agents, agentsRoom, leftX + 32, y + ROOM_TOP, 3);

        // a meeting room per run, the last stretched to the band; a band with no run keeps an empty one
        const runs: (PlanRun | undefined)[] = b.runs.length ? b.runs : [undefined];
        let ry = y;
        runs.forEach((r, ri) => {
            const rh = ri === runs.length - 1 ? y + h - ry : MEETING_H;
            const done = r ? r.tasks.filter((t) => t.state === "done").length : 0;
            const room: Room = {
                key: r ? `meet:${r.id}` : `meet:${name}`,
                kind: "meeting",
                box: { x: rightX, y: ry, w: colW, h: rh },
                door: { x: rightX - WALL, y: ry + 50, w: WALL, h: DOOR },
                doorSide: "left",
                title: r ? r.title : "Meeting room",
                sub: r ? `run · ${done} of ${r.tasks.length} done` : "no run",
                lit: r ? runLit(r) : false,
                runId: r?.id,
                screen: r ? r.tasks.map(screenCell) : undefined,
            };
            rooms.push(room);
            rightDoors.push(room.door!);
            if (r) {
                placeSeats(r, room);
            }
            if (ri < runs.length - 1) {
                walls.push({ x: rightX, y: ry + rh, w: colW, h: HWALL });
            }
            ry += rh + HWALL;
        });
        if (bi < names.length - 1) {
            walls.push({ x: leftX, y: y + h, w: colW, h: HWALL }, { x: rightX, y: y + h, w: colW, h: HWALL });
        }
        y += h + HWALL;
    });

    // the hall: the lounge at its top, Home's booth at its foot by the entrance
    const hall: Box = { x: hallX, y: top, w: HALL_W, h: bodyH };
    const lounge: Box = { x: hallX, y: top, w: HALL_W, h: LOUNGE_H };
    rooms.push({ key: "lounge", kind: "lounge", box: lounge, title: "Lounge", sub: "", lit: true });
    let hallFloor: Box[] = [hall];
    if (home.length) {
        const by = top + bodyH - boothH;
        const booth: Room = {
            key: "room:home",
            kind: "home",
            box: { x: hallX, y: by, w: BOOTH_W, h: boothH },
            door: { x: hallX + 52, y: by - HWALL, w: 40, h: HWALL },
            doorSide: "top",
            title: HOME,
            sub: plural(home.length, "agent"),
            lit: home.some((a) => a.state !== "idle"),
        };
        rooms.push(booth);
        walls.push(
            { x: hallX, y: by - HWALL, w: 52, h: HWALL },
            { x: hallX + 92, y: by - HWALL, w: BOOTH_W - 92, h: HWALL },
            { x: hallX + BOOTH_W, y: by - HWALL, w: WALL, h: boothH + HWALL }
        );
        placeDesks(home, booth, hallX + 40, by + 70, 1);
        hallFloor = [
            { x: hallX, y: top, w: HALL_W, h: bodyH - boothH - HWALL },
            { x: hallX + BOOTH_W + WALL, y: by - HWALL, w: HALL_W - BOOTH_W - WALL, h: boothH + HWALL },
        ];
    }

    walls.push(
        { x: 0, y: 0, w: width, h: HWALL },
        { x: 0, y: 0, w: WALL, h: top + bodyH },
        { x: width - WALL, y: 0, w: WALL, h: top + bodyH },
        ...cut({ x: hallX - WALL, y: top, w: WALL, h: bodyH }, leftDoors),
        ...cut({ x: rightX - WALL, y: top, w: WALL, h: bodyH }, rightDoors)
    );

    // feet at the coffee machine and on the sofa: where walkers head. The lounge's people take its fixed spots, longest
    // idle first, so a newcomer never moves someone already there; whoever finds none is drawn only as "+N"
    const coffee = { x: hallX + 138, y: top + 150 };
    const sofa = { x: hallX + 96, y: top + 168 };
    const loungers: Lounger[] = [];
    const loungeOverflow: string[] = [];
    for (const at of ["sofa", "coffee"] as const) {
        const free = LOUNGE_SPOTS.filter((s) => s.at === at);
        lounging
            .filter((l) => l.at === at)
            .sort(byIdle)
            .forEach((l, i) => {
                const s = free[i];
                if (s == null) {
                    loungeOverflow.push(l.agentId);
                    return;
                }
                const h = at === "sofa" ? SEATED_H : STANDING_H;
                const x = lounge.x + s.x;
                const bottom = lounge.y + s.bottom;
                loungers.push({
                    agentId: l.agentId,
                    at,
                    x,
                    bottom,
                    box: { x, y: bottom - h, w: LOUNGE_PERSON_W, h },
                    labelBox: { ...s.label, x: lounge.x + s.label.x, y: lounge.y + s.label.y },
                    name: l.name,
                    age: l.age,
                    label: l.label,
                    harness: l.harness,
                });
            });
    }

    return {
        width,
        height: top + bodyH + FACADE_H,
        body: { x: 0, y: top, w: width, h: bodyH },
        hall,
        hallFloor,
        lounge,
        coffee,
        sofa,
        entrance: { x: hallX + HALL_W - 72, y: top + bodyH, w: 72, h: FACADE_H },
        rooms,
        walls,
        desks,
        seats,
        loungers,
        loungeOverflow,
        loungeMore: { x: lounge.x + 8, y: lounge.y + 16, w: 218, h: LOUNGE_LABEL_H },
        order,
        asks,
    };
}
