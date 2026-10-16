// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The Cockpit office's floor plan (cockpit office spec, "The plan" and "Poses"; office floors spec): one floor of the
// building, four project rooms in a 2 x 2 around the hall, each holding its agents' desks above and its runs' tables
// in a strip at its foot, with the lounge, the notice board and the lift in the hall. It holds every room, door, wall,
// desk, seat and label, the office order the keyboard walks, which rooms have their lights on, what does not fit a
// room (its chip), and a summary of every other floor. Pure: no React, no DOM; sizes are CSS pixels at the office's
// width.

import type { SeatPose } from "@/app/view/office/plansprite";
import { shortAge, type Away } from "./officebehavior";
import { EMPTY_LAYOUT, floorLabel, floorsShown, placeRooms, SLOTS, type Placements } from "./officelayout";

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
    // the height to fill, the view's: the rooms grow to it, but never under two ROOM_MIN_H rooms (a shorter view scrolls)
    height?: number;
    // the floor to build: G (0) unless told, and the nearest floor that holds a room when that one does not
    floor?: number;
    // which floor and slot each project's room takes; the rooms arranged automatically unless told
    at?: Placements;
    now: number;
    away: Record<string, Away>;
    night: boolean;
}

export type RoomKind = "agents" | "meeting" | "lounge" | "empty";
export type DoorSide = "left" | "right" | "top";
export type ScreenCell = "done" | "work" | "wait" | "fail";
/** What did not fit a room: one chip at the right of its title row, a stop in the office order. */
export interface RoomChip {
    box: Box;
    spot: Point; // where the boss stands to open it
    key: string;
    text: string; // `+3 agents · +1 run`
    ask: boolean; // someone in it asks
    hidden: string[]; // the agent ids, then the run ids, it holds
}
export interface Room {
    key: string;
    kind: RoomKind;
    box: Box;
    door?: Box;
    doorSide?: DoorSide;
    title: string;
    sub: string;
    lit: boolean;
    slot?: number; // an agents' or empty room's place on its floor: row * 2 + column
    runId?: string;
    table?: Box;
    more?: number;
    screen?: ScreenCell[];
    parent?: string; // a table zone's project room
    chip?: RoomChip;
    plants?: Point[]; // absent when the room has none
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
    room: string; // the project room it is in
    zone: string; // the table zone it sits at
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
/** One floor of the building as the lift panel lists it. */
export interface FloorSummary {
    floor: number;
    label: string; // "G", "1", "2"…
    rooms: string[]; // the projects in its rooms, by slot
    asks: number; // asking agents, leads and tasks in them, the hidden ones too
    lit: boolean;
}
export interface Plan {
    width: number;
    height: number;
    body: Box; // under the outer top wall, above the foot strip
    hall: Box;
    hallFloor: Box[]; // where one may stand in the hall: all of it
    lounge: Box;
    coffee: Point; // feet at the coffee machine
    sofa: Point; // feet on the sofa
    entrance: Box; // the glass doors in the foot strip, drawn on G only
    rooms: Room[]; // each project's (or empty) room by slot, its table zones after it, then the lounge
    walls: Box[];
    desks: Desk[];
    seats: Seat[];
    loungers: Lounger[];
    loungeOverflow: string[]; // agent ids with no spot left: their desk is empty, the lounge draws only "+N"
    loungeMore: Box; // where "+N in the lounge" goes
    board: { box: Box; spot: Point }; // the Needs you notice board in the hall, and where the boss stands at it
    lift: { doors: Box; dial: Box; spot: Point }; // the lift at the hall's foot, and where the boss stands at it: above its dial
    floor: number; // the floor built
    floors: FloorSummary[]; // every floor that holds a room, from G up
    ground: boolean; // the floor built is G
    order: string[];
    asks: string[]; // this floor's asks, in office order
    otherAsks: { key: string; floor: number }[]; // the asks on the other floors, in floor order then office order
}

export const WALL = 8; // a vertical wall: its top only
export const HWALL = 18; // a horizontal wall: top 8, face 10
export const HALL_W = 234;
export const MIN_W = 900;
export const DESK_DX = 116;
export const DESK_DY = 110;
export const ROOM_TOP = 104; // the first desk row's top below its room's top
export const ROOM_MIN_H = 300; // a room is never shorter: a shorter view scrolls the floor
export const MEET_H = 124; // the strip of table zones at a room's foot
export const TABLE_W = 190; // one table zone
const TABLE_TOP = 51; // a table's top below its zone's: the far side's heads above it, the near side and the boss's spot below
export const SEAT_DX = 56; // the widest seat pitch; a narrow zone seats closer
const SEAT_PAD = 12;
export const TABLE_SEATS = 5; // the lead and four tasks
const DESK_SPOT_DY = 84; // the boss's feet below a desk top: between its row's desks and the next row's
export const LOUNGE_H = 230;
export const BOARD_KEY = "board:needs-you"; // the notice board's cursor key, like a desk's
export const LIFT_KEY = "lift"; // the lift's, the same
export const CHIP_KEY = (roomKey: string) => `chip:${roomKey}`; // a room's chip, the same
export const BOARD_W = 96;
export const BOARD_H = 96;
const BOARD_GAP = 16; // the board's top below the lounge's foot
const BOARD_SPOT_DY = 22; // the boss's feet below the board's foot
const LIFT_W = 70;
const LIFT_H = 68;
const LIFT_DIAL_H = 26;
const LIFT_LABEL_H = 24; // the strip over the dial that the view puts `Floor n` in: the boss stands above it, so its body covers neither
const CHIP_H = 20;
const CHIP_CHAR_W = 6.4; // the chip's label is 11 px text
export const FACADE_H = 40;
export const DOOR = 50;
export const LOUNGE_PERSON_W = 42; // a person's sprite: 14 cells of PLAN_CELL px
export const LOUNGE_LABEL_H = 14;
export const POPUP_W = 380; // the card beside the desk
export const POPUP_H = 320;
export const POPUP_BIG_W = 720; // the card grown with ⤢ or f
export const POPUP_BIG_H = 640;
export const HOME = "Home";

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
// the chibi's back on the sofa (15 rows, 45 px) and standing with a cup (23 rows, 69 px) as plansprite.ts draws them
const SEATED_H = 45;
const STANDING_H = 69;
const spot = (at: Away, x: number, bottom: number, lx: number, ly: number, lw: number): LoungeSpot => ({
    at,
    x,
    bottom,
    label: { x: lx, y: ly, w: lw, h: LOUNGE_LABEL_H },
});
// The lounge holds fixed spots, filled in this order, around the furniture Building draws (TV on the wall, coffee
// machine at 165..201 x 93..153, sofa at 34..196 x 150..182, plant at 204..226 x 176..210). A label is 104 px, enough
// for a short name and its age on one line, so the sofa's three labels sit one row each under the sofa and the two
// standing places share a row at 90, their heads (69 px tall) reaching up to 19. "+N in the lounge" takes the free row
// at 106 between those labels and the sofa people's heads (123), left of the machine. A spot's label and sprite
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
// runs at work take the tables before the ones that are done, then by start
const byTable = (a: PlanRun, b: PlanRun) => Number(a.done) - Number(b.done) || byStart(a, b);
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

/** Pure: the box of the card beside the desk the boss stands at, kept inside the office's box: on the hall's side of
 *  the desk (right of a left-column room, left of a right-column one: the side its door is on), POPUP_H tall or the
 *  office's height, and where its pointer to the desk sits on the box's edge. The box sets the card's height: a card
 *  fills its box and scrolls, as it fills its share of a column in the grid. Big, it takes the room that side has, up
 *  to POPUP_BIG_W, never less than the small card. */
export function popupBox(
    size: { width: number; height: number },
    anchor: Point,
    room: Pick<Room, "box" | "doorSide">,
    big = false
): { box: Box; right: boolean; pointerTop: number } {
    const right = room.doorSide !== "left";
    const h = Math.min(big ? POPUP_BIG_H : POPUP_H, size.height);
    const side = right ? size.width - (anchor.x + 100) : room.box.x;
    const w = big ? Math.max(POPUP_W, Math.min(POPUP_BIG_W, side)) : POPUP_W;
    const x = Math.max(0, Math.min(size.width - w, right ? anchor.x + 100 : room.box.x - w));
    const y = Math.max(0, Math.min(size.height - h, anchor.y - 60));
    const pointerTop = Math.max(8, Math.min(h - 20, anchor.y + 4 - y));
    return { box: { x, y, w, h }, right, pointerTop };
}

/** A vertical wall with its doors left open. */
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

const projectOf = (project?: string) => project?.trim() || HOME;

/** Pure: the rooms the cards need, in arranging order: Home first (when an agent or a run has no project), then the
 *  project names by localeCompare. The office's arrangement (officelayout.ts) places exactly these. */
export function projectsOf(agents: readonly PlanAgent[], runs: readonly PlanRun[]): string[] {
    const names = new Set<string>();
    for (const a of agents) {
        names.add(projectOf(a.project));
    }
    for (const r of runs) {
        names.add(projectOf(r.project));
    }
    const rest = [...names].filter((n) => n !== HOME).sort((a, b) => a.localeCompare(b));
    return names.has(HOME) ? [HOME, ...rest] : rest;
}

interface Cards {
    agents: PlanAgent[]; // by name
    runs: PlanRun[]; // the table order
}
function groupCards(agents: readonly PlanAgent[], runs: readonly PlanRun[]): Map<string, Cards> {
    const out = new Map<string, Cards>();
    const of = (name: string) => {
        let c = out.get(name);
        if (c == null) {
            c = { agents: [], runs: [] };
            out.set(name, c);
        }
        return c;
    };
    for (const a of agents) {
        of(projectOf(a.project)).agents.push(a);
    }
    for (const r of runs) {
        of(projectOf(r.project)).runs.push(r);
    }
    for (const c of out.values()) {
        c.agents.sort(byName);
        c.runs.sort(byTable);
    }
    return out;
}

// how much a room of this size holds: desks per row and rows, and table zones across the strip at its foot
interface Capacity {
    perRow: number;
    rows: number;
    tables: number;
}
const capacityOf = (w: number, h: number): Capacity => ({
    perRow: Math.max(1, Math.floor((w - 24) / DESK_DX)),
    rows: Math.max(1, Math.floor((h - MEET_H - 60) / DESK_DY)),
    tables: Math.max(1, Math.floor((w - 10) / TABLE_W)),
});

const seatKey = (r: PlanRun, t: PlanTask) => t.key ?? `${r.id}:${t.id}`;

// what a project's room holds, before any geometry: who sits, which runs have a table, the chip, the lights, and the
// stops the keyboard walks. The built floor and the summaries of the other floors both read it, so they agree.
interface Fill {
    seated: PlanAgent[];
    tabled: PlanRun[];
    chip?: { text: string; ask: boolean; hidden: string[] };
    lit: boolean;
    asks: number; // asking agents, leads and tasks, the hidden ones too
    order: string[];
    askKeys: string[];
}
function fillRoom(roomKey: string, c: Cards, cap: Capacity): Fill {
    const seated = c.agents.slice(0, cap.perRow * cap.rows);
    const hidden = c.agents.slice(seated.length);
    const tabled = c.runs.slice(0, cap.tables);
    const hiddenRuns = c.runs.slice(tabled.length);
    const order: string[] = seated.map((a) => a.id);
    const askKeys: string[] = seated.filter((a) => a.state === "asking").map((a) => a.id);
    for (const r of tabled) {
        order.push(r.id);
        if (r.leadAsking) {
            askKeys.push(r.id);
        }
        for (const t of r.tasks.slice(0, TABLE_SEATS - 1)) {
            order.push(seatKey(r, t));
            if (t.asking) {
                askKeys.push(seatKey(r, t));
            }
        }
    }
    let chip: Fill["chip"];
    if (hidden.length || hiddenRuns.length) {
        const text = [
            hidden.length ? `+${plural(hidden.length, "agent")}` : "",
            hiddenRuns.length ? `+${plural(hiddenRuns.length, "run")}` : "",
        ]
            .filter(Boolean)
            .join(" · ");
        const ask =
            hidden.some((a) => a.state === "asking") ||
            hiddenRuns.some((r) => r.leadAsking || r.tasks.some((t) => t.asking));
        chip = { text, ask, hidden: [...hidden.map((a) => a.id), ...hiddenRuns.map((r) => r.id)] };
        order.push(CHIP_KEY(roomKey));
        if (ask) {
            askKeys.push(CHIP_KEY(roomKey));
        }
    }
    const asks =
        c.agents.filter((a) => a.state === "asking").length +
        c.runs.reduce((n, r) => n + (r.leadAsking ? 1 : 0) + r.tasks.filter((t) => t.asking).length, 0);
    return {
        seated,
        tabled,
        chip,
        lit: c.agents.some((a) => a.state !== "idle") || tabled.some(runLit),
        asks,
        order,
        askKeys,
    };
}

// the floor to build: the one asked for when it holds a room, else the nearest one below it, else the lowest
function clampFloor(want: number, shown: readonly number[]): number {
    const f = Number.isFinite(want) ? Math.trunc(want) : 0;
    if (shown.includes(f)) {
        return f;
    }
    if (f > shown[shown.length - 1]) {
        return shown[shown.length - 1];
    }
    return [...shown].reverse().find((s) => s < f) ?? shown[0];
}

export function buildPlan(input: PlanInput): Plan {
    const width = Math.max(MIN_W, Math.round(input.width));
    const colW = Math.floor((width - 4 * WALL - HALL_W) / 2);
    const leftX = WALL;
    const hallX = leftX + colW + WALL;
    const rightX = hallX + HALL_W + WALL;
    const top = HWALL;
    // two rows of rooms and the wall between them fill the view, but a room is never shorter than ROOM_MIN_H
    const rowH = Math.max(ROOM_MIN_H, Math.floor(((input.height ?? 0) - top - HWALL - FACADE_H - HWALL) / 2));
    const bodyH = 2 * rowH + HWALL;
    const cap = capacityOf(colW, rowH);

    const cards = groupCards(input.agents, input.runs);
    const at = input.at ?? placeRooms(EMPTY_LAYOUT, projectsOf(input.agents, input.runs)).at;
    // only the projects with a card hold a room
    const placed: Placements = {};
    const fills = new Map<string, Fill>();
    for (const [name, place] of Object.entries(at)) {
        const c = cards.get(name);
        if (c != null) {
            placed[name] = place;
            fills.set(name, fillRoom(`room:${name}`, c, cap));
        }
    }
    const shown = floorsShown(placed);
    const floor = clampFloor(input.floor ?? 0, shown);
    // the projects of a floor, by slot
    const onFloor = (f: number) =>
        Object.keys(placed)
            .filter((n) => placed[n].floor === f)
            .sort((a, b) => placed[a].slot - placed[b].slot);
    const floors: FloorSummary[] = shown.map((f) => {
        const names = onFloor(f);
        return {
            floor: f,
            label: floorLabel(f),
            rooms: names,
            asks: names.reduce((n, p) => n + fills.get(p)!.asks, 0),
            lit: names.some((p) => fills.get(p)!.lit),
        };
    });
    const otherAsks = shown
        .filter((f) => f !== floor)
        .flatMap((f) => onFloor(f).flatMap((p) => fills.get(p)!.askKeys.map((key) => ({ key, floor: f }))));
    const slotOf = new Map<number, string>();
    for (const name of onFloor(floor)) {
        if (!slotOf.has(placed[name].slot)) {
            slotOf.set(placed[name].slot, name);
        }
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

    const placeDesks = (list: PlanAgent[], room: Room) => {
        const x0 = room.box.x + 24;
        const y0 = room.box.y + ROOM_TOP;
        list.forEach((a, i) => {
            const x = x0 + (i % cap.perRow) * DESK_DX;
            const y = y0 + Math.floor(i / cap.perRow) * DESK_DY;
            const away = input.away[a.id];
            const { state, ...look } = agentLook(a, input.now, away, input.night);
            desks.push({
                key: a.id,
                room: room.key,
                x,
                y,
                spot: { x: x + 40, y: y + DESK_SPOT_DY },
                ...look,
                name: a.name,
                tip: `${a.name} · ${state} (Enter opens the card)`,
                harness: a.harness,
            });
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

    // a run's lead and its first four tasks round the table of its zone; every seat is in the project room
    const placeSeats = (r: PlanRun, zone: Room, project: Room) => {
        const shownTasks = r.tasks.slice(0, TABLE_SEATS - 1);
        const far = Math.ceil((shownTasks.length + 1) / 2);
        // the table and its chairs stay SEAT_PAD off the zone's edges, so two zones side by side leave a lane between
        // their tables; with three people on the far side they sit closer than SEAT_DX
        const maxW = zone.box.w - 2 * SEAT_PAD;
        const dx = Math.min(SEAT_DX, Math.floor((maxW - 30) / far));
        const tx = zone.box.x + SEAT_PAD;
        const ty = zone.box.y + TABLE_TOP;
        zone.table = { x: tx, y: ty, w: maxW, h: 33 };
        if (r.tasks.length > shownTasks.length) {
            zone.more = r.tasks.length - shownTasks.length;
        }
        const spotY = zone.box.y + zone.box.h - 6;
        const lead = r.leadAsking
            ? { pose: "hand" as const, animated: true, bubble: "!" as const }
            : { pose: (r.done ? "doze" : "sit") as SeatPose, animated: false };
        seats.push({
            key: r.id,
            room: project.key,
            zone: zone.key,
            runId: r.id,
            x: tx + 20,
            bottom: ty + 6,
            spot: { x: tx + 38, y: spotY },
            ...lead,
            lane: 0,
            tip: `${r.title} · lead (Enter opens the run)`,
        });
        shownTasks.forEach((t, i) => {
            const n = i + 1; // seat 0 is the lead
            const farSide = n % 2 === 0;
            const k = Math.floor(n / 2);
            const x = farSide ? tx + 20 + k * dx : tx + 46 + k * dx;
            const look = taskLook(t);
            // the near side shows its back, but an asking worker raises a hand on either side
            const pose: SeatPose =
                look.pose === "empty" ? "empty" : farSide || look.pose === "hand" ? look.pose : "back";
            seats.push({
                key: seatKey(r, t),
                room: project.key,
                zone: zone.key,
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
        });
    };

    for (let slot = 0; slot < SLOTS; slot++) {
        const right = slot % 2 === 1;
        const x = right ? rightX : leftX;
        const y = top + Math.floor(slot / 2) * (rowH + HWALL);
        const box: Box = { x, y, w: colW, h: rowH };
        // high on the hall-side wall
        const door: Box = { x: right ? rightX - WALL : leftX + colW, y: y + 60, w: WALL, h: DOOR };
        (right ? rightDoors : leftDoors).push(door);
        const doorSide: DoorSide = right ? "left" : "right";
        const name = slotOf.get(slot);
        if (name == null) {
            rooms.push({
                key: `empty:${floor}:${slot}`,
                kind: "empty",
                box,
                door,
                doorSide,
                title: "Empty room",
                sub: "Drag a room here",
                lit: false,
                slot,
            });
            continue;
        }

        const c = cards.get(name)!;
        const fill = fills.get(name)!;
        const key = `room:${name}`;
        const sub = [
            c.agents.length ? plural(c.agents.length, "agent") : "",
            c.runs.length ? plural(c.runs.length, "run") : "",
        ]
            .filter(Boolean)
            .join(" · ");
        const project: Room = {
            key,
            kind: "agents",
            box,
            door,
            doorSide,
            title: name,
            sub: sub || "no one here",
            lit: fill.lit,
            slot,
        };
        rooms.push(project);
        placeDesks(fill.seated, project);

        const zy = y + rowH - MEET_H;
        fill.tabled.forEach((r, i) => {
            const done = r.tasks.filter((t) => t.state === "done").length;
            const zone: Room = {
                key: `meet:${r.id}`,
                kind: "meeting",
                box: { x: x + 8 + i * TABLE_W, y: zy, w: TABLE_W, h: MEET_H },
                title: r.title,
                sub: `run · ${done} of ${r.tasks.length} done`,
                lit: runLit(r),
                runId: r.id,
                screen: r.tasks.slice(0, 12).map(screenCell),
                parent: key,
            };
            rooms.push(zone);
            placeSeats(r, zone, project);
        });

        if (fill.chip) {
            const w = Math.ceil((fill.chip.text.length + 2) * CHIP_CHAR_W) + 14; // room for the "! " an ask puts first
            const cbox: Box = { x: x + colW - 14 - w, y: y + 8, w, h: CHIP_H };
            project.chip = {
                box: cbox,
                spot: { x: Math.round(cbox.x + w / 2), y: cbox.y + cbox.h + 22 },
                key: CHIP_KEY(key),
                ...fill.chip,
            };
        }
        // two plants, each on its own rule: top right while the first desk row has a place free, and in the strip's
        // left when no table is there (a room with no run: its strip is carpet with a plant)
        const plants: Point[] = [];
        if (fill.seated.length < cap.perRow) plants.push({ x: x + colW - 44, y: y + 64 });
        if (fill.tabled.length === 0) plants.push({ x: x + 16, y: zy + 50 });
        if (plants.length) project.plants = plants;
        order.push(...fill.order);
        asks.push(...fill.askKeys);
    }
    // a wall between each column's two rows
    walls.push({ x: leftX, y: top + rowH, w: colW, h: HWALL }, { x: rightX, y: top + rowH, w: colW, h: HWALL });

    // the hall: the lounge at its top, the notice board under it, the lift at its foot by the entrance
    const hall: Box = { x: hallX, y: top, w: HALL_W, h: bodyH };
    const lounge: Box = { x: hallX, y: top, w: HALL_W, h: LOUNGE_H };
    rooms.push({ key: "lounge", kind: "lounge", box: lounge, title: "Lounge", sub: "", lit: true });
    const foot = top + bodyH;
    const lift = {
        doors: { x: hallX + 20, y: foot - LIFT_H, w: LIFT_W, h: LIFT_H },
        dial: { x: hallX + 29, y: foot - LIFT_H - LIFT_DIAL_H, w: 52, h: LIFT_DIAL_H },
        spot: { x: hallX + 55, y: foot - LIFT_H - LIFT_DIAL_H - LIFT_LABEL_H },
    };

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
    // the notice board against the hall's left wall under the lounge, clear of the hall's lane on its right; the boss
    // stands under it
    const boardBox: Box = { x: hallX + 8, y: top + LOUNGE_H + BOARD_GAP, w: BOARD_W, h: BOARD_H };
    const board = {
        box: boardBox,
        spot: { x: boardBox.x + boardBox.w / 2, y: boardBox.y + boardBox.h + BOARD_SPOT_DY },
    };
    const loungers: Lounger[] = [];
    const loungeOverflow: string[] = [];
    for (const place of ["sofa", "coffee"] as const) {
        const free = LOUNGE_SPOTS.filter((s) => s.at === place);
        lounging
            .filter((l) => l.at === place)
            .sort(byIdle)
            .forEach((l, i) => {
                const s = free[i];
                if (s == null) {
                    loungeOverflow.push(l.agentId);
                    return;
                }
                const h = place === "sofa" ? SEATED_H : STANDING_H;
                const lx = lounge.x + s.x;
                const bottom = lounge.y + s.bottom;
                loungers.push({
                    agentId: l.agentId,
                    at: place,
                    x: lx,
                    bottom,
                    box: { x: lx, y: bottom - h, w: LOUNGE_PERSON_W, h },
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
        // the foot strip takes whatever the view has over the rooms: brick on G, a plain wall above
        height: Math.max(top + bodyH + FACADE_H, Math.floor(input.height ?? 0)),
        body: { x: 0, y: top, w: width, h: bodyH },
        hall,
        hallFloor: [hall],
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
        loungeMore: { x: lounge.x + 8, y: lounge.y + 106, w: 150, h: LOUNGE_LABEL_H },
        board,
        lift,
        floor,
        floors,
        ground: floor === 0,
        order,
        asks,
        otherAsks,
    };
}
