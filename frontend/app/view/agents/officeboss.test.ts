// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
    advance,
    bossLook,
    canStand,
    canWalk,
    cardAt,
    carriedStop,
    deskAt,
    dotsAlong,
    facing,
    pathBetween,
    roomAt,
    spotOf,
    stepToward,
} from "./officeboss";
import {
    BOARD_KEY,
    BOSS_H,
    BOSS_HALF_W,
    BOSS_HEADROOM,
    buildPlan,
    HWALL,
    LIFT_KEY,
    type Plan,
    type PlanAgent,
    type Point,
} from "./officeplanmodel";

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
// a floor with all four rooms taken (Home, a, b, c), the rooms narrow and short, asks and runs among them
const full = buildPlan({
    agents: [
        ...["a", "b", "c"].flatMap((p) => [ag(`${p}1`, p), ag(`${p}2`, p, "asking")]),
        ...[1, 2, 3, 4, 5].map((i) => ag(`h${i}`)),
    ],
    runs: [run("r1", "a"), run("r2", "c")],
    width: 900,
    now: 0,
    away: {},
    night: false,
});
// a floor above G: Home and alpha stay on G, beta is alone in the last slot of floor 1, the other three rooms empty
const upstairs = buildPlan({
    agents: [ag("a1", "alpha"), ag("b1", "beta"), ag("b2", "beta"), ag("h1")],
    runs: [run("r1", "beta")],
    width: 1050,
    floor: 1,
    at: { Home: { floor: 0, slot: 0 }, alpha: { floor: 0, slot: 1 }, beta: { floor: 1, slot: 3 } },
    now: 0,
    away: {},
    night: false,
});
// one project: its three other rooms are empty
const lone = buildPlan({ agents: [ag("a1", "alpha")], runs: [], width: 1050, now: 0, away: {}, night: false });

