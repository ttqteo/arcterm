// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
    advance,
    bossLook,
    canStand,
    canWalk,
    cardAt,
    deskAt,
    dotsAlong,
    facing,
    pathBetween,
    roomAt,
    spotOf,
    stepToward,
} from "./officeboss";
import { buildPlan, type Plan, type PlanAgent, type Point } from "./officeplanmodel";

const ag = (id: string, project?: string, state: PlanAgent["state"] = "working"): PlanAgent => ({
    id,
    name: id,
    project,
    state,
    finished: false,
});
const run = (id: string, project: string) => ({
    id,
    title: id,
    project,
    done: false,
    leadAsking: false,
    tasks: [{ id: "t1", label: "t1", state: "running", asking: false }],
});
const plan = buildPlan({
    agents: [ag("a1", "alpha"), ag("a2", "alpha"), ag("b1", "beta"), ag("h1")],
    runs: [{ ...run("r1", "alpha") }],
    width: 1050,
    now: 0,
    away: {},
    night: false,
});
const room = (k: string) => plan.rooms.find((r) => r.key === k)!;
const a1 = spotOf(plan, "a1")!;

// every 3 px along every segment must be floor: a corner check alone would let a path cut through a wall
function offFloor(p: Plan, path: Point[]): Point[] {
    const bad: Point[] = [];
    for (let i = 0; i < path.length - 1; i++) {
        const a = path[i];
        const b = path[i + 1];
        const len = Math.hypot(b.x - a.x, b.y - a.y);
        for (let d = 0; d <= len; d += 3) {
            const q = { x: a.x + ((b.x - a.x) * d) / (len || 1), y: a.y + ((b.y - a.y) * d) / (len || 1) };
            if (!canStand(p, q)) {
                bad.push(q);
            }
        }
        if (!canStand(p, b)) {
            bad.push(b);
        }
    }
    return bad;
}
const nearDoorMiddle = (path: Point[], r: { door?: { x: number; y: number; w: number; h: number } }) =>
    dotsAlong(path, 2).some(
        (p) => Math.hypot(p.x - (r.door!.x + r.door!.w / 2), p.y - (r.door!.y + r.door!.h / 2)) <= 14
    );

