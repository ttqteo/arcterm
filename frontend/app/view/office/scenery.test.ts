// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { buildPlan, MEET_H, type Box, type Plan, type PlanInput } from "@/app/view/agents/officeplanmodel";
import { describe, expect, it } from "vitest";
import { NEAR_CHAIR } from "./officegrids";
import type { OfficeColors } from "./officepalette";
import {
    art,
    boardArt,
    CELL,
    materialAt,
    outerWindows,
    rasterise,
    rasteriseProp,
    scenery,
    sceneryKey,
    type Op,
    type Prop,
} from "./scenery";

const NOW = Date.parse("2026-10-15T14:20:00");
function input(width = 1050, over: Partial<PlanInput> = {}): PlanInput {
    const a = (id: string, project: string | undefined, state: "asking" | "working" | "idle", idleMin?: number) => ({
        id,
        name: id,
        project,
        state,
        harness: "claude",
        finished: idleMin != null && idleMin < 5,
        idleSince: idleMin != null ? NOW - idleMin * 60_000 : undefined,
    });
    const task = (run: string, i: number, state: string) => ({
        id: `t${i}`,
        label: `Task ${i}`,
        state,
        asking: false,
        key: `${run}:t${i}`,
    });
    return {
        agents: [
            a("loom", "arcterm", "working"),
            a("quill", "arcterm", "asking"),
            a("sable", "arcterm", "idle", 1),
            a("harbor", "mozox", "working"),
            a("scratch", undefined, "idle", 7),
        ],
        runs: [
            {
                id: "run-b",
                title: "Billing export",
                project: "mozox",
                createdTs: 1,
                done: false,
                leadAsking: false,
                tasks: ["done", "running", "stalled", "failed", "pending"].map((s, i) => task("run-b", i + 1, s)),
            },
        ],
        width,
        now: NOW,
        away: {},
        night: false,
        ...over,
    };
}
const plan = (width?: number, over?: Partial<PlanInput>): Plan => buildPlan(input(width, over));
// the same cards over three floors: Home on G, arcterm on 1, mozox (and its run's table) on 2
const FLOORS_AT = {
    Home: { floor: 0, slot: 0 },
    arcterm: { floor: 1, slot: 0 },
    mozox: { floor: 2, slot: 3 },
};
const onFloor = (floor: number, over: Partial<PlanInput> = {}): Plan => plan(1050, { at: FLOORS_AT, floor, ...over });
type RectOp = Extract<Op, { k: "rect" }>;
type FillOp = Extract<Op, { k: "fill" }>;
const rects = (ops: Op[], role: string) => ops.filter((o) => o.k === "rect" && o.role === role) as RectOp[];
const fills = (ops: Op[], material: string) => ops.filter((o) => o.k === "fill" && o.material === material) as FillOp[];
const lastIndex = (ops: Op[], pred: (o: Op) => boolean) => ops.map(pred).lastIndexOf(true);
const firstIndex = (ops: Op[], pred: (o: Op) => boolean) => ops.findIndex(pred);
// a plan box on the art grid, as scenery.ts lays it
const artOf = (b: Box): Box => {
    const x = art(b.x);
    const y = art(b.y);
    return { x, y, w: art(b.x + b.w) - x, h: art(b.y + b.h) - y };
};
const isFill = (material: string, b: Box) => (o: Op) =>
    o.k === "fill" && o.material === material && o.x === b.x && o.y === b.y && o.w === b.w && o.h === b.h;
const within = (o: Box, b: Box) => o.x >= b.x && o.y >= b.y && o.x + o.w <= b.x + b.w && o.y + o.h <= b.y + b.h;

