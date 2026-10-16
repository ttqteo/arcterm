// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { buildPlan, type Plan, type PlanInput } from "@/app/view/agents/officeplanmodel";
import { describe, expect, it } from "vitest";
import { NEAR_CHAIR } from "./officegrids";
import type { OfficeColors } from "./officepalette";
import { art, boardArt, materialAt, rasterise, scenery, sceneryKey, type Op } from "./scenery";

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
const rects = (ops: Op[], role: string) =>
    ops.filter((o) => o.k === "rect" && o.role === role) as Extract<Op, { k: "rect" }>[];
const lastIndex = (ops: Op[], pred: (o: Op) => boolean) => ops.map(pred).lastIndexOf(true);
const firstIndex = (ops: Op[], pred: (o: Op) => boolean) => ops.findIndex(pred);

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
        for (const seat of p.seats.filter((x) => x.room === room.key)) {
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
        const home = p.rooms.find((r) => r.key === "room:home")!;
        expect(home.lit).toBe(false);
        const dark = rects(scenery(p, "day", false).over, "dark").find((r) => r.x === art(home.box.x))!;
        expect(dark.y).toBe(art(home.box.y) - 3);
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

    it("changes with a room's light and with a desk's light alone", () => {
        const p = plan();
        const k = key(p);
        expect(key({ ...p, rooms: p.rooms.map((r) => (r.key === "room:home" ? { ...r, lit: !r.lit } : r)) })).not.toBe(
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
