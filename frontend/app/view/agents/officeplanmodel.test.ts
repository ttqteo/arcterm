// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { PLAN_CELL, PLAN_SPRITES, spriteWidth } from "@/app/view/office/plansprite";
import { describe, expect, it } from "vitest";
import {
    agentLook,
    buildPlan,
    cut,
    DOOR,
    HALL_W,
    LOUNGE_PERSON_W,
    MEETING_H,
    MIN_W,
    peopleDrawn,
    POPUP_BIG_H,
    POPUP_BIG_W,
    POPUP_H,
    POPUP_W,
    popupBox,
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

describe("officeplanmodel", () => {
    it("makes a band per project by name, and seats agents with no project in Home's booth", () => {
        const p = plan([
            ag("z1", { project: "zeta" }),
            ag("a1", { project: "alpha" }),
            ag("h1", { project: undefined }),
            ag("h2", { project: "  " }),
        ]);
        expect(p.rooms.filter((r) => r.kind === "agents").map((r) => r.title)).toEqual(["alpha", "zeta"]);
        expect(p.rooms.filter((r) => r.kind === "meeting")).toHaveLength(2);
        expect(p.rooms.find((r) => r.kind === "home")?.sub).toBe("2 agents");
        expect(p.order).toEqual(["a1", "z1", "h1", "h2"]);
    });

    it("sets desks in rows of three by name, then id, 120 apart and 130 between rows", () => {
        const p = plan([ag("d"), ag("c"), ag("b"), ag("a"), ag("a2", { name: "a" })]);
        expect(p.desks.map((d) => d.key)).toEqual(["a", "a2", "b", "c", "d"]);
        const [a, a2, b, c] = p.desks;
        expect(a2.x - a.x).toBe(120);
        expect(b.x - a2.x).toBe(120);
        expect(c.x).toBe(a.x);
        expect(c.y - a.y).toBe(130);
    });

    it("gives each run a meeting room by start, the last stretched to the band", () => {
        const agents = Array.from({ length: 10 }, (_, i) => ag(`a${i}`));
        const p = plan(agents, [run("r2", { createdTs: 2 }), run("r1", { createdTs: 1 })]);
        const meet = p.rooms.filter((r) => r.kind === "meeting");
        expect(meet.map((r) => r.runId)).toEqual(["r1", "r2"]);
        const band = p.rooms.find((r) => r.kind === "agents")!;
        expect(meet[0].box.h).toBe(MEETING_H);
        expect(meet[1].box.y + meet[1].box.h).toBe(band.box.y + band.box.h);
    });

    it("grows to the height it is given, stretching the last band and keeping Home's booth at the foot", () => {
        const agents = [ag("a", { project: "alpha" }), ag("z", { project: "zeta" }), ag("h", { project: undefined })];
        const short = plan(agents);
        const p = plan(agents, [], { height: short.height + 300 });
        expect(p.height).toBe(short.height + 300);
        const [alpha, zeta] = p.rooms.filter((r) => r.kind === "agents");
        expect(alpha.box.h).toBe(short.rooms.find((r) => r.title === "alpha")!.box.h);
        expect(zeta.box.y + zeta.box.h).toBe(p.body.y + p.body.h);
        const booth = p.rooms.find((r) => r.kind === "home")!;
        expect(booth.box.y + booth.box.h).toBe(p.body.y + p.body.h);
        // what it holds still sets the height when that is the taller
        const full = Array.from({ length: 12 }, (_, i) => ag(`a${i}`));
        expect(plan(full, [], { height: 200 }).height).toBeGreaterThan(200);
    });

    it("stacks many runs without overlap and keeps every seat in its room", () => {
        const runs = Array.from({ length: 7 }, (_, i) =>
            run(`r${i}`, { createdTs: i, tasks: [task("t1"), task("t2")] })
        );
        const p = plan([ag("a")], runs);
        const meet = p.rooms.filter((r) => r.kind === "meeting");
        expect(meet).toHaveLength(7);
        for (let i = 0; i < meet.length; i++) {
            for (let j = i + 1; j < meet.length; j++) {
                expect(overlaps(meet[i].box, meet[j].box), `${i} ${j}`).toBe(false);
            }
        }
        for (const s of p.seats) {
            const room = p.rooms.find((r) => r.key === s.room)!;
            expect(s.x).toBeGreaterThanOrEqual(room.box.x);
            expect(s.bottom).toBeLessThanOrEqual(room.box.y + room.box.h);
        }
    });

    it("seats the lead first and alternates the workers' sides, with +N past eleven tasks", () => {
        const p = plan([], [run("r", { tasks: Array.from({ length: 13 }, (_, i) => task(`t${i + 1}`)) })]);
        expect(p.seats).toHaveLength(12);
        expect(p.seats[0].key).toBe("r");
        expect(p.seats[1].pose).toBe("back");
        expect(p.seats[2].pose).toBe("sit");
        expect(p.rooms.find((r) => r.runId === "r")?.more).toBe(2);
        expect(p.order.slice(0, 3)).toEqual(["r", "r:t1", "r:t2"]);
    });

    it("raises a hand on either side of the table when the worker's agent is asking", () => {
        const p = plan(
            [],
            [run("r", { tasks: [task("t1", "running", { asking: true }), task("t2", "running", { asking: true })] })]
        );
        expect(p.seats[1]).toMatchObject({ pose: "hand", animated: true, bubble: "!" });
        expect(p.seats[2]).toMatchObject({ pose: "hand", animated: true, bubble: "!" });
        expect(p.asks).toEqual(["r:t1", "r:t2"]);
    });

    it("fits a full table and its seats inside the meeting room, at the minimum width too", () => {
        const tasks = Array.from({ length: 13 }, (_, i) => task(`t${i + 1}`));
        for (const width of [MIN_W, 1050]) {
            const p = plan([], [run("r", { tasks })], { width });
            const room = p.rooms.find((r) => r.runId === "r")!;
            const t = room.table!;
            expect(t.x, `table at ${width}`).toBeGreaterThanOrEqual(room.box.x);
            expect(t.x + t.w, `table at ${width}`).toBeLessThanOrEqual(room.box.x + room.box.w);
            expect(p.seats).toHaveLength(12);
            for (const s of p.seats) {
                expect(s.x, `${s.key} at ${width}`).toBeGreaterThanOrEqual(room.box.x);
                // a seated person is 12 cells of 3 px
                expect(s.x + 36, `${s.key} at ${width}`).toBeLessThanOrEqual(room.box.x + room.box.w);
                expect(s.spot.x, `${s.key} at ${width}`).toBeLessThanOrEqual(room.box.x + room.box.w);
            }
        }
    });

    it("keys a task seat by its card row when it has one", () => {
        const p = plan([], [run("r", { tasks: [task("t1", "running", { key: "row:x" })] })]);
        expect(p.seats[1].key).toBe("row:x");
    });

    it("keeps every place when only a state changes", () => {
        const a = plan([ag("loom"), ag("quill")]);
        const b = plan([
            ag("loom", { state: "asking" }),
            ag("quill", { state: "idle", idleSince: NOW - 1000, finished: true }),
        ]);
        expect(b.desks.map((d) => [d.key, d.x, d.y])).toEqual(a.desks.map((d) => [d.key, d.x, d.y]));
    });

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
        expect(agentLook(ag("a", { state: "idle", idleSince: NOW - 6 * 60_000 }), NOW, undefined, false)).toMatchObject(
            { pose: "doze", state: "idle 6m" }
        );
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

    it("puts the lounge's people in the lounge with their age", () => {
        const p = plan([ag("t", { state: "idle", idleSince: NOW - 6 * 60_000 })], [], { away: { t: "coffee" } });
        expect(p.loungers).toEqual([expect.objectContaining({ agentId: "t", at: "coffee", label: "t · idle 6m" })]);
        expect(p.desks[0].pose).toBe("empty");
    });

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
        ).toEqual(["agents", "home", "meeting"]);
        expect(dark.rooms.find((r) => r.kind === "lounge")?.lit).toBe(true);
        // the hall is floor, not a room: nothing in the plan can turn its lights off
        expect(dark.rooms.some((r) => r.key === "hall")).toBe(false);
        const lit = plan([ag("a"), ag("h", { project: undefined })], [run("r", { tasks: [task("t", "running")] })]);
        expect(lit.rooms.every((r) => r.lit)).toBe(true);
    });

    it("keeps one empty, dark meeting room in a band with no run", () => {
        const meet = plan([ag("a")]).rooms.filter((r) => r.kind === "meeting");
        expect(meet).toHaveLength(1);
        expect(meet[0]).toMatchObject({ title: "Meeting room", sub: "no run", lit: false });
        expect(meet[0].runId).toBeUndefined();
    });

    it("opens a door from every room onto the hall, and leaves the hall's walls open there", () => {
        const p = plan([ag("a"), ag("h", { project: undefined })], [run("r")]);
        const doors = p.rooms.filter((r) => r.door).map((r) => r.door!);
        expect(doors).toHaveLength(3);
        for (const d of doors) {
            for (const w of p.walls) {
                expect(overlaps(d, w), JSON.stringify({ d, w })).toBe(false);
            }
        }
        const left = p.rooms.find((r) => r.kind === "agents")!;
        expect(left.door!.x).toBe(left.box.x + left.box.w);
        expect(p.hall.w).toBe(HALL_W);
    });

    it("never lets Home's booth swallow a left room's door", () => {
        const alpha = plan(
            [
                ag("a1", { project: "alpha" }),
                ag("a2", { project: "alpha" }),
                ag("b1", { project: "beta" }),
                ag("h1", { project: undefined }),
            ],
            [run("r1", { project: "alpha", tasks: [task("t1")] })]
        );
        const many = plan(
            [
                ag("a1", { project: "a" }),
                ag("b1", { project: "b" }),
                ag("c1", { project: "c" }),
                ag("d1", { project: "d" }),
                ...Array.from({ length: 5 }, (_, i) => ag(`h${i}`, { project: undefined })),
            ],
            []
        );
        for (const [label, p] of [
            ["alpha and beta", alpha],
            ["four bands", many],
        ] as const) {
            const booth = p.rooms.find((r) => r.kind === "home")!;
            const lefts = p.rooms.filter((r) => r.kind === "agents");
            for (const room of lefts) {
                const d = room.door!;
                expect(overlaps(d, booth.box), `${label}: ${room.key} door against the booth`).toBe(false);
                for (const w of p.walls) {
                    expect(overlaps(d, w), `${label}: ${room.key} door against ${JSON.stringify(w)}`).toBe(false);
                }
                const outer = { x: d.x + d.w + 14, y: d.y + d.h / 2 };
                expect(inside(outer, p.hallFloor), `${label}: ${room.key} door opens onto the hall`).toBe(true);
            }
            const last = lefts[lefts.length - 1];
            expect(booth.box.y - 18, label).toBeGreaterThanOrEqual(last.door!.y + DOOR);
        }
    });

    it("cuts a wall around its doors", () => {
        expect(cut({ x: 0, y: 0, w: WALL, h: 100 }, [{ x: 0, y: 40, w: WALL, h: 20 }])).toEqual([
            { x: 0, y: 0, w: WALL, h: 40 },
            { x: 0, y: 60, w: WALL, h: 40 },
        ]);
    });

    it("lists the asks in office order", () => {
        const p = plan(
            [ag("b", { state: "asking" }), ag("a")],
            [run("r", { tasks: [task("t", "running", { asking: true })] })]
        );
        expect(p.asks).toEqual(["b", "r:t"]);
    });

    it("keeps its minimum width in a narrow Cockpit", () => {
        expect(plan([ag("a")], [], { width: 600 }).width).toBe(MIN_W);
    });

    it("shows each task on its run's screen", () => {
        const p = plan(
            [],
            [run("r", { tasks: [task("a", "done"), task("b", "running"), task("c", "pending"), task("d", "failed")] })]
        );
        expect(p.rooms.find((r) => r.runId === "r")?.screen).toEqual(["done", "work", "wait", "fail"]);
    });

    describe("the lounge", () => {
        // n idle people, the first half at the coffee machine and the rest on the sofa, the longest idle first by index
        const crowd = (n: number, o: { longName?: boolean } = {}) => {
            const agents = Array.from({ length: n }, (_, i) =>
                ag(`a${String(i).padStart(2, "0")}`, {
                    name: o.longName && i === 0 ? "a-name-of-twenty-four-ch" : `a${i}`,
                    state: "idle",
                    idleSince: NOW - (n - i) * 60_000 - 600_000,
                })
            );
            const away = Object.fromEntries(agents.map((a, i) => [a.id, i % 2 === 0 ? "coffee" : "sofa"] as const));
            return { agents, away };
        };
        const build = (n: number, o: { longName?: boolean } = {}) => {
            const { agents, away } = crowd(n, o);
            return plan(agents, [], { away });
        };

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
            const before = plan(agents, [], { away });
            const spot = (p: ReturnType<typeof plan>) =>
                Object.fromEntries(p.loungers.map((l) => [l.agentId, [l.x, l.bottom]]));
            const newcomer = ag("zz", { state: "idle", idleSince: NOW - 599_000 });
            for (const at of ["coffee", "sofa"] as const) {
                const after = plan([...agents, newcomer], [], { away: { ...away, zz: at } });
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
            const boxes = (a: typeof away) => plan(agents, [], { away: a }).rooms.map((r) => r.box);
            expect(boxes(away)).toEqual(boxes(some));
            expect(plan(agents, [], { away }).hall).toEqual(plan(agents, [], { away: some }).hall);
        });

        it("keeps the full label for the view to cut", () => {
            const p = build(2, { longName: true });
            expect(p.loungers.find((l) => l.agentId === "a00")?.label).toMatch(/^a-name-of-twenty-four-ch · idle /);
        });
    });

    describe("peopleDrawn", () => {
        it("counts desks and seats with a person, the lounge's, the walkers and the boss, never the overflow", () => {
            const agents = Array.from({ length: 14 }, (_, i) =>
                ag(`i${String(i).padStart(2, "0")}`, { state: "idle", idleSince: NOW - (20 + i) * 60_000 })
            );
            const away = Object.fromEntries(agents.map((a) => [a.id, "sofa"] as const));
            const p = plan(
                [ag("w"), ag("x", { state: "asking" }), ...agents],
                [run("r", { tasks: [task("a", "running"), task("b", "pending")] })],
                { away }
            );
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
        const agents = { kind: "agents" as const, box: { x: 0, y: 30, w: 740, h: 380 } };
        const meeting = { kind: "meeting" as const, box: { x: 900, y: 30, w: 300, h: 380 } };

        it("holds the card in a box of its own height, inside the office's box, whatever the card's length", () => {
            const size = { width: 1200, height: 436 };
            for (const y of [40, 200, 400]) {
                const { box } = popupBox(size, { x: 100, y }, agents);
                expect(box.h).toBe(POPUP_H);
                expect(box.w).toBe(POPUP_W);
                expect(box.y).toBeGreaterThanOrEqual(0);
                expect(box.y + box.h).toBeLessThanOrEqual(size.height);
            }
        });

        it("shrinks to an office shorter than the card", () => {
            const { box } = popupBox({ width: 1200, height: 260 }, { x: 100, y: 200 }, agents);
            expect(box).toMatchObject({ y: 0, h: 260 });
        });

        it("sits right of an agents' desk and left of a meeting room, its pointer on the box's edge", () => {
            const size = { width: 1200, height: 436 };
            const a = popupBox(size, { x: 100, y: 120 }, agents);
            expect(a.right).toBe(true);
            expect(a.box.x).toBe(200);
            const m = popupBox(size, { x: 1000, y: 120 }, meeting);
            expect(m.right).toBe(false);
            expect(m.box.x).toBe(900 - POPUP_W);
            for (const y of [0, 120, 436]) {
                const { box, pointerTop } = popupBox(size, { x: 100, y }, agents);
                expect(pointerTop).toBeGreaterThanOrEqual(8);
                expect(pointerTop).toBeLessThanOrEqual(box.h - 20);
            }
        });

        it("grows big on the hall's side of the desk, into the room that side has, never under the small card", () => {
            const size = { width: 1200, height: 700 };
            expect(popupBox(size, { x: 100, y: 120 }, agents, true).box).toMatchObject({
                x: 200,
                w: POPUP_BIG_W,
                h: POPUP_BIG_H,
            });
            // a desk near the office's right edge: the card takes what is left on that side
            expect(popupBox(size, { x: 600, y: 120 }, agents, true).box).toMatchObject({ x: 700, w: 500 });
            expect(popupBox(size, { x: 1000, y: 120 }, meeting, true).box).toMatchObject({
                x: 900 - POPUP_BIG_W,
                w: POPUP_BIG_W,
            });
            const small = popupBox({ width: 600, height: 300 }, { x: 100, y: 120 }, agents, true).box;
            expect(small).toMatchObject({ x: 200, w: 400, y: 0, h: 300 });
            expect(popupBox({ width: 1200, height: 700 }, { x: 900, y: 120 }, agents, true).box.w).toBe(POPUP_W);
        });
    });
});