describe("scenery", () => {
    it("sizes the canvases to cover the plan, on the art grid, at any width", () => {
        for (const w of [900, 1001, 1050]) {
            const p = plan(w);
            const s = scenery(p, "day", false);
            expect(s.width * 3).toBeGreaterThanOrEqual(p.width);
            expect(s.height * 3).toBeGreaterThanOrEqual(p.height);
            // the right outer wall is drawn inside the canvas
            expect(s.over.some((o) => o.k === "rect" && o.role === "cap" && o.x + o.w >= s.width - 3)).toBe(true);
        }
    });

    it("draws the notice board in the hall at plan.board.box: its cork inside its frame", () => {
        const p = plan();
        const s = scenery(p, "day", false);
        const { frame, cork, legs } = boardArt(p.board.box);
        // the board's art box: the frame and the legs stand inside it, 3 CSS px to an art px
        const at = { x: art(p.board.box.x), y: art(p.board.box.y), w: art(p.board.box.w), h: art(p.board.box.h) };
        for (const r of [frame, ...legs]) {
            expect(r.x).toBeGreaterThanOrEqual(at.x);
            expect(r.y).toBeGreaterThanOrEqual(at.y);
            expect(r.x + r.w).toBeLessThanOrEqual(at.x + at.w);
            expect(r.y + r.h).toBeLessThanOrEqual(at.y + at.h);
        }
        // the frame is a trim box with an ink outline, the cork a desk-coloured rect inside it, drawn after it
        const frameAt = lastIndex(
            s.under,
            (o) => o.k === "rect" && o.role === "trim" && o.x === frame.x + 1 && o.y === frame.y + 1
        );
        const corkAt = lastIndex(
            s.under,
            (o) =>
                o.k === "rect" &&
                o.role === "desk" &&
                o.x === cork.x &&
                o.y === cork.y &&
                o.w === cork.w &&
                o.h === cork.h
        );
        expect(frameAt).toBeGreaterThanOrEqual(0);
        expect(corkAt).toBeGreaterThan(frameAt);
        expect(frame.x + 2).toBe(cork.x);
    });

    it("puts every op on whole art pixels", () => {
        const s = scenery(plan(1001, { night: true }), "after", true);
        for (const o of [...s.under, ...s.over]) {
            for (const [k, v] of Object.entries(o)) {
                // an alpha is a fraction (the sign's glow); every coordinate and size is a whole pixel
                if (typeof v === "number" && k !== "alpha") expect(Number.isInteger(v), JSON.stringify(o)).toBe(true);
            }
        }
    });

    it("puts each desk's chair and shadow under the people, its top and laptop over them", () => {
        const p = plan();
        const s = scenery(p, "day", false);
        for (const d of p.desks) {
            const x = art(d.x);
            const y = art(d.y);
            expect(
                rects(s.under, "chair").some((r) => r.x === x + 8 && r.y === y - 8),
                d.key
            ).toBe(true);
            expect(
                rects(s.under, "shadow").some((r) => r.x === x + 27 && r.y === y + 1),
                d.key
            ).toBe(true);
            expect(
                rects(s.over, "desk").some((r) => r.x === x + 1 && r.y === y + 1),
                d.key
            ).toBe(true);
            expect(
                rects(s.over, "laptop").some((r) => r.x === x + 8 && r.y === y - 2),
                d.key
            ).toBe(true);
        }
    });

    it("lights a laptop's logo with its desk's light", () => {
        const p = plan();
        const s = scenery(p, "day", false);
        const logo = (key: string) => {
            const d = p.desks.find((d) => d.key === key)!;
            return s.over.find(
                (o) => o.k === "rect" && o.x === art(d.x) + 12 && o.y === art(d.y) && o.w === 3
            ) as Extract<Op, { k: "rect" }>;
        };
        expect(logo("loom").role).toBe("working");
        expect(logo("quill").role).toBe("asking");
        expect(logo("sable").role).toBe("laptopOff");
    });

    it("puts the floors and the wall faces under the people, and no floor over them", () => {
        const s = scenery(plan(), "day", false);
        for (const m of ["wood", "tiles", "carpet", "face", "brick"]) {
            expect(
                s.under.some((o) => o.k === "fill" && o.material === m),
                m
            ).toBe(true);
        }
        expect(s.over.some((o) => o.k === "fill")).toBe(false);
    });

    it("puts the tables' tops and the sofa's back over the people, the sofa's seat and arms under them", () => {
        const p = plan();
        const s = scenery(p, "day", false);
        for (const r of p.rooms.filter((r) => r.table)) {
            const at = (o: Extract<Op, { k: "rect" }>) => o.x === art(r.table!.x) + 1 && o.y === art(r.table!.y) + 1;
            expect(rects(s.over, "desk").some(at), r.key).toBe(true);
            expect(rects(s.under, "desk").some(at), r.key).toBe(false);
        }
        expect(rects(s.over, "sofaFace").length).toBeGreaterThan(0);
        expect(rects(s.under, "sofaFace")).toHaveLength(0);
        expect(rects(s.under, "sofa").length).toBeGreaterThan(0);
    });

    it("draws the near side's chairs over the table and the far side's under it", () => {
        const p = plan();
        const s = scenery(p, "day", false);
        const room = p.rooms.find((r) => r.table)!;
        const seated = p.seats.filter((x) => x.zone === room.key);
        // a run's lead and its tasks: more than the lead alone, or the loop below proves nothing
        expect(seated.length).toBeGreaterThan(2);
        for (const seat of seated) {
            const near = seat.bottom > room.table!.y + 20;
            const at = (o: Op) =>
                o.k === "grid" && o.rows === NEAR_CHAIR && o.x === art(seat.x - 3) && o.y === art(seat.bottom) - 6;
            expect(s.over.some(at), seat.key).toBe(near);
            expect(
                rects(s.under, "chair").some((r) => r.x === art(seat.x - 3) + 2 && r.y === art(seat.bottom) - 9),
                seat.key
            ).toBe(!near);
        }
    });

    it("lays the tints after the furniture and the caps after the tints", () => {
        const s = scenery(plan(), "after", false);
        const furniture = lastIndex(
            s.over,
            (o) => o.k === "rect" && (o.role === "desk" || o.role === "deskFace" || o.role === "sofaFace")
        );
        const tint = firstIndex(s.over, (o) => o.k === "rect" && (o.role === "dark" || o.role === "night"));
        const lastTint = lastIndex(
            s.over,
            (o) => (o.k === "rect" && (o.role === "dark" || o.role === "night")) || o.k === "pool"
        );
        const cap = firstIndex(s.over, (o) => o.k === "rect" && o.role === "cap");
        expect(furniture).toBeLessThan(tint);
        expect(lastTint).toBeLessThan(cap);
    });

    it("darkens a room with no one at work, its wall face included", () => {
        const p = plan();
        const home = p.rooms.find((r) => r.key === "room:Home")!;
        expect(home.lit).toBe(false);
        // the rooms of a column share their x, so the tint is found by its top as well
        const dark = rects(scenery(p, "day", false).over, "dark").find(
            (r) => r.x === art(home.box.x) && r.y === art(home.box.y) - 3
        )!;
        expect(dark).toBeDefined();
        expect(dark.h).toBe(art(home.box.y + home.box.h) - art(home.box.y) + 3);
    });

    it("tints the body and pools a lamp at each desk at work only after hours", () => {
        const p = plan(1050, { night: true });
        const after = scenery(p, "after", false);
        expect(rects(after.over, "night")).toHaveLength(1);
        expect(after.over.filter((o) => o.k === "pool").length).toBeGreaterThanOrEqual(
            p.desks.filter((d) => d.light !== "off").length
        );
        const day = scenery(plan(), "day", false);
        expect(rects(day.over, "night")).toHaveLength(0);
        expect(day.over.some((o) => o.k === "pool")).toBe(false);
    });

    it("puts a cup on every working desk when tired", () => {
        const p = plan();
        const working = p.desks.filter((d) => d.light === "working").length;
        expect(
            rects(scenery(p, "day", true).over, "cup").length - rects(scenery(p, "day", false).over, "cup").length
        ).toBe(working);
    });

    it("gives the floors their materials", () => {
        expect(materialAt("wood", 3, 5)).toBe("seam");
        expect(materialAt("tiles", 15, 3)).toBe("grout");
        expect(materialAt("tiles", 3, 31)).toBe("grout");
        expect(materialAt("brick", 0, 12, 10)).toBe("mortar");
        expect(["carpet", "carpet2"]).toContain(materialAt("carpet", 1, 1));
        expect(materialAt("face", 8, 0)).toBe("face2");
    });
});

