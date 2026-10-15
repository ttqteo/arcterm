// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
    agentLook,
    buildPlan,
    cut,
    DOOR,
    HALL_W,
    MEETING_H,
    MIN_W,
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
});