describe("officeboss", () => {
    it("lets one stand in rooms, doors and the hall, never in a wall", () => {
        expect(canStand(plan, a1)).toBe(true);
        const door = room("room:alpha").door!;
        expect(canStand(plan, { x: door.x + 4, y: door.y + 25 })).toBe(true);
        expect(canStand(plan, { x: door.x + 4, y: door.y - 20 })).toBe(false);
        expect(roomAt(plan, { x: plan.hall.x + 100, y: plan.hall.y + 300 })).toBe("hall");
        expect(roomAt(plan, a1)).toBe("room:alpha");
    });

    it("stops at a wall and goes through a door", () => {
        const r = room("room:alpha");
        const blocked = stepToward(plan, a1, "right", 600);
        expect(blocked.x).toBeLessThanOrEqual(r.box.x + r.box.w);
        expect(roomAt(plan, blocked)).toBe("room:alpha");
        const atDoor = { x: a1.x, y: r.door!.y + r.door!.h / 2 };
        expect(roomAt(plan, stepToward(plan, atDoor, "right", 600))).toBe("hall");
    });

    it("does not tunnel through a wall on a long step", () => {
        const r = room("room:alpha");
        const nearWall = { x: r.box.x + r.box.w - 3, y: a1.y };
        expect(stepToward(plan, nearWall, "right", 30).x).toBeLessThanOrEqual(r.box.x + r.box.w);
        // a 100 ms hitch at the boss's speed is a 16 px step: still no wall crossed
        expect(canStand(plan, stepToward(plan, nearWall, "right", 16))).toBe(true);
    });

    it("walks out of one room, along the hall and into another, on floor all the way", () => {
        const b1 = spotOf(plan, "b1")!;
        const path = pathBetween(plan, a1, b1);
        expect(path[0]).toEqual(a1);
        expect(path[path.length - 1]).toEqual(b1);
        expect(path.some((p) => p.x === plan.hall.x + plan.hall.w - 36)).toBe(true);
        for (const p of path) {
            expect(canStand(plan, p), JSON.stringify(p)).toBe(true);
        }
        expect(offFloor(plan, path)).toEqual([]);
        const a2 = spotOf(plan, "a2")!;
        expect(pathBetween(plan, a1, a2)).toEqual([a1, a2]);
        const h1 = spotOf(plan, "h1")!;
        const home = pathBetween(plan, a1, h1);
        expect(home.every((p) => canStand(plan, p))).toBe(true);
        expect(offFloor(plan, home)).toEqual([]);
        expect(offFloor(plan, pathBetween(plan, h1, spotOf(plan, "r1")!))).toEqual([]);
    });

    it("walks from every desk to every other desk and seat on a tall Home booth, never off the floor", () => {
        const tall = buildPlan({
            agents: [
                ...["a", "b", "c", "d"].flatMap((p) => [ag(`${p}1`, p), ag(`${p}2`, p, "asking")]),
                ...[1, 2, 3, 4, 5].map((i) => ag(`h${i}`)),
            ],
            runs: [run("r1", "a"), run("r2", "d")],
            width: 900,
            now: 0,
            away: {},
            night: false,
        });
        const keys = [...tall.desks.map((d) => d.key), ...tall.seats.map((s) => s.key)];
        expect(tall.desks.filter((d) => d.room === "room:home")).toHaveLength(5);
        for (const from of keys) {
            for (const to of keys) {
                const path = pathBetween(tall, spotOf(tall, from)!, spotOf(tall, to)!);
                expect(offFloor(tall, path), `${from} -> ${to}`).toEqual([]);
            }
        }
    });

    it("lays dots every 14 px along a path, across its corners", () => {
        expect(
            dotsAlong([
                { x: 0, y: 0 },
                { x: 28, y: 0 },
            ])
        ).toEqual([
            { x: 0, y: 0 },
            { x: 14, y: 0 },
        ]);
        expect(
            dotsAlong([
                { x: 0, y: 0 },
                { x: 10, y: 0 },
                { x: 10, y: 10 },
            ])
        ).toEqual([
            { x: 0, y: 0 },
            { x: 10, y: 4 },
        ]);
    });

    it("advances along a path and says what is left", () => {
        const path = [
            { x: 0, y: 0 },
            { x: 10, y: 0 },
            { x: 10, y: 10 },
        ];
        expect(advance(path, 15)).toEqual({
            at: { x: 10, y: 5 },
            rest: [
                { x: 10, y: 5 },
                { x: 10, y: 10 },
            ],
        });
        expect(advance(path, 50)).toEqual({ at: { x: 10, y: 10 }, rest: [{ x: 10, y: 10 }] });
    });

    it("faces the way it moves most", () => {
        expect(facing({ x: 0, y: 0 }, { x: -5, y: 1 })).toBe("left");
        expect(facing({ x: 0, y: 0 }, { x: 1, y: 5 })).toBe("down");
        expect(facing({ x: 0, y: 0 }, { x: 0, y: 0 }, "up")).toBe("up");
    });

    it("finds the desk or seat at the boss, and none in the hall", () => {
        expect(deskAt(plan, a1)).toBe("a1");
        expect(deskAt(plan, spotOf(plan, "r1")!)).toBe("r1");
        expect(deskAt(plan, { x: plan.hall.x + 100, y: plan.hall.y + 300 })).toBeUndefined();
    });

    it("is at a desk only in front of it, within reach of its spot", () => {
        expect(deskAt(plan, { x: a1.x + 12, y: a1.y - 12 })).toBe("a1");
        // in the same room, but well off any spot: at no desk, however near the nearest one is
        expect(deskAt(plan, { x: a1.x, y: a1.y + 60 })).toBeUndefined();
        expect(deskAt(plan, { x: a1.x + 60, y: a1.y })).toBeUndefined();
    });

    it("never lets the boss's feet onto a desk, the person at it, or a meeting table", () => {
        const d = plan.desks.find((x) => x.key === "a1")!;
        expect(canWalk(plan, a1)).toBe(true);
        expect(canWalk(plan, { x: d.x + 40, y: d.y + 10 })).toBe(false); // the desk top
        expect(canWalk(plan, { x: d.x + 40, y: d.y - 10 })).toBe(false); // the person at it
        expect(canStand(plan, { x: d.x + 40, y: d.y + 10 })).toBe(true); // still floor, for a jump's path
        const t = room(plan.seats.find((x) => x.key === "r1")!.room).table!;
        expect(canWalk(plan, { x: t.x + t.w / 2, y: t.y + 10 })).toBe(false);
        expect(canWalk(plan, spotOf(plan, "r1")!)).toBe(true);
        for (const s of [...plan.desks, ...plan.seats]) {
            expect(canWalk(plan, s.spot)).toBe(true);
        }
    });

    it("never lets the boss's feet onto the lounge's sofa, its coffee machine, or a plant", () => {
        const l = plan.lounge;
        expect(canWalk(plan, { x: l.x + 100, y: l.y + 170 })).toBe(false); // the sofa
        expect(canWalk(plan, { x: l.x + 178, y: l.y + 181 })).toBe(false); // its right end
        expect(canWalk(plan, { x: l.x + 100, y: l.y + 130 })).toBe(false); // someone sitting on it
        expect(canWalk(plan, { x: l.x + 184, y: l.y + 130 })).toBe(false); // the coffee machine
        expect(canWalk(plan, { x: l.x + 217, y: l.y + 205 })).toBe(false); // the plant's pot
        const r = room("room:alpha").box;
        expect(canWalk(plan, { x: r.x + r.w - 27, y: r.y + r.h - 28 })).toBe(false); // the room's plant
        expect(canWalk(plan, { x: l.x + 100, y: l.y + 100 })).toBe(true); // the rug, facing the sofa
        expect(canWalk(plan, { x: l.x + 100, y: l.y + 200 })).toBe(true); // behind it
        expect(stepToward(plan, { x: l.x + 100, y: l.y + 210 }, "up", 200).y).toBeGreaterThan(l.y + 188);
    });

    it("leaves every desk and seat within a walk of every other, around all the furniture", () => {
        const key = (p: Point) => `${p.x},${p.y}`;
        const seen = new Set([key(a1)]);
        const reached = new Set<string>();
        const queue = [a1];
        while (queue.length) {
            const p = queue.pop()!;
            const at = deskAt(plan, p);
            if (at) {
                reached.add(at);
            }
            for (const [dx, dy] of [
                [3, 0],
                [-3, 0],
                [0, 3],
                [0, -3],
            ]) {
                const q = { x: p.x + dx, y: p.y + dy };
                if (!seen.has(key(q)) && canWalk(plan, q)) {
                    seen.add(key(q));
                    queue.push(q);
                }
            }
        }
        expect([...reached].sort()).toEqual([...plan.desks, ...plan.seats].map((s) => s.key).sort());
    });

    it("stops the boss in front of a desk, and lets it walk off one it stands on", () => {
        const d = plan.desks.find((x) => x.key === "a1")!;
        const up = stepToward(plan, a1, "up", 200);
        expect(up.y).toBeGreaterThan(d.y + 40);
        expect(canWalk(plan, up)).toBe(true);
        // walking up to the desk keeps the boss at it
        expect(deskAt(plan, up)).toBe("a1");
        const onDesk = { x: d.x + 40, y: d.y + 10 };
        expect(stepToward(plan, onDesk, "down", 200).y).toBeGreaterThan(onDesk.y);
    });

    it("offers the cursor's card only while the boss stands still at it", () => {
        const still = { at: a1, path: [] };
        expect(cardAt(plan, still, "a1")?.desk?.key).toBe("a1");
        expect(cardAt(plan, still, "a1")?.room.key).toBe(plan.desks.find((d) => d.key === "a1")!.room);
        expect(cardAt(plan, { at: spotOf(plan, "r1")!, path: [] }, "r1")?.seat?.key).toBe("r1");
        expect(cardAt(plan, still, "r1")).toBeUndefined();
        expect(cardAt(plan, still, undefined)).toBeUndefined();
        expect(cardAt(plan, null, "a1")).toBeUndefined();
        expect(cardAt(plan, { at: a1, path: [a1, spotOf(plan, "r1")!] }, "a1")).toBeUndefined();
        expect(cardAt(plan, { ...still, holding: "left" }, "a1")).toBeUndefined();
    });

    it("changes the boss's look only when it turns, sets off or stops, not on each step of a walk", () => {
        const b = spotOf(plan, "r1")!;
        const path = pathBetween(plan, a1, b);
        const step1 = { at: a1, path, dir: "down" as const };
        const r = advance(path, 30);
        const step2 = { ...step1, at: r.at, path: r.rest };
        expect(bossLook(step1)).toEqual({ moving: true, dir: "down" });
        expect(bossLook(step2)).toEqual(bossLook(step1));
        expect(bossLook({ ...step2, dir: "right" })).not.toEqual(bossLook(step1));
        // standing still, the look holds the spot the card beside the desk is placed from
        expect(bossLook({ at: a1, path: [], dir: "up" })).toEqual({ moving: false, dir: "up", rest: a1 });
        // an arrow held down is walking, with or without a path
        expect(bossLook({ at: a1, path: [], dir: "left", holding: "left" })).toEqual({ moving: true, dir: "left" });
        expect(bossLook(null)).toBeNull();
    });

    it("orders j/k stops band by band: the agents' room by rows, then its meeting seats, Home last", () => {
        const p = buildPlan({
            agents: [
                ag("z9", "zeta"),
                ag("a4", "alpha"),
                ag("a2", "alpha"),
                ag("a3", "alpha"),
                ag("a1", "alpha"),
                ag("h2"),
                ag("h1"),
            ],
            runs: [
                { ...run("rz", "zeta") },
                {
                    ...run("ra", "alpha"),
                    tasks: [
                        { id: "t1", label: "t1", state: "running", asking: false, key: "ra:t1" },
                        { id: "t2", label: "t2", state: "running", asking: false, key: "ra:t2" },
                    ],
                },
            ],
            width: 1050,
            now: 0,
            away: {},
            night: false,
        });
        // alpha's four agents run by rows of three, then its run's lead and tasks; zeta next; Home's agents last
        expect(p.order).toEqual(["a1", "a2", "a3", "a4", "ra", "ra:t1", "ra:t2", "z9", "rz", "rz:t1", "h1", "h2"]);
    });

    it("walks n's target through both doors, on floor, with its dots starting at the boss", () => {
        const p = buildPlan({
            agents: [ag("a1", "alpha"), ag("b1", "beta"), ag("b2", "beta", "asking"), ag("c1", "gamma")],
            runs: [run("r1", "alpha")],
            width: 1050,
            now: 0,
            away: {},
            night: false,
        });
        expect(p.asks).toEqual(["b2"]);
        const from = spotOf(p, "a1")!;
        const to = spotOf(p, p.asks[0])!;
        const path = pathBetween(p, from, to);
        expect(offFloor(p, path)).toEqual([]);
        expect(nearDoorMiddle(path, p.rooms.find((r) => r.key === "room:alpha")!)).toBe(true);
        expect(nearDoorMiddle(path, p.rooms.find((r) => r.key === "room:beta")!)).toBe(true);
        expect(dotsAlong(path)[0]).toEqual(from);
    });
});