describe("a floor's rooms", () => {
    it("lays a project room in wood, its meeting strip and its tables in carpet drawn after it", () => {
        const p = plan();
        const s = scenery(p, "day", false);
        const projects = p.rooms.filter((r) => r.kind === "agents");
        expect(projects.length).toBeGreaterThan(0);
        for (const r of projects) {
            const wood = firstIndex(s.under, isFill("wood", artOf(r.box)));
            expect(wood, r.key).toBeGreaterThanOrEqual(0);
            // the strip at the room's foot is carpet whether or not a run has a table in it
            const strip = artOf({ x: r.box.x, y: r.box.y + r.box.h - MEET_H, w: r.box.w, h: MEET_H });
            expect(firstIndex(s.under, isFill("carpet", strip)), r.key).toBeGreaterThan(wood);
        }
        const zones = p.rooms.filter((r) => r.kind === "meeting");
        expect(zones.length).toBeGreaterThan(0);
        for (const z of zones) {
            const room = p.rooms.find((r) => r.key === z.parent)!;
            const carpet = firstIndex(s.under, isFill("carpet", artOf(z.box)));
            expect(carpet, z.key).toBeGreaterThan(firstIndex(s.under, isFill("wood", artOf(room.box))));
            // a zone is not a room of wood
            expect(s.under.some(isFill("wood", artOf(z.box))), z.key).toBe(false);
        }
    });

    it("lays an empty room in carpet and darkens it, its wall face included", () => {
        const p = plan();
        const s = scenery(p, "day", false);
        const empty = p.rooms.filter((r) => r.kind === "empty");
        expect(empty).toHaveLength(1);
        for (const r of empty) {
            expect(r.lit).toBe(false);
            expect(s.under.some(isFill("carpet", artOf(r.box))), r.key).toBe(true);
            expect(s.under.some(isFill("wood", artOf(r.box))), r.key).toBe(false);
            const b = artOf(r.box);
            const dark = rects(s.over, "dark").find((d) => d.x === b.x && d.y === b.y - 3)!;
            expect(dark, r.key).toBeDefined();
            expect(dark.w).toBe(b.w);
            expect(dark.h).toBe(b.h + 3);
        }
    });

    it("dims a table whose run is not at work on its own box, never twice over a dark room", () => {
        const over = (tasks: string[], harborState: "working" | "idle" = "working") => {
            const base = input();
            return plan(1050, {
                agents: base.agents.map((a) =>
                    a.id === "harbor" ? { ...a, state: harborState, finished: harborState === "idle" } : a
                ),
                runs: base.runs.map((r) => ({
                    ...r,
                    done: tasks.every((t) => t === "done"),
                    tasks: tasks.map((state, i) => ({ ...r.tasks[0], id: `t${i}`, key: `${r.id}:t${i}`, state })),
                })),
            });
        };
        const zoneOf = (p: Plan) => p.rooms.find((r) => r.kind === "meeting")!;
        // a finished run at a table in a room with someone at work: the table alone is dim
        const finished = over(["done", "done"]);
        const z = zoneOf(finished);
        const parent = finished.rooms.find((r) => r.key === z.parent)!;
        expect(z.lit).toBe(false);
        expect(parent.lit).toBe(true);
        const zb = artOf(z.box);
        const tints = rects(scenery(finished, "day", false).over, "dark").filter((d) => within(d, zb));
        // the zone's own box: no wall face's rows above it
        expect(tints.map((d) => [d.x, d.y, d.w, d.h])).toEqual([[zb.x, zb.y, zb.w, zb.h]]);
        // the same table in a room nobody works in: the room's tint covers it, so the table adds none
        const dark = over(["done", "done"], "idle");
        expect(zoneOf(dark).lit).toBe(false);
        expect(dark.rooms.find((r) => r.key === zoneOf(dark).parent)!.lit).toBe(false);
        const own = rects(scenery(dark, "day", false).over, "dark").filter(
            (d) => d.x === zb.x && d.y === zb.y && d.w === zb.w && d.h === zb.h
        );
        expect(own).toHaveLength(0);
        // a run at work: no tint on its table
        const working = over(["done", "running"]);
        expect(zoneOf(working).lit).toBe(true);
        expect(rects(scenery(working, "day", false).over, "dark").filter((d) => within(d, zb))).toHaveLength(0);
    });

    it("draws a run's screen over its table, inside its zone, a square to a task", () => {
        const p = plan();
        const s = scenery(p, "day", false);
        const zone = p.rooms.find((r) => r.kind === "meeting")!;
        const table = artOf(zone.table!);
        const zb = artOf(zone.box);
        const frame = rects(s.under, "metal").find((m) => within(m, zb) && m.y + m.h <= table.y);
        expect(frame).toBeDefined();
        // centred on the table, not against the room's wall
        expect(Math.abs(frame!.x + frame!.w / 2 - (table.x + table.w / 2))).toBeLessThanOrEqual(1);
        // done, running, stalled, failed, pending
        expect(zone.screen).toEqual(["done", "work", "fail", "fail", "wait"]);
        const paint = { done: "done", work: "working", wait: "edgeMid", fail: "error" } as const;
        // one 3 x 2 square per task, in the task's colour, 4 pixels apart along the screen
        const roles = new Set<string>(Object.values(paint));
        const cells = s.under
            .filter(
                (o): o is RectOp => o.k === "rect" && roles.has(o.role) && o.w === 3 && o.h === 2 && within(o, frame!)
            )
            .sort((a, b) => a.x - b.x);
        expect(cells.map((c) => c.role)).toEqual(zone.screen!.map((c) => paint[c]));
        cells.slice(1).forEach((c, i) => expect(c.x - cells[i].x).toBe(4));
        expect(new Set(cells.map((c) => c.y)).size).toBe(1);
        // the cells sit centred on the screen's face
        const left = cells[0].x - (frame!.x + 1);
        const right = frame!.x + frame!.w - 1 - (cells[cells.length - 1].x + 3);
        expect(Math.abs(left - right)).toBeLessThanOrEqual(1);
    });

    it("plants a pot at each of a room's plants and in the lounge, and nowhere else", () => {
        for (const p of [plan(), plan(1600, { height: 1000 }), onFloor(2)]) {
            const s = scenery(p, "day", false);
            const lounge = artOf(p.lounge);
            const want = [
                [lounge.x + art(200) + 3, lounge.y + art(172) + 10],
                ...p.rooms.flatMap((r) => (r.plants ?? []).map((q) => [art(q.x) + 3, art(q.y) + 10])),
            ].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
            const got = rects(s.under, "potHi")
                .map((r) => [r.x, r.y])
                .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
            expect(got).toEqual(want);
        }
        // the plant is real: at least one room of the default floor has one
        expect(plan().rooms.some((r) => r.plants?.length)).toBe(true);
        // and a room can hold two
        expect(plan().rooms.some((r) => (r.plants?.length ?? 0) === 2)).toBe(true);
    });
});

