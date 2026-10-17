// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { PLAN_CELL, PLAN_SPRITES, spriteWidth } from "@/app/view/office/plansprite";
import { describe, expect, it } from "vitest";
import { BOSS_PX, canStand, canWalk } from "./officeboss";
import { EMPTY_LAYOUT, placeRooms, type Placements } from "./officelayout";
import {
    agentLook,
    BOSS_H,
    BOSS_HALF_W,
    BOSS_HEADROOM,
    buildPlan,
    cut,
    DOOR,
    HALL_W,
    HOME,
    HWALL,
    LOUNGE_H,
    LOUNGE_PERSON_W,
    MEET_H,
    MIN_W,
    peopleDrawn,
    POPUP_BIG_H,
    POPUP_BIG_W,
    POPUP_H,
    POPUP_W,
    popupBox,
    projectsOf,
    ROOM_TOP,
    taskLook,
    WALL,
    type Box,
    type PlanAgent,
    type PlanInput,
    type PlanRun,
    type PlanTask,
} from "./officeplanmodel";

const NOW = 1_000_000_000;
const ag = (id: string, o: Partial<PlanAgent> = {}): PlanAgent => ({
    id,
    name: id,
    project: "p",
    state: "working",
    finished: false,
    ...o,
});
const task = (id: string, state = "running", o: Partial<PlanTask> = {}): PlanTask => ({
    id,
    label: id,
    state,
    asking: false,
    ...o,
});
const run = (id: string, o: Partial<PlanRun> = {}): PlanRun => ({
    id,
    title: id,
    project: "p",
    createdTs: 1,
    done: false,
    leadAsking: false,
    tasks: [],
    ...o,
});
const plan = (agents: PlanAgent[], runs: PlanRun[] = [], o: Partial<PlanInput> = {}) =>
    buildPlan({ agents, runs, width: 1050, now: NOW, away: {}, night: false, ...o });
const overlaps = (a: Box, b: Box) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const inside = (p: { x: number; y: number }, boxes: Box[]) =>
    boxes.some((b) => p.x >= b.x && p.x < b.x + b.w && p.y >= b.y && p.y < b.y + b.h);
const within = (a: Box, b: Box) => a.x >= b.x && a.y >= b.y && a.x + a.w <= b.x + b.w && a.y + a.h <= b.y + b.h;
// the rooms that fill a slot, in slot order: a project's room or an empty one
const slotRooms = (p: ReturnType<typeof plan>) => p.rooms.filter((r) => r.kind === "agents" || r.kind === "empty");
const room = (p: ReturnType<typeof plan>, name = "p") => p.rooms.find((r) => r.key === `room:${name}`)!;
const zones = (p: ReturnType<typeof plan>) => p.rooms.filter((r) => r.kind === "meeting");

// seven agents (a1..a7) and three runs, r3 done and the earliest, in project p
const seven = Array.from({ length: 7 }, (_, i) => ag(`a${i + 1}`));
const three = [
    run("r1", { createdTs: 2, tasks: [task("t1")] }),
    run("r2", { createdTs: 3, tasks: [task("t1")] }),
    run("r3", { createdTs: 1, done: true, tasks: [task("t1", "done")] }),
];