// every 3 px along every segment must pass: a corner check alone would let a path cut through a wall or a desk
function offWhere(ok: (p: Plan, q: Point) => boolean, p: Plan, path: Point[]): Point[] {
    const bad: Point[] = [];
    for (let i = 0; i < path.length - 1; i++) {
        const a = path[i];
        const b = path[i + 1];
        const len = Math.hypot(b.x - a.x, b.y - a.y);
        for (let d = 0; d <= len; d += 3) {
            const q = { x: a.x + ((b.x - a.x) * d) / (len || 1), y: a.y + ((b.y - a.y) * d) / (len || 1) };
            if (!ok(p, q)) {
                bad.push(q);
            }
        }
        if (!ok(p, b)) {
            bad.push(b);
        }
    }
    return bad;
}
// off the floor: in a wall or the next room
const offFloor = (p: Plan, path: Point[]) => offWhere(canStand, p, path);
// over furniture: a desk, a table, the sofa, a plant
const overFurniture = (p: Plan, path: Point[]) => offWhere(canWalk, p, path);
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
        // alpha is in the right column: its wall is on its right, its door on its left
        const r = room("room:alpha");
        const blocked = stepToward(plan, a1, "right", 600);
        expect(blocked.x).toBeLessThanOrEqual(r.box.x + r.box.w);
        expect(roomAt(plan, blocked)).toBe("room:alpha");
        const atDoor = { x: r.door!.x + r.door!.w + 8, y: r.door!.y + r.door!.h / 2 };
        expect(roomAt(plan, stepToward(plan, atDoor, "left", 60))).toBe("hall");
        // Home is in the left column: the other way round
        const home = room("room:Home");
        const homeDoor = { x: home.door!.x - 8, y: home.door!.y + home.door!.h / 2 };
        expect(roomAt(plan, stepToward(plan, homeDoor, "right", 60))).toBe("hall");
    });

    it("does not tunnel through a wall on a long step", () => {
        const r = room("room:alpha");
        const nearWall = { x: r.box.x + r.box.w - BOSS_HALF_W - 3, y: a1.y };
        expect(stepToward(plan, nearWall, "right", 30).x).toBeLessThanOrEqual(r.box.x + r.box.w - BOSS_HALF_W);
        // a 100 ms hitch at the boss's speed is a 16 px step: still no wall crossed
        expect(canStand(plan, stepToward(plan, nearWall, "right", 16))).toBe(true);
    });

    it("keeps all of the boss's body on its floor: off the side walls, its head under the wall behind it", () => {
        const r = room("room:alpha");
        // alpha's right wall, and the hall's two walls
        const right = stepToward(plan, a1, "right", 600).x;
        expect(right).toBeLessThanOrEqual(r.box.x + r.box.w - BOSS_HALF_W);
        expect(right).toBeGreaterThan(r.box.x + r.box.w - BOSS_HALF_W - 3);
        // at the lift, clear of every door
        const inHall = plan.lift.spot;
        const left = stepToward(plan, inHall, "left", 600).x;
        expect(left).toBeGreaterThanOrEqual(plan.hall.x + BOSS_HALF_W);
        expect(left).toBeLessThan(plan.hall.x + BOSS_HALF_W + 3);
        expect(stepToward(plan, inHall, "right", 600).x).toBeLessThanOrEqual(plan.hall.x + plan.hall.w - BOSS_HALF_W);
        // the wall over a room, here an empty one under another: the head, BOSS_HEADROOM + HWALL over the feet, reaches
        // the top of that wall and stays out of the room above
        const empty = plan.rooms.find((x) => x.kind === "empty")!;
        expect(empty.box.y).toBeGreaterThan(plan.hall.y);
        const up = stepToward(plan, { x: empty.box.x + empty.box.w / 2, y: empty.box.y + 200 }, "up", 600);
        expect(up.y).toBeGreaterThanOrEqual(empty.box.y + BOSS_HEADROOM);
        expect(up.y).toBeLessThan(empty.box.y + BOSS_HEADROOM + 3);
        expect(up.y - BOSS_H).toBeGreaterThanOrEqual(empty.box.y - HWALL);
        expect(canStand(plan, { x: up.x, y: empty.box.y + BOSS_HEADROOM - 1 })).toBe(false);
        // the lounge under the outer wall: no head over the top of the view
        expect(canStand(plan, { x: plan.hall.x + 100, y: plan.hall.y + BOSS_HEADROOM - 1 })).toBe(false);
        expect(canStand(plan, { x: plan.hall.x + 100, y: plan.hall.y + BOSS_HEADROOM })).toBe(true);
        // the door still lets it through, though the body is wider than the wall
        const door = r.door!;
        const inDoor = { x: door.x + door.w + BOSS_HALF_W, y: door.y + door.h / 2 };
        expect(roomAt(plan, stepToward(plan, inDoor, "left", 2 * BOSS_HALF_W + door.w + 9))).toBe("hall");
        // but not above or below its opening
        expect(canStand(plan, { x: door.x + door.w + 6, y: door.y - 3 })).toBe(false);
        expect(canStand(plan, { x: door.x + door.w + 6, y: door.y + door.h + 3 })).toBe(false);
    });

    it("walks out of one room, across the hall and into another, on floor all the way and round every desk", () => {
        const b1 = spotOf(plan, "b1")!;
        const path = pathBetween(plan, a1, b1);
        expect(path[0]).toEqual(a1);
        expect(path[path.length - 1]).toEqual(b1);
        for (const p of path) {
            expect(canStand(plan, p), JSON.stringify(p)).toBe(true);
        }
        expect(offFloor(plan, path)).toEqual([]);
        expect(overFurniture(plan, path)).toEqual([]);
        // nothing between two desks of a row: straight
        const a2 = spotOf(plan, "a2")!;
        expect(pathBetween(plan, a1, a2)).toEqual([a1, a2]);
        const h1 = spotOf(plan, "h1")!;
        const home = pathBetween(plan, a1, h1);
        expect(home.every((p) => canStand(plan, p))).toBe(true);
        expect(offFloor(plan, home)).toEqual([]);
        expect(overFurniture(plan, home)).toEqual([]);
        expect(offFloor(plan, pathBetween(plan, h1, spotOf(plan, "r1")!))).toEqual([]);
        expect(overFurniture(plan, pathBetween(plan, h1, spotOf(plan, "r1")!))).toEqual([]);
    });

    it("walks round a desk, never over it, to the floor on its far side", () => {
        const d = plan.desks.find((x) => x.key === "a1")!;
        // straight up from a1's spot is a1's desk and the person at it; over them is the floor under the room's top wall
        const above = { x: a1.x, y: d.y - 24 };
        expect(canWalk(plan, above)).toBe(true);
        const path = pathBetween(plan, a1, above);
        expect(path[0]).toEqual(a1);
        expect(path[path.length - 1]).toEqual(above);
        expect(path.length).toBeGreaterThan(2);
        expect(overFurniture(plan, path)).toEqual([]);
        expect(offFloor(plan, path)).toEqual([]);
        expect(path.every((p) => roomAt(plan, p) === "room:alpha")).toBe(true);
        // and back
        expect(overFurniture(plan, pathBetween(plan, above, a1))).toEqual([]);
    });

    it("walks every desk and seat to every other on a full floor round the furniture, never over it", () => {
        const spots = [
            ...full.desks.map((d) => d.spot),
            ...full.seats.map((s) => s.spot),
            full.board.spot,
            full.lift.spot,
        ];
        for (const a of spots) {
            for (const b of spots) {
                const path = pathBetween(full, a, b);
                expect(path[0]).toEqual(a);
                expect(path[path.length - 1]).toEqual(b);
                expect(overFurniture(full, path), JSON.stringify([a, b])).toEqual([]);
                expect(offFloor(full, path), JSON.stringify([a, b])).toEqual([]);
            }
        }
    });

    it("walks a walker from its desk to the coffee machine and the sofa, round the desks, the last steps onto them", () => {
        for (const to of [plan.coffee, plan.sofa]) {
            // the spot at the machine and the seat on the sofa are furniture: the way stays on the floor up to them
            expect(canWalk(plan, to)).toBe(false);
            const path = pathBetween(plan, a1, to);
            expect(path[0]).toEqual(a1);
            expect(path[path.length - 1]).toEqual(to);
            expect(offFloor(plan, path)).toEqual([]);
            // only the stretch onto the furniture at the end is off the walkable floor
            const over = overFurniture(plan, path);
            expect(
                over.every((q) => Math.hypot(q.x - to.x, q.y - to.y) <= 60),
                JSON.stringify(over)
            ).toBe(true);
        }
    });

    it("walks from every desk to every other desk and seat on a full floor, never off the floor", () => {
        const keys = [...full.desks.map((d) => d.key), ...full.seats.map((s) => s.key)];
        // Home's narrow room seats two of its five, the rest are in its chip
        expect(full.desks.filter((d) => d.room === "room:Home")).toHaveLength(2);
        expect(full.rooms.filter((r) => r.kind === "agents")).toHaveLength(4);
        for (const from of keys) {
            for (const to of keys) {
                const path = pathBetween(full, spotOf(full, from)!, spotOf(full, to)!);
                expect(offFloor(full, path), `${from} -> ${to}`).toEqual([]);
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

    it("finds the desk or seat at the boss, and none elsewhere in the hall", () => {
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
        const t = room(plan.seats.find((x) => x.key === "r1")!.zone).table!;
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
        const pls = room("room:alpha").plants!;
        expect(pls.length).toBeGreaterThan(0);
        for (const pl of pls) {
            expect(canWalk(plan, { x: pl.x + 17, y: pl.y + 35 })).toBe(false); // the room's plants: each pot
        }
        expect(canWalk(plan, { x: l.x + 100, y: l.y + 100 })).toBe(true); // the rug, facing the sofa
        expect(canWalk(plan, { x: l.x + 100, y: l.y + 200 })).toBe(true); // behind it
        expect(stepToward(plan, { x: l.x + 100, y: l.y + 210 }, "up", 200).y).toBeGreaterThan(l.y + 188);
    });

    it("puts a pot wherever a room has a plant, and nowhere else", () => {
        const withPlant = [...plan.rooms, ...full.rooms].filter((r) => r.plants?.length);
        expect(withPlant.length).toBeGreaterThan(0);
        for (const r of full.rooms.filter((x) => x.kind === "agents")) {
            // the old bottom-right plant is gone from every room
            expect(canWalk(full, { x: r.box.x + r.box.w - BOSS_HALF_W, y: r.box.y + r.box.h - 28 }), r.key).toBe(true);
            for (const p of r.plants ?? []) {
                expect(canWalk(full, { x: p.x + 17, y: p.y + 35 }), r.key).toBe(false);
            }
        }
        // a room with no plant (its first row full, a table in its strip) has no pot either
        const bare = full.rooms.filter((r) => r.kind === "agents" && !r.plants?.length);
        expect(bare.length).toBeGreaterThan(0);
    });

    it.each([
        ["a floor", plan, a1],
        ["a full floor", full, spotOf(full, "a1")!],
        ["a floor above G", upstairs, spotOf(upstairs, "b1")!],
    ] as [string, Plan, Point][])(
        "leaves every desk, seat, chip, the board and the lift within a walk of every other, around all the furniture: %s",
        (_, p, start) => {
            const key = (q: Point) => `${q.x},${q.y}`;
            const seen = new Set([key(start)]);
            const reached = new Set<string>();
            const queue = [start];
            while (queue.length) {
                const q = queue.pop()!;
                const at = deskAt(p, q);
                if (at) {
                    reached.add(at);
                }
                for (const [dx, dy] of [
                    [3, 0],
                    [-3, 0],
                    [0, 3],
                    [0, -3],
                ]) {
                    const n = { x: q.x + dx, y: q.y + dy };
                    if (!seen.has(key(n)) && canWalk(p, n)) {
                        seen.add(key(n));
                        queue.push(n);
                    }
                }
            }
            // the notice board's spot, the lift's and a chip's are places the boss reaches on foot
            expect([...reached].sort()).toEqual(
                [
                    BOARD_KEY,
                    LIFT_KEY,
                    ...p.desks.map((d) => d.key),
                    ...p.seats.map((s) => s.key),
                    ...p.rooms.flatMap((r) => (r.chip ? [r.chip.key] : [])),
                ].sort()
            );
        }
    );

    describe("the notice board", () => {
        const spot = plan.board.spot;
        const centre = { x: plan.board.box.x + plan.board.box.w / 2, y: plan.board.box.y + plan.board.box.h / 2 };

        it("is furniture the boss's feet stay off, with its spot in front of it", () => {
            expect(canWalk(plan, centre)).toBe(false);
            expect(canStand(plan, centre)).toBe(true); // still floor, for a jump's path
            expect(canWalk(plan, spot)).toBe(true);
        });

        it("is at the board within reach of its spot, only in the hall", () => {
            expect(deskAt(plan, spot)).toBe(BOARD_KEY);
            expect(deskAt(plan, { x: spot.x + 12, y: spot.y - 12 })).toBe(BOARD_KEY);
            expect(deskAt(plan, { x: spot.x + 60, y: spot.y })).toBeUndefined();
            expect(deskAt(plan, { x: spot.x, y: spot.y - 40 })).toBeUndefined();
        });

        it("stops the boss in front of the board and keeps it at the board there", () => {
            const up = stepToward(plan, spot, "up", 200);
            expect(up.y).toBeGreaterThan(plan.board.box.y + plan.board.box.h);
            expect(deskAt(plan, up)).toBe(BOARD_KEY);
        });

        it("is where spotOf stands for its key", () => {
            expect(spotOf(plan, BOARD_KEY)).toEqual(spot);
        });

        it("offers its dialog only while the boss stands still at it with the cursor on it", () => {
            expect(cardAt(plan, { at: spot, path: [] }, BOARD_KEY)).toEqual({ board: true });
            expect(cardAt(plan, { at: a1, path: [] }, BOARD_KEY)).toBeUndefined();
            expect(cardAt(plan, { at: spot, path: [] }, "a1")).toBeUndefined();
            expect(cardAt(plan, { at: spot, path: [spot, a1] }, BOARD_KEY)).toBeUndefined();
            expect(cardAt(plan, { at: spot, path: [], holding: "left" }, BOARD_KEY)).toBeUndefined();
        });

        it("walks from a desk, a seat and Home's room to it, on floor all the way", () => {
            for (const from of ["a1", "b1", "r1", "h1"]) {
                const path = pathBetween(plan, spotOf(plan, from)!, spot);
                expect(path[path.length - 1], from).toEqual(spot);
                expect(offFloor(plan, path), from).toEqual([]);
                const back = pathBetween(plan, spot, spotOf(plan, from)!);
                expect(offFloor(plan, back), from).toEqual([]);
            }
        });

        it("stays on the floor of a full floor too", () => {
            for (const key of [...full.desks.map((d) => d.key), ...full.seats.map((s) => s.key)]) {
                expect(offFloor(full, pathBetween(full, spotOf(full, key)!, full.board.spot)), key).toEqual([]);
                expect(offFloor(full, pathBetween(full, full.board.spot, spotOf(full, key)!)), key).toEqual([]);
            }
            expect(canWalk(full, full.board.spot)).toBe(true);
        });
    });

    describe("a project room and the table zones in it", () => {
        it("is one room: a point in a table zone is in the project's room, never the zone's", () => {
            const zones = [...plan.rooms, ...full.rooms].filter((r) => r.kind === "meeting");
            expect(zones.length).toBeGreaterThan(0);
            for (const z of zones) {
                const p = plan.rooms.includes(z) ? plan : full;
                const centre = { x: z.box.x + z.box.w / 2, y: z.box.y + z.box.h / 2 };
                expect(roomAt(p, centre), z.key).toBe(z.parent);
                expect(roomAt(p, { x: z.box.x + 2, y: z.box.y + 2 }), z.key).toBe(z.parent);
            }
            // the lounge is part of the hall
            expect(roomAt(plan, { x: plan.lounge.x + 100, y: plan.lounge.y + 100 })).toBe("hall");
        });

        it("has its seats' spots in the project's room: the seat is the one at the boss there", () => {
            for (const s of plan.seats) {
                expect(s.room).toBe("room:alpha");
                expect(roomAt(plan, s.spot), s.key).toBe(s.room);
                expect(deskAt(plan, s.spot), s.key).toBe(s.key);
            }
            expect(deskAt(full, spotOf(full, "r2")!)).toBe("r2");
        });

        it("walks from a desk to a seat in the same room, in the room and round its table", () => {
            const r1 = spotOf(plan, "r1")!;
            for (const [a, b] of [
                [a1, r1],
                [r1, a1],
            ]) {
                const path = pathBetween(plan, a, b);
                expect(path[0]).toEqual(a);
                expect(path[path.length - 1]).toEqual(b);
                expect(path.every((p) => roomAt(plan, p) === "room:alpha")).toBe(true);
                expect(overFurniture(plan, path)).toEqual([]);
            }
        });

        it("goes out one door, across the hall and in the other between rooms of two columns", () => {
            const alpha = room("room:alpha");
            const beta = room("room:beta");
            expect(alpha.doorSide).not.toBe(beta.doorSide);
            const path = pathBetween(plan, a1, spotOf(plan, "b1")!);
            // alpha, then the hall, then beta, each once
            const rooms = path.map((p) => roomAt(plan, p)).filter((r, i, all) => i === 0 || r !== all[i - 1]);
            expect(rooms).toEqual([alpha.key, "hall", beta.key]);
            expect(nearDoorMiddle(path, alpha)).toBe(true);
            expect(nearDoorMiddle(path, beta)).toBe(true);
            expect(offFloor(plan, path)).toEqual([]);
            expect(overFurniture(plan, path)).toEqual([]);
        });
    });

    describe("a room's +N chip", () => {
        const home = full.rooms.find((r) => r.key === "room:Home")!;
        const chip = home.chip!;

        it("is a stop with its spot under it, in its room, on foot", () => {
            expect(chip).toBeDefined();
            expect(roomAt(full, chip.spot)).toBe(home.key);
            expect(canWalk(full, chip.spot)).toBe(true);
            expect(spotOf(full, chip.key)).toEqual(chip.spot);
        });

        it("is at the chip within reach of its spot, in its own room only", () => {
            expect(deskAt(full, chip.spot)).toBe(chip.key);
            expect(deskAt(full, { x: chip.spot.x - 12, y: chip.spot.y + 12 })).toBe(chip.key);
            expect(deskAt(full, { x: chip.spot.x - 60, y: chip.spot.y })).toBeUndefined();
            expect(deskAt(full, { x: chip.spot.x, y: chip.spot.y + 40 })).toBeUndefined();
            // a desk's spot in the same room is that desk's, not the chip's
            expect(deskAt(full, spotOf(full, "h1")!)).toBe("h1");
        });

        it("offers its dialog only while the boss stands still at it with the cursor on it", () => {
            const at = { at: chip.spot, path: [] };
            expect(cardAt(full, at, chip.key)).toEqual({ room: home, chip: true });
            expect(cardAt(full, at, "h1")).toBeUndefined();
            expect(cardAt(full, { at: spotOf(full, "h1")!, path: [] }, chip.key)).toBeUndefined();
            expect(cardAt(full, { at: chip.spot, path: [chip.spot, spotOf(full, "h1")!] }, chip.key)).toBeUndefined();
            expect(cardAt(full, { ...at, holding: "left" }, chip.key)).toBeUndefined();
        });

        it("walks from every stop to it and back, on floor all the way", () => {
            const keys = [...full.desks.map((d) => d.key), ...full.seats.map((s) => s.key), BOARD_KEY, LIFT_KEY];
            for (const key of keys) {
                expect(offFloor(full, pathBetween(full, spotOf(full, key)!, chip.spot)), key).toEqual([]);
                expect(offFloor(full, pathBetween(full, chip.spot, spotOf(full, key)!)), key).toEqual([]);
            }
        });
    });

    describe("the lift", () => {
        const { doors, dial, spot } = plan.lift;
        const centre = (b: { x: number; y: number; w: number; h: number }) => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 });

        it("is furniture the boss's feet stay off, doors and dial both, with its spot in front of it", () => {
            expect(canWalk(plan, centre(doors))).toBe(false);
            expect(canWalk(plan, centre(dial))).toBe(false);
            expect(canStand(plan, centre(doors))).toBe(true); // still floor, for a jump's path
            expect(canStand(plan, spot)).toBe(true);
            expect(canWalk(plan, spot)).toBe(true);
        });

        it("is at the lift within reach of its spot, only in the hall", () => {
            expect(deskAt(plan, spot)).toBe(LIFT_KEY);
            expect(deskAt(plan, { x: spot.x + 12, y: spot.y - 12 })).toBe(LIFT_KEY);
            expect(deskAt(plan, { x: spot.x + 60, y: spot.y })).toBeUndefined();
            expect(deskAt(plan, { x: spot.x, y: spot.y - 40 })).toBeUndefined();
            // the board's spot is a long way up the hall: the two never answer for each other
            expect(deskAt(plan, plan.board.spot)).toBe(BOARD_KEY);
        });

        it("stops the boss in front of the doors and the dial, and keeps it at the lift there", () => {
            const down = stepToward(plan, spot, "down", 200);
            expect(down.y).toBeLessThan(dial.y);
            expect(deskAt(plan, down)).toBe(LIFT_KEY);
            const sideways = stepToward(plan, { x: doors.x - 20, y: doors.y + 20 }, "right", 200);
            expect(sideways.x).toBeLessThan(doors.x);
        });

        it("is where spotOf stands for its key", () => {
            expect(spotOf(plan, LIFT_KEY)).toEqual(spot);
        });

        it("offers its panel only while the boss stands still at it with the cursor on it", () => {
            expect(cardAt(plan, { at: spot, path: [] }, LIFT_KEY)).toEqual({ lift: true });
            expect(cardAt(plan, { at: a1, path: [] }, LIFT_KEY)).toBeUndefined();
            expect(cardAt(plan, { at: spot, path: [] }, BOARD_KEY)).toBeUndefined();
            expect(cardAt(plan, { at: spot, path: [spot, a1] }, LIFT_KEY)).toBeUndefined();
            expect(cardAt(plan, { at: spot, path: [], holding: "down" }, LIFT_KEY)).toBeUndefined();
        });

        it.each([
            ["a floor", plan],
            ["a full floor", full],
            ["a floor above G", upstairs],
        ] as [string, Plan][])("walks from every desk, seat and the board to it and back, on floor: %s", (_, p) => {
            const keys = [...p.desks.map((d) => d.key), ...p.seats.map((s) => s.key), BOARD_KEY];
            for (const key of keys) {
                expect(offFloor(p, pathBetween(p, spotOf(p, key)!, p.lift.spot)), key).toEqual([]);
                expect(offFloor(p, pathBetween(p, p.lift.spot, spotOf(p, key)!)), key).toEqual([]);
            }
        });
    });

    describe("an empty room", () => {
        const empties = lone.rooms.filter((r) => r.kind === "empty");

        it("can be walked into through its door, and out", () => {
            expect(empties).toHaveLength(3);
            for (const e of empties) {
                const d = e.door!;
                const left = e.doorSide === "left";
                const outside = { x: left ? d.x - 8 : d.x + d.w + 8, y: d.y + d.h / 2 };
                expect(roomAt(lone, outside), e.key).toBe("hall");
                expect(roomAt(lone, stepToward(lone, outside, left ? "right" : "left", 60)), e.key).toBe(e.key);
                const inside = { x: left ? d.x + d.w + 20 : d.x - 20, y: d.y + d.h / 2 };
                expect(roomAt(lone, stepToward(lone, inside, left ? "left" : "right", 60)), e.key).toBe("hall");
            }
        });

        it("is on the way of a jump into it, through its door's middle, on floor", () => {
            const from = spotOf(lone, "a1")!;
            for (const e of empties) {
                const to = { x: e.box.x + e.box.w / 2, y: e.box.y + e.box.h / 2 };
                expect(roomAt(lone, to), e.key).toBe(e.key);
                const path = pathBetween(lone, from, to);
                expect(offFloor(lone, path), e.key).toEqual([]);
                expect(nearDoorMiddle(path, e), e.key).toBe(true);
                expect(offFloor(lone, pathBetween(lone, to, from)), e.key).toEqual([]);
            }
        });
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

    it("orders j/k stops room by room: Home first, each room's desks by rows, then its table's seats, then its chip", () => {
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
        // Home's room is the first slot; alpha's fourth agent has no desk (a room seats three at this width) and is in
        // its chip, which comes after its run's lead and tasks; zeta's room next
        expect(p.order).toEqual([
            ...["h1", "h2"],
            ...["a1", "a2", "a3", "ra", "ra:t1", "ra:t2", "chip:room:alpha"],
            ...["z9", "rz", "rz:t1"],
        ]);
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

describe("carriedStop", () => {
    it("keeps the cursor's stop when it is a desk or a seat of the carried room", () => {
        expect(carriedStop(plan, "room:alpha", "a2")).toBe("a2");
        expect(carriedStop(plan, "room:alpha", "r1")).toBe("r1");
    });

    it("goes to the room's first desk when the cursor is elsewhere, on the lift or nowhere", () => {
        expect(carriedStop(plan, "room:alpha", "b1")).toBe("a1");
        expect(carriedStop(plan, "room:alpha", LIFT_KEY)).toBe("a1");
        expect(carriedStop(plan, "room:beta", undefined)).toBe("b1");
    });

    it("keeps the cursor on the room's chip, which is a stop of it", () => {
        const chip = full.rooms.find((r) => r.chip)!;
        expect(carriedStop(full, chip.key, chip.chip!.key)).toBe(chip.chip!.key);
    });

    it("is none for a room with no one, and for a room that is not on the floor", () => {
        expect(carriedStop(lone, "empty:0:1", "a1")).toBeUndefined();
        expect(carriedStop(upstairs, "room:alpha", "a1")).toBeUndefined();
    });
});