describe("the foot of the building", () => {
    // the art row where the hall ends and the wall under it begins
    const foot = (p: Plan) => art(p.body.y + p.body.h);

    it("is brick with the entrance's glass doors and the sign on G", () => {
        const p = onFloor(0);
        expect(p.ground).toBe(true);
        const s = scenery(p, "day", false);
        expect(fills(s.under, "brick").some((f) => f.y === foot(p) + 3 && f.x === 0)).toBe(true);
        const e = artOf(p.entrance);
        // the doors: a metal frame over the entrance's box with two glass leaves in it
        expect(rects(s.under, "metal").some((m) => m.x === e.x + 1 && m.w === e.w - 2)).toBe(true);
        expect(rects(s.under, "glass").filter((g) => g.x > e.x && g.x < e.x + e.w && g.y > foot(p))).toHaveLength(2);
        // the sign over them, in the brand's colours
        expect(rects(s.over, "accent").length).toBeGreaterThan(0);
        expect(
            s.over.filter((o) => o.k === "grid" && o.roles["#"] === "accent50" && o.y >= foot(p) - 5).length
        ).toBeGreaterThan(0);
    });

    it("is a plain wall with windows above G: no brick, no entrance, no sign", () => {
        for (const floor of [1, 2]) {
            const p = onFloor(floor);
            expect(p.ground).toBe(false);
            const s = scenery(p, "day", false);
            expect(fills(s.under, "brick"), `floor ${floor}`).toHaveLength(0);
            expect(
                fills(s.under, "face").some((f) => f.x === 0 && f.y === foot(p) + 3 && f.w >= art(p.width) - 1),
                `floor ${floor}`
            ).toBe(true);
            // nothing of the doors: no metal frame in the strip, no sign anywhere
            expect(rects(s.under, "metal").filter((m) => m.y >= foot(p))).toHaveLength(0);
            expect(rects(s.over, "accent")).toHaveLength(0);
            expect(s.over.some((o) => o.k === "grid" && o.roles["#"] === "accent50")).toBe(false);
            // windows in the strip all the same
            expect(rects(s.under, "glass").filter((g) => g.y > foot(p)).length).toBeGreaterThan(5);
        }
    });

    it("sets the plain wall's windows every 128 px, from the wall's left to its right", () => {
        const p = onFloor(1);
        const s = scenery(p, "day", false);
        const xs = rects(s.under, "glass")
            .filter((g) => g.y === foot(p) + 5 && g.w === 10)
            .map((g) => g.x)
            .sort((a, b) => a - b);
        expect(xs.length).toBeGreaterThan(5);
        xs.slice(1).forEach((x, i) => expect(Math.abs((x - xs[i]) * 3 - 128)).toBeLessThanOrEqual(3));
        expect(xs[0] * 3).toBeLessThan(128);
        expect(xs[xs.length - 1] * 3 + 36).toBeGreaterThan(p.width - 128);
    });

    it("takes the extra height a tall view gives it, on G and above", () => {
        for (const floor of [0, 1]) {
            const p = onFloor(floor, { height: 1000 });
            const s = scenery(p, "day", false);
            expect(s.height * 3).toBeGreaterThanOrEqual(p.height);
            const wall = floor === 0 ? fills(s.under, "brick") : fills(s.under, "face").filter((f) => f.y > foot(p));
            expect(wall).toHaveLength(1);
            expect(wall[0].y + wall[0].h).toBe(s.height);
        }
    });
});