describe("officeplanmodel", () => {
    describe("projectsOf", () => {
        it("lists Home first when an agent or a run has no project, then the names", () => {
            const agents = [
                ag("z1", { project: "zeta" }),
                ag("a1", { project: "alpha" }),
                ag("h1", { project: undefined }),
                ag("h2", { project: "  " }),
            ];
            expect(projectsOf(agents, [])).toEqual([HOME, "alpha", "zeta"]);
            // a run with no project is Home's too
            expect(projectsOf([ag("a", { project: "beta" })], [run("r", { project: undefined })])).toEqual([
                HOME,
                "beta",
            ]);
            expect(projectsOf([ag("a", { project: "beta" })], [])).toEqual(["beta"]);
            expect(projectsOf([], [])).toEqual([]);
        });

        it("sorts the names with localeCompare and trims them", () => {
            const agents = [
                ag("a", { project: "beta" }),
                ag("b", { project: " Alpha " }),
                ag("c", { project: "alpha2" }),
            ];
            expect(projectsOf(agents, [])).toEqual(["Alpha", "alpha2", "beta"]);
        });
    });

    describe("a floor of four slots", () => {
        const names = ["a", "b", "c", "d", "e"];
        const agents5 = names.map((n) => ag(n, { project: n }));
        const at: Placements = {
            a: { floor: 0, slot: 0 },
            b: { floor: 0, slot: 1 },
            c: { floor: 0, slot: 2 },
            d: { floor: 0, slot: 3 },
            e: { floor: 1, slot: 1 },
        };

        it("builds four project rooms at the four slots, the left column's doors on the right", () => {
            const p = plan(agents5, [], { floor: 0, at });
            const rooms = slotRooms(p);
            expect(rooms.map((r) => r.kind)).toEqual(["agents", "agents", "agents", "agents"]);
            expect(rooms.map((r) => r.title)).toEqual(["a", "b", "c", "d"]);
            expect(rooms.map((r) => r.slot)).toEqual([0, 1, 2, 3]);
            const colW = 392;
            const rightX = WALL + colW + WALL + HALL_W + WALL;
            const rowH = 300;
            rooms.forEach((r, i) => {
                const right = i % 2 === 1;
                expect(r.key).toBe(`room:${names[i]}`);
                expect(r.box, r.title).toEqual({
                    x: right ? rightX : WALL,
                    y: i < 2 ? HWALL : HWALL + rowH + HWALL,
                    w: colW,
                    h: rowH,
                });
                expect(r.doorSide, r.title).toBe(right ? "left" : "right");
                // the door is high on the hall-side wall, as far under its room's top as the boss's feet come
                expect(r.door, r.title).toEqual({
                    x: right ? rightX - WALL : WALL + colW,
                    y: r.box.y + BOSS_HEADROOM,
                    w: WALL,
                    h: DOOR,
                });
            });
        });

        it("fills the slots a floor has no room for with dark empty rooms", () => {
            const p = plan(agents5, [], { floor: 1, at });
            const rooms = slotRooms(p);
            expect(rooms.map((r) => r.kind)).toEqual(["empty", "agents", "empty", "empty"]);
            expect(rooms[1].title).toBe("e");
            for (const r of rooms.filter((x) => x.kind === "empty")) {
                expect(r).toMatchObject({ title: "Empty room", sub: "Drag a room here", lit: false });
                expect(r.door).toBeDefined();
                expect(r.runId).toBeUndefined();
            }
            // an empty room still has its own key per floor and slot
            expect(new Set(rooms.map((r) => r.key)).size).toBe(4);
        });

        it("counts the project's agents and runs in the room's sub, as today", () => {
            const p = plan(seven, three);
            expect(room(p).sub).toBe("7 agents · 3 runs");
            expect(plan([ag("a")]).rooms.find((r) => r.kind === "agents")?.sub).toBe("1 agent");
            expect(plan([], [run("r")]).rooms.find((r) => r.kind === "agents")?.sub).toBe("1 run");
        });

        it("builds the floor asked for, clamped to the ones that hold a room", () => {
            const at2: Placements = { ...at, e: { floor: 2, slot: 0 } };
            expect(plan(agents5, [], { floor: 7, at }).floor).toBe(1);
            expect(plan(agents5, [], { floor: -2, at }).floor).toBe(0);
            expect(plan(agents5, [], { floor: 1, at: at2 }).floor).toBe(0);
            expect(plan(agents5, [], { floor: 2, at: at2 }).floor).toBe(2);
            expect(slotRooms(plan(agents5, [], { floor: 7, at })).map((r) => r.kind)).toEqual([
                "empty",
                "agents",
                "empty",
                "empty",
            ]);
        });

        it("seats on a floor only the projects placed on it", () => {
            const p = plan(agents5, [], { floor: 1, at });
            expect(p.desks.map((d) => d.key)).toEqual(["e"]);
            expect(plan(agents5, [], { floor: 0, at }).desks.map((d) => d.key)).toEqual(["a", "b", "c", "d"]);
        });
    });

    describe("a room's size", () => {
        it.each([
            [1050, 650, 392, 300, 676],
            [1600, 1000, 667, 453, 1000],
            [1424, 800, 579, 353, 800],
            [900, 400, 317, 300, 676],
        ])("is %i x %i wide and tall → %i x %i, the floor %i tall", (width, height, w, h, total) => {
            const p = plan([ag("a")], [], { width, height });
            const r = room(p);
            expect(r.box.w).toBe(w);
            expect(r.box.h).toBe(h);
            expect(p.width).toBe(width);
            // two rooms and the wall between them, the foot strip under; a shorter view scrolls the floor
            expect(p.height).toBe(total);
            expect(p.body.h).toBe(2 * h + HWALL);
            expect(p.body.y + p.body.h).toBeLessThanOrEqual(p.height - 40);
        });

        it("keeps its minimum width in a narrow Cockpit", () => {
            expect(plan([ag("a")], [], { width: 600 }).width).toBe(MIN_W);
        });

        it("fills the height it is given, and never goes under two 300 px rooms", () => {
            expect(plan([ag("a")], [], { height: 1200 }).height).toBe(1200);
            expect(plan([ag("a")], [], { height: 100 }).height).toBe(676);
            expect(plan([ag("a")]).height).toBe(676);
        });
    });

    describe("capacity", () => {
        it("seats 3 desks and 2 tables in a 1050 x 650 room, and puts the rest in the chip", () => {
            const p = plan(seven, three, { width: 1050, height: 650 });
            expect(p.desks.map((d) => d.key)).toEqual(["a1", "a2", "a3"]);
            // runs at work take the tables before the one that is done, then by start
            expect(zones(p).map((z) => z.runId)).toEqual(["r1", "r2"]);
            expect(room(p).chip).toMatchObject({
                text: "+4 agents · +1 run",
                ask: false,
                key: "chip:room:p",
                hidden: ["a4", "a5", "a6", "a7", "r3"],
            });
        });

        it("seats 4 desks and 2 tables in a 1424 x 800 room", () => {
            const p = plan(seven, three, { width: 1424, height: 800 });
            expect(p.desks).toHaveLength(4);
            expect(zones(p)).toHaveLength(2);
            expect(room(p).chip?.text).toBe("+3 agents · +1 run");
        });

        it("seats 10 desks and 3 tables in a 1600 x 1000 room", () => {
            const four = [...three, run("r4", { createdTs: 4, tasks: [task("t1"), task("t2", "pending")] })];
            const p = plan(seven, four, { width: 1600, height: 1000 });
            // seven agents fill seven of the ten desks, and the three runs at work take the three tables
            expect(p.desks).toHaveLength(7);
            expect(zones(p).map((z) => z.runId)).toEqual(["r1", "r2", "r4"]);
            expect(room(p).chip).toMatchObject({ text: "+1 run", hidden: ["r3"] });
            const twelve = Array.from({ length: 12 }, (_, i) => ag(`a${String(i + 1).padStart(2, "0")}`));
            const full = plan(twelve, four, { width: 1600, height: 1000 });
            expect(full.desks).toHaveLength(10);
            expect(zones(full)).toHaveLength(3);
            expect(room(full).chip?.text).toBe("+2 agents · +1 run");
        });

        it("has no chip while everything fits", () => {
            const p = plan([ag("a"), ag("b")], [run("r1", { tasks: [task("t")] })]);
            expect(room(p).chip).toBeUndefined();
        });

        it("makes the chip a stop in the office order, and asks when a hidden agent or run does", () => {
            const base = plan(seven, three);
            expect(base.asks).toEqual([]);
            expect(base.order.slice(-1)).toEqual(["chip:room:p"]);

            const hiddenAgent = plan([...seven.slice(0, 6), ag("a7", { state: "asking" })], three);
            expect(room(hiddenAgent).chip?.ask).toBe(true);
            expect(hiddenAgent.asks).toEqual(["chip:room:p"]);

            const seatedAgent = plan([ag("a1", { state: "asking" }), ...seven.slice(1)], three);
            expect(room(seatedAgent).chip?.ask).toBe(false);
            expect(seatedAgent.asks).toEqual(["a1"]);

            const hiddenLead = plan(seven, [three[0], three[1], { ...three[2], leadAsking: true }]);
            expect(room(hiddenLead).chip?.ask).toBe(true);
            const hiddenTask = plan(seven, [
                three[0],
                three[1],
                { ...three[2], tasks: [task("t1", "done", { asking: true })] },
            ]);
            expect(room(hiddenTask).chip?.ask).toBe(true);
            expect(hiddenTask.asks).toEqual(["chip:room:p"]);
        });

        it("puts the chip at the right end of the title row, with the boss's spot under it", () => {
            const p = plan(seven, three);
            const r = room(p);
            const { box, spot } = r.chip!;
            expect(box.y).toBe(r.box.y + 8);
            expect(box.x + box.w).toBe(r.box.x + r.box.w - 14);
            expect(within(box, r.box)).toBe(true);
            expect(spot.y).toBeGreaterThan(box.y + box.h);
            expect(spot.x).toBeGreaterThanOrEqual(box.x);
            expect(spot.x).toBeLessThanOrEqual(box.x + box.w);
            expect(canStand(p, spot)).toBe(true);
            // the chip's spot is clear of every desk's box
            for (const d of p.desks) {
                expect(overlaps({ x: spot.x, y: spot.y, w: 1, h: 1 }, { x: d.x - 8, y: d.y - 30, w: 96, h: 100 })).toBe(
                    false
                );
            }
        });

        it("keeps every place when only a state changes", () => {
            const a = plan(seven, three);
            const idle = seven.map((x) => ({ ...x, state: "idle" as const, idleSince: NOW - 1000, finished: true }));
            const b = plan(idle, three);
            expect(b.desks.map((d) => [d.key, d.x, d.y])).toEqual(a.desks.map((d) => [d.key, d.x, d.y]));
            expect(room(b).chip?.text).toBe(room(a).chip?.text);
            // working agents turned idle and back: the same desks again
            const c = plan(
                seven.map((x, i) => (i % 2 ? { ...x, state: "asking" as const } : x)),
                three
            );
            expect(c.desks.map((d) => [d.key, d.x, d.y])).toEqual(a.desks.map((d) => [d.key, d.x, d.y]));
            // a task changing state moves no table
            const d = plan(seven, [
                { ...three[0], tasks: [task("t1", "done")] },
                { ...three[1], tasks: [task("t1", "failed")] },
                three[2],
            ]);
            expect(zones(d).map((z) => [z.runId, z.box])).toEqual(zones(a).map((z) => [z.runId, z.box]));
        });

        it("hands a table to the next run when one finishes", () => {
            const runs = [
                run("r1", { createdTs: 1, tasks: [task("t")] }),
                run("r2", { createdTs: 2, tasks: [task("t")] }),
                run("r3", { createdTs: 3, tasks: [task("t")] }),
            ];
            expect(zones(plan([ag("a")], runs)).map((z) => z.runId)).toEqual(["r1", "r2"]);
            expect(room(plan([ag("a")], runs)).chip?.hidden).toEqual(["r3"]);
            const finished = [{ ...runs[0], done: true }, runs[1], runs[2]];
            expect(zones(plan([ag("a")], finished)).map((z) => z.runId)).toEqual(["r2", "r3"]);
            expect(room(plan([ag("a")], finished)).chip?.hidden).toEqual(["r1"]);
        });
    });

    describe("tables", () => {
        it("sets each run on a table zone at the room's foot, in a room of its own kind", () => {
            const p = plan([ag("a")], [run("r2", { createdTs: 2 }), run("r1", { createdTs: 1 })]);
            const r = room(p);
            const z = zones(p);
            expect(z.map((x) => x.runId)).toEqual(["r1", "r2"]);
            z.forEach((x, i) => {
                expect(x).toMatchObject({ kind: "meeting", key: `meet:${x.runId}`, parent: r.key });
                expect(x.box).toEqual({ x: r.box.x + 8 + i * 190, y: r.box.y + r.box.h - MEET_H, w: 190, h: MEET_H });
                expect(x.door).toBeUndefined();
                expect(x.table).toBeDefined();
                expect(within(x.table!, x.box)).toBe(true);
                expect(within(x.box, r.box)).toBe(true);
            });
            // a zone sits after its room, so a point in both is the project room's
            expect(p.rooms.indexOf(z[0])).toBeGreaterThan(p.rooms.indexOf(r));
        });

        it("titles a zone by its run, with the count of tasks done", () => {
            const p = plan([ag("a")], [run("r", { title: "Land queue", tasks: [task("a", "done"), task("b")] })]);
            expect(zones(p)[0]).toMatchObject({ title: "Land queue", sub: "run · 1 of 2 done", lit: true });
        });

        it("seats the lead first and alternates the workers' sides, with +N past four tasks", () => {
            const p = plan([], [run("r", { tasks: Array.from({ length: 13 }, (_, i) => task(`t${i + 1}`)) })]);
            expect(p.seats).toHaveLength(5);
            expect(p.seats[0].key).toBe("r");
            expect(p.seats[1].pose).toBe("back");
            expect(p.seats[2].pose).toBe("sit");
            expect(zones(p)[0].more).toBe(9);
            expect(p.order.slice(0, 3)).toEqual(["r", "r:t1", "r:t2"]);
            expect(
                zones(plan([], [run("r", { tasks: Array.from({ length: 4 }, (_, i) => task(`t${i}`)) })]))[0].more
            ).toBeUndefined();
        });

        it("puts each seat in the project room and names its table", () => {
            const p = plan([ag("a")], [run("r1", { tasks: [task("t1"), task("t2")] }), run("r2")]);
            expect(p.seats.filter((s) => s.runId === "r1").map((s) => [s.room, s.zone])).toEqual([
                ["room:p", "meet:r1"],
                ["room:p", "meet:r1"],
                ["room:p", "meet:r1"],
            ]);
            expect(p.seats.filter((s) => s.runId === "r2")).toEqual([expect.objectContaining({ zone: "meet:r2" })]);
        });

        it("caps the wall screen at twelve cells", () => {
            const p = plan([], [run("r", { tasks: Array.from({ length: 14 }, (_, i) => task(`t${i}`, "done")) })]);
            expect(zones(p)[0].screen).toHaveLength(12);
        });

        it("shows each task on its run's screen", () => {
            const p = plan(
                [],
                [
                    run("r", {
                        tasks: [task("a", "done"), task("b", "running"), task("c", "pending"), task("d", "failed")],
                    }),
                ]
            );
            expect(zones(p)[0].screen).toEqual(["done", "work", "wait", "fail"]);
        });

        it("raises a hand on either side of the table when the worker's agent is asking", () => {
            const p = plan(
                [],
                [
                    run("r", {
                        tasks: [task("t1", "running", { asking: true }), task("t2", "running", { asking: true })],
                    }),
                ]
            );
            expect(p.seats[1]).toMatchObject({ pose: "hand", animated: true, bubble: "!" });
            expect(p.seats[2]).toMatchObject({ pose: "hand", animated: true, bubble: "!" });
            expect(p.asks).toEqual(["r:t1", "r:t2"]);
        });

        it("fits a full table and its seats inside its zone, at the minimum width too", () => {
            const tasks = Array.from({ length: 13 }, (_, i) => task(`t${i + 1}`));
            for (const width of [MIN_W, 1050, 1600]) {
                const p = plan([], [run("r", { tasks })], { width });
                const z = zones(p)[0];
                const t = z.table!;
                expect(within(t, z.box), `table at ${width}`).toBe(true);
                expect(p.seats).toHaveLength(5);
                for (const s of p.seats) {
                    expect(s.x, `${s.key} at ${width}`).toBeGreaterThanOrEqual(z.box.x);
                    // a seated person is 12 cells of 3 px
                    expect(s.x + 36, `${s.key} at ${width}`).toBeLessThanOrEqual(z.box.x + z.box.w);
                    expect(s.bottom, `${s.key} at ${width}`).toBeLessThanOrEqual(z.box.y + z.box.h);
                    expect(s.spot.x, `${s.key} at ${width}`).toBeLessThanOrEqual(z.box.x + z.box.w);
                    expect(canStand(p, s.spot), `${s.key} spot at ${width}`).toBe(true);
                }
            }
        });

        it("keeps two zones side by side without overlap, and a seat inside its own", () => {
            const runs = [0, 1, 2].map((i) =>
                run(`r${i}`, { createdTs: i, tasks: Array.from({ length: 5 }, (_, k) => task(`t${k}`)) })
            );
            const p = plan([ag("a")], runs, { width: 1600, height: 1000 });
            const z = zones(p);
            expect(z).toHaveLength(3);
            for (let i = 0; i < z.length; i++) {
                for (let j = i + 1; j < z.length; j++) {
                    expect(overlaps(z[i].box, z[j].box), `${i} ${j}`).toBe(false);
                }
            }
            for (const s of p.seats) {
                const own = z.find((x) => x.key === s.zone)!;
                expect(s.x, s.key).toBeGreaterThanOrEqual(own.box.x);
                expect(s.x + 36, s.key).toBeLessThanOrEqual(own.box.x + own.box.w);
            }
        });

        it("keys a task seat by its card row when it has one", () => {
            const p = plan([], [run("r", { tasks: [task("t1", "running", { key: "row:x" })] })]);
            expect(p.seats[1].key).toBe("row:x");
        });
    });

    describe("a room without a run", () => {
        it("has no table at all, and a plant", () => {
            const p = plan([ag("a")]);
            expect(zones(p)).toHaveLength(0);
            expect(room(p).plants?.length).toBeGreaterThan(0);
            expect(p.seats).toHaveLength(0);
        });

        it("has both plants when the first desk row has a place free and there is no run", () => {
            const r = room(plan([ag("a")]));
            expect(r.plants).toEqual([
                { x: r.box.x + r.box.w - 44, y: r.box.y + ROOM_TOP },
                { x: r.box.x + 16, y: r.box.y + r.box.h - MEET_H + 50 },
            ]);
        });

        it("keeps its plants out of the doorway and off the desks", () => {
            // p's door is on its right, by the first desk row's free place; q's on its left
            const p = plan([ag("a"), ag("b"), ag("c", { project: "q" })]);
            const rooms = [room(p), room(p, "q")];
            expect(rooms.map((r) => r.doorSide)).toEqual(["right", "left"]);
            for (const r of rooms) {
                const d = r.door!;
                // the boss's body as it walks through: its feet anywhere in the door, its head BOSS_H above them
                const way: Box = { x: d.x - BOSS_HALF_W, y: d.y - BOSS_H, w: d.w + 2 * BOSS_HALF_W, h: d.h + BOSS_H };
                expect(r.plants, r.key).toHaveLength(2);
                for (const pl of r.plants!) {
                    const drawn: Box = { x: pl.x, y: pl.y, w: 30, h: 45 }; // scenery.ts's plant, leaves and pot
                    expect(overlaps(drawn, way), `${r.key} ${JSON.stringify(pl)}`).toBe(false);
                    for (const k of p.desks.filter((k) => k.room === r.key)) {
                        const desk: Box = { x: k.x - 8, y: k.y - 20, w: 96, h: 100 }; // officeboss.ts's furniture box
                        expect(overlaps(drawn, desk), `${r.key} ${k.key}`).toBe(false);
                    }
                }
            }
        });

        it("has the strip's plant only when the first row is full and there is no run", () => {
            const p = plan(seven, []);
            const r = room(p);
            expect(p.desks).toHaveLength(3);
            expect(r.plants).toEqual([{ x: r.box.x + 16, y: r.box.y + r.box.h - MEET_H + 50 }]);
        });

        it("has the desk row's plant only when a run sits at a table and the first row has a place free", () => {
            const p = plan([ag("a")], [run("r")]);
            const r = room(p);
            expect(zones(p)).toHaveLength(1);
            expect(r.plants).toEqual([{ x: r.box.x + r.box.w - 44, y: r.box.y + ROOM_TOP }]);
        });

        it("has no plant when the first row is full and a table fills the strip", () => {
            expect(room(plan(seven, three)).plants).toBeUndefined();
        });
    });

    describe("desks", () => {
        it("sets desks in rows by name, then id, 116 apart and 110 between rows", () => {
            const wide = { width: 1600, height: 1000 };
            const p = plan([ag("d"), ag("c"), ag("b"), ag("a"), ag("a2", { name: "a" }), ag("e"), ag("f")], [], wide);
            expect(p.desks.map((d) => d.key)).toEqual(["a", "a2", "b", "c", "d", "e", "f"]);
            const [a, a2, b, c, , e] = p.desks;
            expect(a2.x - a.x).toBe(116);
            expect(b.x - a2.x).toBe(116);
            const r = room(p);
            expect(a.x).toBe(r.box.x + 24);
            expect(a.y).toBe(r.box.y + 104);
            // five to a row at this width: the sixth starts the second
            expect(e.x).toBe(a.x);
            expect(e.y - a.y).toBe(110);
            expect(c.y).toBe(a.y);
        });

        it("keeps every desk, with its person and labels, clear of the others and of every table", () => {
            const people = Array.from({ length: 14 }, (_, i) => ag(`a${String(i).padStart(2, "0")}`));
            const runs = [0, 1, 2, 3].map((i) => run(`r${i}`, { createdTs: i, tasks: [task("t")] }));
            for (const [width, height] of [
                [1050, 650],
                [1600, 1000],
            ]) {
                const p = plan(people, runs, { width, height });
                // the desk, the person above it, and both label rows under it
                const box = (d: { x: number; y: number }): Box => ({ x: d.x - 8, y: d.y - 30, w: 96, h: 100 });
                expect(p.desks.length).toBeGreaterThan(0);
                for (let i = 0; i < p.desks.length; i++) {
                    const r = p.rooms.find((x) => x.key === p.desks[i].room)!;
                    expect(within(box(p.desks[i]), r.box), `${p.desks[i].key} in its room at ${width}`).toBe(true);
                    for (let j = i + 1; j < p.desks.length; j++) {
                        expect(
                            overlaps(box(p.desks[i]), box(p.desks[j])),
                            `${p.desks[i].key} ${p.desks[j].key} at ${width}`
                        ).toBe(false);
                    }
                    for (const z of zones(p)) {
                        expect(overlaps(box(p.desks[i]), z.box), `${p.desks[i].key} ${z.key} at ${width}`).toBe(false);
                    }
                }
            }
        });

        it("stands the boss in front of a desk, between its row and the next, where it may walk", () => {
            const p = plan([ag("a")], [], { width: 1600, height: 1000 });
            const d = p.desks[0];
            expect(d.spot).toEqual({ x: d.x + 40, y: d.y + 84 });
            expect(canStand(p, d.spot)).toBe(true);
            // two desk rows and three tables: no spot is inside another desk's or a table's furniture
            const people = Array.from({ length: 12 }, (_, i) => ag(`a${String(i).padStart(2, "0")}`));
            const runs = [0, 1, 2].map((i) => run(`r${i}`, { createdTs: i, tasks: [task("t1"), task("t2")] }));
            const big = plan(people, runs, { width: 1600, height: 1000 });
            expect(big.desks.some((x) => x.y > big.desks[0].y)).toBe(true);
            for (const s of [...big.desks, ...big.seats]) {
                expect(canWalk(big, s.spot), s.key).toBe(true);
            }
        });
    });

    describe("the hall", () => {
        const p = plan([ag("a")]);
        it("keeps the lounge at its top and the notice board under it", () => {
            expect(p.hall).toEqual({ x: p.hall.x, y: HWALL, w: HALL_W, h: p.body.h });
            expect(p.lounge).toEqual({ x: p.hall.x, y: p.hall.y, w: HALL_W, h: LOUNGE_H });
            expect(p.board.box).toEqual({ x: p.hall.x + 8, y: p.hall.y + LOUNGE_H + 16, w: 96, h: 96 });
            expect(p.hallFloor).toEqual([p.hall]);
        });

        it("has the lift at its foot: doors, a dial over them, and a spot in front", () => {
            const { doors, dial, spot } = p.lift;
            const foot = p.hall.y + p.hall.h;
            expect(doors).toEqual({ x: p.hall.x + 20, y: foot - 68, w: 70, h: 68 });
            expect(dial).toEqual({ x: p.hall.x + 29, y: foot - 94, w: 52, h: 26 });
            expect(canStand(p, spot)).toBe(true);
            expect(inside(spot, p.hallFloor)).toBe(true);
            expect(spot.x).toBeGreaterThanOrEqual(doors.x);
            expect(spot.x).toBeLessThanOrEqual(doors.x + doors.w);
            expect(spot.y).toBeLessThan(doors.y);
            expect(within(doors, p.hall)).toBe(true);
            expect(overlaps(doors, p.board.box)).toBe(false);
            expect(overlaps(dial, p.board.box)).toBe(false);
        });

        it("stands the boss clear of the dial and the strip over it that holds `Floor n`", () => {
            const { dial, spot } = p.lift;
            const label = { x: dial.x, y: dial.y - 24, w: dial.w, h: 24 };
            // the boss is the pet: its svg stands on its feet at the spot, BOSS_PX wide and tall
            const body = { x: spot.x - BOSS_PX / 2, y: spot.y - BOSS_PX, w: BOSS_PX, h: BOSS_PX };
            expect(overlaps(body, dial)).toBe(false);
            expect(overlaps(body, label)).toBe(false);
            // and it stays under the notice board's spot (the shortest view is the tight one)
            expect(body.y).toBeGreaterThan(p.board.spot.y);
        });

        it("builds the same hall on every floor", () => {
            const at: Placements = { a: { floor: 0, slot: 0 }, b: { floor: 1, slot: 0 } };
            const two = [ag("a", { project: "a" }), ag("b", { project: "b" })];
            const g = plan(two, [], { floor: 0, at });
            const one = plan(two, [], { floor: 1, at });
            expect(one.board).toEqual(g.board);
            expect(one.lift).toEqual(g.lift);
            expect(one.lounge).toEqual(g.lounge);
            expect(one.hall).toEqual(g.hall);
        });
    });

    describe("the floors", () => {
        const names = ["a", "b", "c", "d", "e", "f"];
        const at: Placements = {
            a: { floor: 0, slot: 0 },
            b: { floor: 0, slot: 1 },
            c: { floor: 0, slot: 2 },
            d: { floor: 0, slot: 3 },
            e: { floor: 1, slot: 1 },
            f: { floor: 2, slot: 0 },
        };
        const agents6 = (over: Record<string, Partial<PlanAgent>> = {}) =>
            names.map((n) => ag(n, { project: n, ...over[n] }));

        it("lists every floor that holds a room, with its rooms, asks and lights", () => {
            const p = plan(
                agents6({
                    d: { state: "asking" },
                    e: { state: "asking" },
                    f: { state: "idle", idleSince: NOW - 1000, finished: true },
                }),
                [run("rd", { project: "d", leadAsking: true, tasks: [task("t", "running", { asking: true })] })],
                { floor: 0, at }
            );
            expect(p.floors).toEqual([
                { floor: 0, label: "G", rooms: ["a", "b", "c", "d"], asks: 3, lit: true },
                { floor: 1, label: "1", rooms: ["e"], asks: 1, lit: true },
                { floor: 2, label: "2", rooms: ["f"], asks: 0, lit: false },
            ]);
            expect(p.floor).toBe(0);
        });

        it("summarises the same floors whichever one is built", () => {
            const agents = agents6({ e: { state: "asking" } });
            const g = plan(agents, [], { floor: 0, at });
            expect(plan(agents, [], { floor: 1, at }).floors).toEqual(g.floors);
            expect(plan(agents, [], { floor: 2, at }).floors).toEqual(g.floors);
        });

        it("holds this floor's asks, and lists the other floors' in floor order, then office order", () => {
            const agents = agents6({ b: { state: "asking" }, e: { state: "asking" }, f: { state: "asking" } });
            const g = plan(agents, [], { floor: 0, at });
            expect(g.asks).toEqual(["b"]);
            expect(g.otherAsks).toEqual([
                { key: "e", floor: 1 },
                { key: "f", floor: 2 },
            ]);
            const one = plan(agents, [], { floor: 1, at });
            expect(one.asks).toEqual(["e"]);
            expect(one.otherAsks).toEqual([
                { key: "b", floor: 0 },
                { key: "f", floor: 2 },
            ]);
        });

        it("lists the asks of a chip, a lead and a task on another floor, as the floor itself would", () => {
            // project e is on floor 1 with seven agents (one hidden asks) and two runs
            const e7 = Array.from({ length: 7 }, (_, i) =>
                ag(`e${i + 1}`, { project: "e", state: i === 6 ? "asking" : "working" })
            );
            const runs = [
                run("re", { project: "e", leadAsking: true, tasks: [task("t1", "running", { asking: true })] }),
            ];
            const agents = [...agents6().filter((x) => x.project !== "e"), ...e7];
            const g = plan(agents, runs, { floor: 0, at });
            const one = plan(agents, runs, { floor: 1, at });
            expect(g.otherAsks.filter((x) => x.floor === 1).map((x) => x.key)).toEqual(one.asks);
            expect(one.asks).toEqual(["re", "re:t1", "chip:room:e"]);
            expect(g.floors.find((f) => f.floor === 1)?.asks).toBe(3);
            // every floor: its own asks are what the others list for it
            for (const f of [0, 1, 2]) {
                const built = plan(agents, runs, { floor: f, at });
                const seen = [0, 1, 2]
                    .filter((x) => x !== f)
                    .flatMap((x) => plan(agents, runs, { floor: x, at }).otherAsks.filter((o) => o.floor === f))
                    .map((o) => o.key);
                expect(new Set(seen)).toEqual(new Set(built.asks));
                expect(built.otherAsks.every((o) => o.floor !== f)).toBe(true);
            }
        });

        it("is true of ground only on floor 0, and keeps the entrance everywhere", () => {
            const g = plan(agents6(), [], { floor: 0, at });
            const up = plan(agents6(), [], { floor: 1, at });
            expect(g.ground).toBe(true);
            expect(up.ground).toBe(false);
            expect(g.entrance).toEqual(up.entrance);
            expect(g.entrance.w).toBeGreaterThan(0);
        });

        it("builds G with the rooms arranged automatically when given no floor or arrangement", () => {
            const agents = [
                ag("z", { project: "zeta" }),
                ag("h", { project: undefined }),
                ag("a", { project: "alpha" }),
            ];
            const runs = [run("r", { project: "alpha" })];
            const auto = plan(agents, runs);
            expect(auto).toEqual(
                plan(agents, runs, { floor: 0, at: placeRooms(EMPTY_LAYOUT, projectsOf(agents, runs)).at })
            );
            expect(slotRooms(auto).map((r) => r.title)).toEqual([HOME, "alpha", "zeta", "Empty room"]);
        });
    });

    describe("the office order", () => {
        it("walks the rooms by slot: desks, then the tables' seats, then the chip", () => {
            const mk = (project: string) => Array.from({ length: 4 }, (_, i) => ag(`${project}${i + 1}`, { project }));
            const runs = [
                run("ra", { project: "a", tasks: [task("t1", "running", { key: "ra:t1" })] }),
                run("rb", { project: "b" }),
            ];
            const p = plan([...mk("b"), ...mk("a")], runs);
            expect(p.order).toEqual([
                ...["a1", "a2", "a3", "ra", "ra:t1", "chip:room:a"],
                ...["b1", "b2", "b3", "rb", "chip:room:b"],
            ]);
        });

        it("lists the asks in office order", () => {
            const p = plan(
                [ag("b", { state: "asking" }), ag("a")],
                [run("r", { tasks: [task("t", "running", { asking: true })] })]
            );
            expect(p.asks).toEqual(["b", "r:t"]);
        });
    });

    describe("walls and doors", () => {
        it("opens a door from every room onto the hall, and leaves the hall's walls open there", () => {
            const p = plan([ag("a"), ag("h", { project: undefined })], [run("r")]);
            const doors = p.rooms.filter((r) => r.door).map((r) => r.door!);
            // two project rooms and two empty ones
            expect(doors).toHaveLength(4);
            for (const d of doors) {
                for (const w of p.walls) {
                    expect(overlaps(d, w), JSON.stringify({ d, w })).toBe(false);
                }
            }
            for (const r of slotRooms(p)) {
                const d = r.door!;
                const outer = { x: d.x + (r.doorSide === "right" ? d.w + 14 : -14), y: d.y + d.h / 2 };
                expect(inside(outer, p.hallFloor), `${r.key} door opens onto the hall`).toBe(true);
                const inner = { x: d.x + (r.doorSide === "right" ? -14 : d.w + 14), y: d.y + d.h / 2 };
                expect(inside(inner, [r.box]), `${r.key} door opens into its room`).toBe(true);
            }
            const left = slotRooms(p)[0];
            expect(left.door!.x).toBe(left.box.x + left.box.w);
            expect(p.hall.w).toBe(HALL_W);
        });

        it("walls each column between its rows, the outer walls round the building", () => {
            const p = plan([ag("a")]);
            const [a, b, c] = slotRooms(p);
            const between = p.walls.filter((w) => w.h === HWALL && w.y === a.box.y + a.box.h);
            expect(between.map((w) => w.x).sort((x, y) => x - y)).toEqual([a.box.x, b.box.x]);
            for (const w of between) {
                expect(w.w).toBe(a.box.w);
                expect(w.y + w.h).toBe(c.box.y);
            }
            expect(p.walls).toContainEqual({ x: 0, y: 0, w: p.width, h: HWALL });
            expect(p.walls).toContainEqual({ x: 0, y: 0, w: WALL, h: HWALL + p.body.h });
        });

        it("cuts a wall around its doors", () => {
            expect(cut({ x: 0, y: 0, w: WALL, h: 100 }, [{ x: 0, y: 40, w: WALL, h: 20 }])).toEqual([
                { x: 0, y: 0, w: WALL, h: 40 },
                { x: 0, y: 60, w: WALL, h: 40 },
            ]);
        });
    });

    describe("the notice board", () => {
        const homeAgents = (n: number) => Array.from({ length: n }, (_, i) => ag(`h${i}`, { project: undefined }));
        const idle = ag("i1", { state: "idle", idleSince: NOW - 700_000 });
        const many = [...["a", "b", "c", "d"].map((x) => ag(`${x}1`, { project: x })), ...homeAgents(5), idle];
        const manyRuns = [run("r1", { project: "a", tasks: [task("t1"), task("t2")] }), run("r2", { project: "d" })];
        const plans: [string, ReturnType<typeof plan>][] = [
            ["one project, one agent", plan([ag("a")])],
            ["Home and a project", plan([ag("a"), ...homeAgents(1)])],
            ["a full ground floor, runs and a lounger", plan(many, manyRuns, { away: { i1: "sofa" } })],
            ["the floor above it", plan(many, manyRuns, { away: { i1: "sofa" }, floor: 1 })],
            ["a short, narrow view", plan(many, manyRuns, { width: 900, height: 400 })],
        ];

        it.each(plans)("stands in the hall below the lounge, against its left wall: %s", (_, p) => {
            const b = p.board.box;
            expect(b.x).toBe(p.hall.x + 8);
            expect(b.y).toBeGreaterThanOrEqual(p.lounge.y + p.lounge.h);
            expect(b.x + b.w).toBeLessThanOrEqual(p.hall.x + p.hall.w);
            expect(b.y + b.h).toBeLessThanOrEqual(p.hall.y + p.hall.h);
        });

        it.each(plans)("overlaps no room, desk, lounger or the lift: %s", (_, p) => {
            const b = p.board.box;
            for (const r of p.rooms) {
                expect(overlaps(b, r.box), r.key).toBe(false);
            }
            for (const d of p.desks) {
                expect(overlaps(b, { x: d.x - 8, y: d.y - 20, w: 96, h: 100 }), d.key).toBe(false);
            }
            for (const l of p.loungers) {
                expect(overlaps(b, l.box), l.agentId).toBe(false);
            }
            expect(overlaps(b, p.lift.doors)).toBe(false);
            expect(overlaps(b, p.lift.dial)).toBe(false);
        });

        it.each(plans)("has its spot under it, on the hall's floor: %s", (_, p) => {
            const { box, spot } = p.board;
            expect(spot).toEqual({ x: box.x + box.w / 2, y: box.y + box.h + 22 });
            expect(canStand(p, spot)).toBe(true);
            expect(spot.y).toBeLessThan(p.lift.dial.y);
        });

        it("keeps its place when only a state changes", () => {
            const agents = [ag("a"), ag("h", { project: undefined })];
            const a = plan(agents).board;
            const b = plan([{ ...agents[0], state: "asking" }, agents[1]]).board;
            expect(b).toEqual(a);
        });
    });

    describe("poses", () => {
        it("draws each agent state as the spec's poses table says", () => {
            expect(agentLook(ag("a", { state: "asking" }), NOW, undefined, false)).toMatchObject({
                pose: "hand",
                word: "Needs you",
                bubble: "!",
                light: "asking",
            });
            expect(agentLook(ag("a"), NOW, undefined, false)).toMatchObject({
                pose: "sit",
                animated: true,
                light: "working",
            });
            expect(
                agentLook(ag("a", { state: "idle", idleSince: NOW - 1000, finished: true }), NOW, undefined, false)
            ).toMatchObject({ pose: "doze", word: "done", tone: "done" });
            expect(
                agentLook(ag("a", { state: "idle", idleSince: NOW - 6 * 60_000 }), NOW, undefined, false)
            ).toMatchObject({ pose: "doze", state: "idle 6m" });
            expect(agentLook(ag("a", { state: "idle" }), NOW, "coffee", false)).toMatchObject({
                pose: "empty",
                dim: true,
                state: "at the coffee machine",
            });
            expect(agentLook(ag("a", { state: "idle", finished: true }), NOW, undefined, true)).toMatchObject({
                pose: "empty",
                word: "gone home",
            });
            expect(agentLook(ag("a"), NOW, undefined, true)).toMatchObject({ pose: "sit" });
        });

        it("draws each task state as the spec's seat table says", () => {
            expect(taskLook(task("t", "pending"))).toMatchObject({ pose: "empty" });
            expect(taskLook(task("t", "stalled"))).toMatchObject({ pose: "doze", bubble: "?" });
            expect(taskLook(task("t", "review-failed"))).toMatchObject({ pose: "sit", bubble: "×" });
            expect(taskLook(task("t", "done"))).toMatchObject({ pose: "doze" });
            expect(taskLook(task("t", "running"))).toMatchObject({ pose: "sit", animated: true });
            expect(taskLook(task("t", "reviewing"))).toMatchObject({ pose: "sit", animated: false });
            expect(taskLook(task("t", "done", { asking: true }))).toMatchObject({ pose: "hand", bubble: "!" });
        });
    });

    describe("the lights", () => {
        it("turns the lights off where no one is at work, and on when someone starts; the hall and the lounge stay lit", () => {
            const done = { state: "idle" as const, idleSince: NOW - 1000, finished: true };
            const dark = plan(
                [ag("a", done), ag("h", { ...done, project: undefined })],
                [run("r", { tasks: [task("t", "done")] })]
            );
            expect(
                dark.rooms
                    .filter((r) => !r.lit)
                    .map((r) => r.kind)
                    .sort()
            ).toEqual(["agents", "agents", "empty", "empty", "meeting"]);
            expect(dark.rooms.find((r) => r.kind === "lounge")?.lit).toBe(true);
            // the hall is floor, not a room: nothing in the plan can turn its lights off
            expect(dark.rooms.some((r) => r.key === "hall")).toBe(false);
            const lit = plan([ag("a"), ag("h", { project: undefined })], [run("r", { tasks: [task("t", "running")] })]);
            expect(lit.rooms.filter((r) => r.kind !== "empty").every((r) => r.lit)).toBe(true);
            expect(lit.rooms.filter((r) => r.kind === "empty").every((r) => !r.lit)).toBe(true);
        });

        it("lights a room for an agent that works or asks anywhere in it, hidden ones too", () => {
            const idle = (id: string) => ag(id, { state: "idle", idleSince: NOW - 1000, finished: true });
            const hidden = plan([idle("a1"), idle("a2"), idle("a3"), idle("a4"), ag("a5", { state: "asking" })]);
            expect(room(hidden).lit).toBe(true);
        });

        it("lights a room for a run on a table that is lit, not for one that is hidden", () => {
            const runs = [
                run("r1", { createdTs: 1, tasks: [task("t", "done")] }),
                run("r2", { createdTs: 2, tasks: [task("t", "done")] }),
                run("r3", { createdTs: 3, tasks: [task("t", "running")] }),
            ];
            const idle = ag("a", { state: "idle", idleSince: NOW - 1000, finished: true });
            expect(room(plan([idle], runs)).lit).toBe(false);
            expect(room(plan([idle], [runs[0], runs[2]])).lit).toBe(true);
        });
    });

    describe("the lounge", () => {
        // n idle people spread over four projects, the first half at the coffee machine and the rest on the sofa, the
        // longest idle first by index; a big floor seats all of them
        const BIG = { width: 1600, height: 1000 };
        const crowd = (n: number, o: { longName?: boolean } = {}) => {
            const agents = Array.from({ length: n }, (_, i) =>
                ag(`a${String(i).padStart(2, "0")}`, {
                    name: o.longName && i === 0 ? "a-name-of-twenty-four-ch" : `a${i}`,
                    project: `p${i % 4}`,
                    state: "idle",
                    idleSince: NOW - (n - i) * 60_000 - 600_000,
                })
            );
            const away = Object.fromEntries(agents.map((a, i) => [a.id, i % 2 === 0 ? "coffee" : "sofa"] as const));
            return { agents, away };
        };
        const build = (n: number, o: { longName?: boolean } = {}) => {
            const { agents, away } = crowd(n, o);
            return plan(agents, [], { away, ...BIG });
        };

        it("puts the lounge's people in the lounge with their age", () => {
            const p = plan([ag("t", { state: "idle", idleSince: NOW - 6 * 60_000 })], [], { away: { t: "coffee" } });
            expect(p.loungers).toEqual([expect.objectContaining({ agentId: "t", at: "coffee", label: "t · idle 6m" })]);
            expect(p.desks[0].pose).toBe("empty");
        });

        it("keeps a floor's lounge to the idle people of that floor's rooms", () => {
            const at: Placements = { a: { floor: 0, slot: 0 }, b: { floor: 1, slot: 0 } };
            const agents = [
                ag("g1", { project: "a", state: "idle", idleSince: NOW - 6 * 60_000 }),
                ag("u1", { project: "b", state: "idle", idleSince: NOW - 7 * 60_000 }),
            ];
            const away = { g1: "sofa", u1: "coffee" } as const;
            const g = plan(agents, [], { away, floor: 0, at });
            expect(g.loungers.map((l) => l.agentId)).toEqual(["g1"]);
            const up = plan(agents, [], { away, floor: 1, at });
            expect(up.loungers.map((l) => l.agentId)).toEqual(["u1"]);
            expect(up.loungeOverflow).toEqual([]);
        });

        it("draws a person as wide and as tall as the model says", () => {
            expect(spriteWidth("cup") * PLAN_CELL).toBe(LOUNGE_PERSON_W);
            expect(PLAN_SPRITES.cup.length * PLAN_CELL).toBe(69);
            expect(PLAN_SPRITES.back.length * PLAN_CELL).toBe(45);
        });

        it("sizes every lounger's box as its sprite", () => {
            const p = build(20);
            for (const l of p.loungers) {
                const sprite = l.at === "sofa" ? "back" : "cup";
                expect(l.box.h, l.agentId).toBe(PLAN_SPRITES[sprite].length * PLAN_CELL);
                expect(l.box.w, l.agentId).toBe(LOUNGE_PERSON_W);
            }
        });

        for (const n of [1, 4, 20]) {
            it(`keeps ${n} people's sprites and labels inside the lounge and clear of each other`, () => {
                const p = build(n, { longName: true });
                const inLounge = (b: Box) =>
                    b.x >= p.lounge.x &&
                    b.y >= p.lounge.y &&
                    b.x + b.w <= p.lounge.x + p.lounge.w &&
                    b.y + b.h <= p.lounge.y + p.lounge.h;
                for (const l of p.loungers) {
                    expect(inLounge(l.box), `${l.agentId} sprite`).toBe(true);
                    expect(inLounge(l.labelBox), `${l.agentId} label`).toBe(true);
                    expect(l.box.x).toBe(l.x);
                    expect(l.box.y + l.box.h).toBe(l.bottom);
                }
                for (const a of p.loungers) {
                    for (const b of p.loungers) {
                        if (a === b) {
                            continue;
                        }
                        expect(overlaps(a.labelBox, b.labelBox), `${a.agentId} label over ${b.agentId} label`).toBe(
                            false
                        );
                        expect(overlaps(a.labelBox, b.box), `${a.agentId} label over ${b.agentId}`).toBe(false);
                        expect(overlaps(a.box, b.box), `${a.agentId} over ${b.agentId}`).toBe(false);
                    }
                    expect(overlaps(a.labelBox, a.box)).toBe(false);
                }
                expect(inLounge(p.loungeMore)).toBe(true);
                for (const l of p.loungers) {
                    expect(overlaps(l.labelBox, p.loungeMore) || overlaps(l.box, p.loungeMore)).toBe(false);
                }
            });
        }

        it("puts coffee people at the standing places and sofa people on the sofa", () => {
            const p = build(20);
            for (const l of p.loungers) {
                const sofa = p.sofa.y === l.bottom;
                expect(sofa).toBe(l.at === "sofa");
            }
        });

        it("fills the spots longest idle first, and a newcomer moves no one", () => {
            const { agents, away } = crowd(6);
            const before = plan(agents, [], { away, ...BIG });
            const spot = (p: ReturnType<typeof plan>) =>
                Object.fromEntries(p.loungers.map((l) => [l.agentId, [l.x, l.bottom]]));
            const newcomer = ag("zz", { project: "p1", state: "idle", idleSince: NOW - 599_000 });
            for (const at of ["coffee", "sofa"] as const) {
                const after = plan([...agents, newcomer], [], { away: { ...away, zz: at }, ...BIG });
                expect(after.loungers.length + after.loungeOverflow.length).toBe(7);
                for (const [id, xy] of Object.entries(spot(before))) {
                    expect(spot(after)[id]).toEqual(xy);
                }
            }
            // the longest idle takes the first spot: a00 is the longest idle coffee person
            const coffee = before.loungers.filter((l) => l.at === "coffee");
            expect(coffee[0].agentId).toBe("a00");
            expect(coffee[0].x).toBeGreaterThan(coffee[1].x);
        });

        it("sends whoever finds no spot to the overflow, longest idle served first", () => {
            const p = build(20);
            expect(p.loungers.length + p.loungeOverflow.length).toBe(20);
            expect(p.loungeOverflow.length).toBeGreaterThan(0);
            const placed = new Set(p.loungers.map((l) => l.agentId));
            expect(p.loungeOverflow.every((id) => !placed.has(id))).toBe(true);
            // an overflow person keeps a dimmed empty desk that says where they are
            const gone = p.desks.find((d) => d.key === p.loungeOverflow[0])!;
            expect(gone).toMatchObject({ pose: "empty", dim: true });
            expect(gone.tip).toMatch(/at the coffee machine|on the sofa/);
            expect(build(1).loungeOverflow).toEqual([]);
        });

        it("moves no room when more of the same agents go to the lounge", () => {
            const { agents, away } = crowd(20);
            const some = Object.fromEntries(Object.entries(away).slice(0, 1));
            const boxes = (a: typeof away) => plan(agents, [], { away: a, ...BIG }).rooms.map((r) => r.box);
            expect(boxes(away)).toEqual(boxes(some));
            expect(plan(agents, [], { away, ...BIG }).hall).toEqual(plan(agents, [], { away: some, ...BIG }).hall);
        });

        it("keeps the full label for the view to cut", () => {
            const p = build(2, { longName: true });
            expect(p.loungers.find((l) => l.agentId === "a00")?.label).toMatch(/^a-name-of-twenty-four-ch · idle /);
        });
    });

    describe("peopleDrawn", () => {
        it("counts desks and seats with a person, the lounge's, the walkers and the boss, never the overflow", () => {
            const agents = Array.from({ length: 8 }, (_, i) =>
                ag(`i${String(i).padStart(2, "0")}`, { state: "idle", idleSince: NOW - (20 + i) * 60_000 })
            );
            const away = Object.fromEntries(agents.map((a) => [a.id, "sofa"] as const));
            // named to sort first, so both sit at desks on a floor that seats ten
            const p = plan(
                [ag("w", { name: "aa" }), ag("x", { name: "ab", state: "asking" }), ...agents],
                [run("r", { tasks: [task("a", "running"), task("b", "pending")] })],
                { away, width: 1600, height: 1000 }
            );
            expect(p.desks).toHaveLength(10);
            expect(p.loungeOverflow.length).toBeGreaterThan(0);
            // 2 at a desk, the run's lead and its running task, the sofa's spots, and the boss
            const sofaSpots = p.loungers.length;
            expect(peopleDrawn(p, new Set(), true)).toBe(2 + 2 + sofaSpots + 1);
            expect(peopleDrawn(p, new Set(), false)).toBe(2 + 2 + sofaSpots);
            // a walker leaves its desk or its spot and is counted once
            expect(peopleDrawn(p, new Set(["w"]), true)).toBe(2 + 2 + sofaSpots + 1);
            expect(peopleDrawn(p, new Set([p.loungers[0].agentId]), true)).toBe(2 + 2 + sofaSpots + 1);
            // an overflow person walking is drawn as a walker
            expect(peopleDrawn(p, new Set([p.loungeOverflow[0]]), true)).toBe(2 + 2 + sofaSpots + 2);
        });
    });

    describe("popupBox", () => {
        const left = { doorSide: "right" as const, box: { x: 0, y: 30, w: 740, h: 380 } };
        const rightRoom = { doorSide: "left" as const, box: { x: 900, y: 30, w: 300, h: 380 } };

        it("holds the card in a box of its own height, inside the office's box, whatever the card's length", () => {
            const size = { width: 1200, height: 436 };
            for (const y of [40, 200, 400]) {
                const { box } = popupBox(size, { x: 100, y }, left);
                expect(box.h).toBe(POPUP_H);
                expect(box.w).toBe(POPUP_W);
                expect(box.y).toBeGreaterThanOrEqual(0);
                expect(box.y + box.h).toBeLessThanOrEqual(size.height);
            }
        });

        it("shrinks to an office shorter than the card", () => {
            const { box } = popupBox({ width: 1200, height: 260 }, { x: 100, y: 200 }, left);
            expect(box).toMatchObject({ y: 0, h: 260 });
        });

        it("opens right of a left-column room and left of a right-column one, its pointer on the box's edge", () => {
            const size = { width: 1200, height: 436 };
            const a = popupBox(size, { x: 100, y: 120 }, left);
            expect(a.right).toBe(true);
            expect(a.box.x).toBe(200);
            const m = popupBox(size, { x: 1000, y: 120 }, rightRoom);
            expect(m.right).toBe(false);
            expect(m.box.x).toBe(900 - POPUP_W);
            for (const y of [0, 120, 436]) {
                const { box, pointerTop } = popupBox(size, { x: 100, y }, left);
                expect(pointerTop).toBeGreaterThanOrEqual(8);
                expect(pointerTop).toBeLessThanOrEqual(box.h - 20);
            }
        });

        it("takes its side from the room's door, whatever its kind", () => {
            const size = { width: 1200, height: 436 };
            expect(popupBox(size, { x: 100, y: 120 }, left).right).toBe(true);
            expect(popupBox(size, { x: 1000, y: 120 }, rightRoom).right).toBe(false);
            // a built floor: the left column's rooms open right, the right column's left
            const p = plan([ag("a", { project: "a" }), ag("b", { project: "b" })]);
            const [a, b] = slotRooms(p);
            expect(popupBox(p, { x: a.box.x + 100, y: 200 }, a).right).toBe(true);
            expect(popupBox(p, { x: b.box.x + 100, y: 200 }, b).right).toBe(false);
        });

        it("grows big on the hall's side of the desk, into the room that side has, never under the small card", () => {
            const size = { width: 1200, height: 700 };
            expect(popupBox(size, { x: 100, y: 120 }, left, true).box).toMatchObject({
                x: 200,
                w: POPUP_BIG_W,
                h: POPUP_BIG_H,
            });
            // a desk near the office's right edge: the card takes what is left on that side
            expect(popupBox(size, { x: 600, y: 120 }, left, true).box).toMatchObject({ x: 700, w: 500 });
            expect(popupBox(size, { x: 1000, y: 120 }, rightRoom, true).box).toMatchObject({
                x: 900 - POPUP_BIG_W,
                w: POPUP_BIG_W,
            });
            const small = popupBox({ width: 600, height: 300 }, { x: 100, y: 120 }, left, true).box;
            expect(small).toMatchObject({ x: 200, w: 400, y: 0, h: 300 });
            expect(popupBox({ width: 1200, height: 700 }, { x: 900, y: 120 }, left, true).box.w).toBe(POPUP_W);
        });
    });
});