describe("the lift", () => {
    const doors = (p: Plan) => artOf(p.lift.doors);
    const dial = (p: Plan) => artOf(p.lift.dial);
    // the needle's pixels, in the dial's lamp colour, as offsets from the dial's centre column
    const needle = (p: Plan) => {
        const d = dial(p);
        const cx = d.x + Math.floor(d.w / 2);
        return rects(scenery(p, "day", false).under, "lamp")
            .filter((r) => within(r, d))
            .map((r) => ({ dx: r.x - cx, y: r.y }));
    };

    it("stands two steel doors at the hall's foot, a split between them, on every floor", () => {
        for (const floor of [0, 1, 2]) {
            const p = onFloor(floor);
            const s = scenery(p, "day", false);
            const d = doors(p);
            // the frame: an ink outline round a steel face
            expect(
                s.under.some(
                    (o) =>
                        o.k === "rect" && o.role === "ink" && o.x === d.x && o.y === d.y && o.w === d.w && o.h === d.h
                ),
                `floor ${floor}`
            ).toBe(true);
            expect(
                rects(s.under, "metal").some(
                    (m) => m.x === d.x + 1 && m.y === d.y + 1 && m.w === d.w - 2 && m.h === d.h - 2
                )
            ).toBe(true);
            // each leaf catches the light along its top
            expect(rects(s.under, "metalHi").filter((m) => within(m, d)).length).toBeGreaterThanOrEqual(2);
            // the split: one ink pixel wide, down the middle between the leaves
            const split = rects(s.under, "ink").find(
                (r) => r.w === 1 && r.x === d.x + Math.floor(d.w / 2) && r.y > d.y && r.y + r.h < d.y + d.h
            );
            expect(split, `floor ${floor}`).toBeDefined();
            expect(split!.h).toBeGreaterThanOrEqual(d.h - 4);
            // the doors reach the hall's foot, where the wall under it begins
            expect(d.y + d.h).toBe(art(p.body.y + p.body.h));
        }
    });

    it("puts a call button beside the doors: a steel plate with a lit lamp and a pale one", () => {
        const p = onFloor(1);
        const s = scenery(p, "day", false);
        const d = doors(p);
        const plate = rects(s.under, "laptop").find((r) => r.x > d.x + d.w && r.y >= d.y && r.y + r.h <= d.y + d.h);
        expect(plate).toBeDefined();
        const inPlate = (r: RectOp) => r.x >= plate!.x && r.x + r.w <= plate!.x + plate!.w && r.y >= plate!.y;
        expect(rects(s.under, "lamp").filter(inPlate)).toHaveLength(1);
        expect(rects(s.under, "face").filter(inPlate)).toHaveLength(1);
        // beside the doors: a few pixels off their edge
        expect(plate!.x - (d.x + d.w)).toBeLessThanOrEqual(4);
    });

    it("draws a dial over the doors: a half disc with a screen face, inside the dial's box", () => {
        const p = onFloor(1);
        const s = scenery(p, "day", false);
        const d = dial(p);
        const faces = s.under.filter(
            (o): o is Extract<Op, { k: "grid" }> =>
                o.k === "grid" && o.roles.S === "screen" && o.x === d.x && o.y === d.y
        );
        expect(faces).toHaveLength(1);
        const rows = faces[0].rows;
        expect(rows).toHaveLength(d.h);
        for (const row of rows) {
            expect(row.length).toBeLessThanOrEqual(d.w);
        }
        // a half disc: its rows widen toward the doors, and the top row is ink alone
        const widths = rows.map((row) => row.replace(/\./g, "").length);
        expect(widths[0]).toBeLessThan(widths[widths.length - 1]);
        widths.slice(1).forEach((w, i) => expect(w).toBeGreaterThanOrEqual(widths[i]));
        expect(rows[0]).not.toContain("S");
        expect(rows[rows.length - 1]).toContain("S");
        // the dial sits on the doors
        expect(d.y + d.h).toBeLessThanOrEqual(doors(p).y + 1);
        expect(d.y + d.h).toBeGreaterThanOrEqual(doors(p).y);
    });

    it("points the needle at the floor shown among the floors: G leftmost, the top floor rightmost", () => {
        const [g, one, two] = [0, 1, 2].map((f) => needle(onFloor(f)));
        expect(g.length).toBeGreaterThan(2);
        // one floor between: straight up from the dial's centre
        expect(one.every((n) => n.dx === 0)).toBe(true);
        expect(one.length).toBeGreaterThan(2);
        // G leans left and the top floor right, by the same amount
        expect(g.every((n) => n.dx <= 0) && g.some((n) => n.dx < 0)).toBe(true);
        expect(two.every((n) => n.dx >= 0) && two.some((n) => n.dx > 0)).toBe(true);
        const mirror = (list: typeof g) => list.map((n) => `${-n.dx},${n.y}`).sort();
        expect(mirror(g)).toEqual(two.map((n) => `${n.dx},${n.y}`).sort());
        // a needle as tall as the dial's face allows: the tip clears the pivot by at least four rows
        const rowsOf = (list: typeof g) => new Set(list.map((n) => n.y)).size;
        expect(rowsOf(one)).toBeGreaterThanOrEqual(4);
    });

    it("spreads the needle over however many floors there are", () => {
        // G alone: straight up. Two floors: G and the top at the same angle either side of straight up
        const alone = needle(plan());
        expect(alone.every((n) => n.dx === 0)).toBe(true);
        const two = { Home: { floor: 0, slot: 0 }, arcterm: { floor: 1, slot: 0 }, mozox: { floor: 1, slot: 1 } };
        const [lo, hi] = [0, 1].map((f) => needle(plan(1050, { at: two, floor: f })));
        expect(lo.some((n) => n.dx < 0) && lo.every((n) => n.dx <= 0)).toBe(true);
        expect(hi.some((n) => n.dx > 0) && hi.every((n) => n.dx >= 0)).toBe(true);
    });
});

describe("rasterise", () => {
    const colors: OfficeColors = { ink: [0, 0, 0], wood: [200, 100, 0], dark: [0, 0, 0, 0.5] };

    it("paints opaque ops and blends translucent ones", () => {
        const px = rasterise(
            [
                { k: "rect", x: 0, y: 0, w: 2, h: 1, role: "wood" },
                { k: "rect", x: 1, y: 0, w: 1, h: 1, role: "dark" },
            ],
            2,
            1,
            colors
        );
        expect(Array.from(px.slice(0, 4))).toEqual([200, 100, 0, 255]);
        expect(Array.from(px.slice(4, 8))).toEqual([100, 50, 0, 255]);
    });

    it("leaves a pixel clear for a missing colour or a clear cell, and clips at the edges", () => {
        const px = rasterise(
            [
                { k: "rect", x: -1, y: -1, w: 1, h: 1, role: "ink" },
                { k: "rect", x: 0, y: 0, w: 1, h: 1, role: "glass" },
                { k: "grid", x: 1, y: 0, rows: [".O"], roles: { O: "ink" } },
            ],
            2,
            1,
            colors
        );
        expect(Array.from(px)).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
    });

    it("draws a window of the canvas from its offset, in the canvas's coordinates", () => {
        const ops: Op[] = [
            { k: "rect", x: 0, y: 0, w: 4, h: 3, role: "wood" },
            { k: "rect", x: 2, y: 1, w: 1, h: 1, role: "ink" },
        ];
        const all = rasterise(ops, 4, 3, colors);
        const win = rasterise(ops, 2, 2, colors, 1, 1);
        for (let y = 0; y < 2; y++) {
            for (let x = 0; x < 2; x++) {
                const i = (y * 2 + x) * 4;
                const j = ((y + 1) * 4 + x + 1) * 4;
                expect(Array.from(win.slice(i, i + 4))).toEqual(Array.from(all.slice(j, j + 4)));
            }
        }
    });
});

describe("props", () => {
    // whether `part` is in `all` in its order, each op the same: a prop is drawn on the canvas under the people too
    const inOrder = (part: Op[], all: Op[]) => {
        const keys = all.map((o) => JSON.stringify(o));
        let at = 0;
        for (const o of part) {
            at = keys.indexOf(JSON.stringify(o), at);
            if (at < 0) {
                return false;
            }
            at++;
        }
        return true;
    };

    it("keeps the coffee machine, every plant and the notice board as props, each drawn under the people too", () => {
        const p = plan();
        const s = scenery(p, "day", false);
        const roomPlants = p.rooms.reduce((n, r) => n + (r.plants?.length ?? 0), 0);
        // the machine, the lounge's plant, the rooms' plants, the board
        expect(s.props).toHaveLength(3 + roomPlants);
        for (const prop of s.props) {
            expect(prop.ops.length).toBeGreaterThan(0);
            expect(prop.foot).toBe(prop.y + prop.h);
            expect(inOrder(prop.ops, s.under)).toBe(true);
            expect(s.under.slice(prop.after - prop.ops.length, prop.after)).toEqual(prop.ops);
            // a prop is its own pixels: its shadow stays on the floor, under a body in front of it
            expect(prop.ops.some((o) => o.k === "rect" && o.role === "shadow")).toBe(false);
        }
        const l = artOf(p.lounge);
        expect(s.props[0]).toMatchObject({ kind: "coffee", x: l.x + art(166), y: l.y + art(104) - 4, w: 12, h: 20 });
        expect(s.props.slice(1, -1).every((x) => x.kind === "plant")).toBe(true);
        const { frame, legs } = boardArt(p.board.box);
        expect(s.props.at(-1)).toMatchObject({ kind: "board", x: frame.x, y: frame.y, foot: legs[0].y + legs[0].h });
    });

    it("draws each prop's ops inside its box", () => {
        const s = scenery(plan(), "day", false);
        for (const prop of s.props) {
            for (const o of prop.ops) {
                if (o.k === "rect") {
                    expect(within(o, prop)).toBe(true);
                }
            }
        }
    });
});

describe("rasteriseProp", () => {
    const colors: OfficeColors = { ink: [0, 0, 0], wood: [200, 100, 0], dark: [0, 0, 0, 0.5] };
    const wood: Op = { k: "rect", x: 11, y: 20, w: 2, h: 2, role: "wood" };
    const prop: Prop = { kind: "plant", x: 10, y: 20, w: 3, h: 2, foot: 22, ops: [wood], after: 1 };

    it("is the prop as the two canvases show it, on its own pixels and clear round them", () => {
        // a dark room's tint over all of it: the wood takes it, the clear pixel at the prop's left stays clear
        const dark: Op = { k: "rect", x: 0, y: 0, w: 100, h: 100, role: "dark" };
        const px = rasteriseProp(prop, { under: [wood], over: [dark] }, colors);
        expect(px.length).toBe(3 * 2 * 4);
        expect(Array.from(px.slice(0, 4))).toEqual([0, 0, 0, 0]);
        expect(Array.from(px.slice(4, 8))).toEqual([100, 50, 0, 255]);
        expect(Array.from(px.slice(12, 16))).toEqual([0, 0, 0, 0]);
        expect(Array.from(px.slice(20, 24))).toEqual([100, 50, 0, 255]);
    });

    it("takes what the canvas under the people draws after it, on its own pixels", () => {
        const arm: Op = { k: "rect", x: 0, y: 21, w: 12, h: 1, role: "ink" };
        const px = rasteriseProp(prop, { under: [wood, arm], over: [] }, colors);
        expect(Array.from(px.slice(4, 8))).toEqual([200, 100, 0, 255]);
        expect(Array.from(px.slice(16, 20))).toEqual([0, 0, 0, 255]);
        // the arm passes under the clear pixel too, which stays clear
        expect(Array.from(px.slice(12, 16))).toEqual([0, 0, 0, 0]);
    });

    it("matches the full canvases' pixels at the prop", () => {
        const s = scenery(plan(1050, { night: true }), "after", false);
        const full: OfficeColors = { ...colors, metal: [90, 90, 90], deskFace: [120, 80, 40], night: [0, 0, 40, 0.4] };
        const under = rasterise([...s.under, ...s.over], s.width, s.height, full);
        const m = s.props[0];
        const own = rasteriseProp(m, s, full);
        let mismatches = 0;
        for (let y = 0; y < m.h; y++) {
            for (let x = 0; x < m.w; x++) {
                const i = (y * m.w + x) * 4;
                const j = ((m.y + y) * s.width + m.x + x) * 4;
                if (
                    own[i + 3] > 0 &&
                    Array.from(own.slice(i, i + 4)).join() !== Array.from(under.slice(j, j + 4)).join()
                ) {
                    mismatches++;
                }
            }
        }
        expect(mismatches).toBe(0);
    });
});

describe("sceneryKey", () => {
    const key = (p: Plan, phase: "day" | "after" = "day", tired = false, theme = "claude") =>
        sceneryKey(p, phase, tired, theme);

    it("changes with what the canvases draw", () => {
        const p = plan();
        const k = key(p);
        expect(
            key(
                plan(1050, {
                    agents: input().agents.map((a) =>
                        a.id === "loom" ? { ...a, state: "idle" as const, finished: true, idleSince: NOW } : a
                    ),
                })
            )
        ).not.toBe(k);
        expect(key(p, "after")).not.toBe(k);
        expect(key(p, "day", true)).not.toBe(k);
        expect(key(p, "day", false, "graphite")).not.toBe(k);
        const screen = plan(1050, {
            runs: input().runs.map((r) => ({
                ...r,
                tasks: r.tasks.map((t, i) => (i === 4 ? { ...t, state: "running" } : t)),
            })),
        });
        expect(key(screen)).not.toBe(k);
        expect(key(plan(1001))).not.toBe(k);
    });

    it("changes with the notice board's place", () => {
        const p = plan();
        const moved: Plan = { ...p, board: { ...p.board, box: { ...p.board.box, y: p.board.box.y + 30 } } };
        expect(key(moved)).not.toBe(key(p));
        // the boss's spot at the board is not drawn: moving it alone draws nothing again
        expect(key({ ...p, board: { ...p.board, spot: { x: p.board.spot.x + 9, y: p.board.spot.y } } })).toBe(key(p));
    });

    it("changes with the floor shown, with the floors there are, and with a room's chip text", () => {
        const p = plan();
        const k = key(p);
        expect(key({ ...p, floor: p.floor + 1 })).not.toBe(k);
        expect(key({ ...p, floors: [...p.floors, { floor: 1, label: "1", rooms: [], asks: 0, lit: false }] })).not.toBe(
            k
        );
        // what the lift panel lists (asks, lights) is not drawn on the canvas
        expect(key({ ...p, floors: p.floors.map((f) => ({ ...f, asks: f.asks + 2, lit: !f.lit })) })).toBe(k);
        // eight agents in one room: three desks and a chip for the rest
        const crowd = plan(1050, {
            agents: Array.from({ length: 8 }, (_, i) => ({
                id: `a${i}`,
                name: `agent ${i}`,
                project: "arcterm",
                state: "working" as const,
                harness: "claude",
                finished: false,
            })),
        });
        const chipped = crowd.rooms.find((r) => r.chip)!;
        expect(chipped.chip!.text).toBe("+5 agents");
        const withText = (text: string): Plan => ({
            ...crowd,
            rooms: crowd.rooms.map((r) => (r === chipped ? { ...r, chip: { ...r.chip!, text } } : r)),
        });
        expect(key(withText("+9 agents"))).not.toBe(key(crowd));
        expect(key(withText("+5 agents"))).toBe(key(crowd));
    });

    it("changes with a room's light and with a desk's light alone", () => {
        const p = plan();
        const k = key(p);
        expect(key({ ...p, rooms: p.rooms.map((r) => (r.key === "room:Home" ? { ...r, lit: !r.lit } : r)) })).not.toBe(
            k
        );
        expect(
            key({ ...p, desks: p.desks.map((d) => (d.key === "loom" ? { ...d, light: "off" as const } : d)) })
        ).not.toBe(k);
    });

    it("stays when only people, poses or labels change", () => {
        const p = plan();
        const moved: Plan = {
            ...p,
            desks: p.desks.map((d) => ({
                ...d,
                pose: "cheer" as const,
                word: "done",
                tone: "done" as const,
                bubble: undefined,
                animated: true,
                tip: "x",
            })),
            seats: p.seats.map((s) => ({ ...s, pose: "doze" as const, animated: false, bubble: "?" as const })),
            loungers: [],
            loungeOverflow: ["a", "b"],
        };
        expect(key(moved)).toBe(key(p));
    });
});

describe("outerWindows", () => {
    it("lists the outer wall's windows left to right, inside the wall", () => {
        const p = plan();
        const ws = outerWindows(p);
        expect(ws.length).toBeGreaterThan(0);
        const xs = ws.map((w) => w.x);
        expect(xs).toEqual([...xs].sort((a, b) => a - b));
        for (const w of ws) {
            expect(w.x).toBeGreaterThan(0);
            expect(w.x).toBeLessThan(p.width);
        }
    });

    it("sits on the wall's 130 px steps, the TV's step left out", () => {
        const p = plan(1400);
        const xs = outerWindows(p).map((w) => w.x);
        const steps: number[] = [];
        for (let s = 60; s < p.width - 80; s += 130) {
            steps.push((art(s) + 6) * CELL);
        }
        // every window is on a step; the TV's steps are left out (one or two: the TV is 38 cells, a step ~43)
        for (const x of xs) {
            expect(steps).toContain(x);
        }
        expect(new Set(xs).size).toBeLessThan(steps.length);
    });

    it("hangs at the wall face's top, where the panes are drawn", () => {
        const p = plan();
        const s = scenery(p, "day", false);
        const ws = outerWindows(p);
        for (const w of ws) {
            // a pane is a 12-cell box (an ink frame round 10 cells of glass) whose top row is the face's top
            expect(
                rects(s.under, "glass").some((g) => g.x === art(w.x) - 5 && g.y === art(w.y) + 1 && g.w === 10)
            ).toBe(true);
        }
    });
});
