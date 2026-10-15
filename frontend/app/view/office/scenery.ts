// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The cockpit office's building on two canvases (cockpit office spec, "Drawing"): the plan → what the canvas under
// the people and the one over them draw, in art pixels (one is PLAN_CELL CSS px), each op naming a colour role, never
// a colour. rasterise turns a list into RGBA bytes; sceneryKey says when to draw again. Ported from the canvas's
// prototype (.superpowers/design/cockpit-office-pixel/prototype/scene.mjs), op for op. Pure: no React, no DOM.

import { HWALL, WALL, type Box, type Plan } from "@/app/view/agents/officeplanmodel";
import { NEAR_CHAIR } from "./officegrids";
import type { OfficeColors, OfficePhase, OfficeRole } from "./officepalette";
import type { Rgb } from "./spritecache";

export const CELL = 3;
export const art = (v: number) => Math.round(v / CELL);
// the rows of a wall's face that fall inside the room under its box
const FACE = 3;

export type Material = "wood" | "tiles" | "carpet" | "face" | "brick";
export type Op =
    | { k: "rect"; x: number; y: number; w: number; h: number; role: OfficeRole; alpha?: number }
    | { k: "fill"; x: number; y: number; w: number; h: number; material: Material; oy?: number }
    | { k: "grid"; x: number; y: number; rows: string[]; roles: Record<string, OfficeRole> }
    | { k: "pool"; cx: number; cy: number; rx: number; ry: number };
export interface Scenery {
    width: number;
    height: number;
    under: Op[];
    over: Op[];
}
export const CHAIR_ROLES: Record<string, OfficeRole> = { O: "ink", R: "chair", r: "chairShade" };

const LEAF = ["..OOOOO..", ".OGGgGGO.", "OGgGGGGdO", "OGGGgGGdO", "OdGGGGddO", "OGdGGdGdO", ".OddGddO.", "..OOOOO.."];
const LEAF_ROLES: Record<string, OfficeRole> = { O: "ink", G: "leaf", g: "leafHi", d: "leafDark" };
// the sign's letters, a 5 x 5 pixel face
const FONT: Record<string, string[]> = {
    A: [".###.", "#...#", "#####", "#...#", "#...#"],
    R: ["####.", "#...#", "####.", "#..#.", "#...#"],
    C: [".####", "#....", "#....", "#....", ".####"],
    T: ["#####", "..#..", "..#..", "..#..", "..#.."],
    E: ["#####", "#....", "####.", "#....", "#####"],
    M: ["#...#", "##.##", "#.#.#", "#...#", "#...#"],
};
const SCREEN_CELL = { done: "done", work: "working", wait: "edgeMid", fail: "error" } as const;

/** A stable hash of small integers: where knots and the darker bricks fall, the same on every draw. */
export function hash(...n: number[]): number {
    let h = 2166136261;
    for (const v of n) {
        h ^= v + 0x9e3779b9;
        h = Math.imul(h, 16777619);
        h ^= h >>> 13;
    }
    return h >>> 0;
}

/** The role a floor's or a wall's material shows at an art pixel; coordinates are the canvas's, so floors line up. */
export function materialAt(m: Material, x: number, y: number, oy = 0): OfficeRole {
    switch (m) {
        case "tiles":
            return x % 16 === 15 || y % 16 === 15 ? "grout" : ((x >> 4) + (y >> 4)) % 2 ? "tile2" : "tile";
        case "carpet":
            return (x % 4 === 0 && y % 4 === 0) || (x % 4 === 2 && y % 4 === 2) ? "carpet2" : "carpet";
        case "face":
            return x % 8 === 0 ? "face2" : "face";
        case "brick": {
            const r = y - oy;
            if (r % 3 === 2) {
                return "mortar";
            }
            const off = Math.floor(r / 3) % 2 ? 3 : 0;
            if ((x + off) % 6 === 5) {
                return "mortar";
            }
            return hash(Math.floor((x + off) / 6), Math.floor(r / 3)) % 4 === 0 ? "brick2" : "brick";
        }
        case "wood": {
            // planks 5 rows tall and 26 long, a seam under each row and at each joint, a knot on one plank in five
            const row = Math.floor(y / 6);
            if (y % 6 === 5) {
                return "seam";
            }
            const off = (row * 11) % 26;
            const lx = (x + off) % 26;
            if (lx === 0) {
                return "seam";
            }
            const h = hash(row, Math.floor((x + off) / 26));
            if (h % 5 === 0) {
                const kx = ((h >>> 3) % 18) + 4;
                if ((lx === kx || lx === kx + 1) && y % 6 === 2) {
                    return "knot";
                }
            }
            return h % 3 === 0 ? "wood2" : "wood";
        }
    }
}

class Ops {
    list: Op[] = [];
    rect(x: number, y: number, w: number, h: number, role: OfficeRole, alpha?: number) {
        if (w > 0 && h > 0) {
            this.list.push(alpha == null ? { k: "rect", x, y, w, h, role } : { k: "rect", x, y, w, h, role, alpha });
        }
    }
    // a filled box with a 1 px outline
    box(x: number, y: number, w: number, h: number, fill: OfficeRole, ink: OfficeRole = "ink") {
        this.rect(x, y, w, h, ink);
        if (w > 2 && h > 2) {
            this.rect(x + 1, y + 1, w - 2, h - 2, fill);
        }
    }
    fill(x: number, y: number, w: number, h: number, material: Material, oy?: number) {
        if (w > 0 && h > 0) {
            this.list.push(oy == null ? { k: "fill", x, y, w, h, material } : { k: "fill", x, y, w, h, material, oy });
        }
    }
    grid(rows: string[], x: number, y: number, roles: Record<string, OfficeRole>) {
        this.list.push({ k: "grid", x, y, rows, roles });
    }
    px(x: number, y: number, role: OfficeRole) {
        this.rect(x, y, 1, 1, role);
    }
    // a drop shadow to the right of and below a box
    shadow(x: number, y: number, w: number, h: number) {
        this.rect(x + w, y + 1, 1, h, "shadow");
        this.rect(x + 1, y + h, w - 1, 1, "shadow");
    }
}

const artBox = (b: Box) => {
    const x = art(b.x);
    const y = art(b.y);
    return { x, y, w: art(b.x + b.w) - x, h: art(b.y + b.h) - y };
};

/** What the canvas under the people and the one over them draw, in order; sizes in art px. */
export function scenery(plan: Plan, phase: OfficePhase, tired: boolean): Scenery {
    const night = phase === "after";
    const W = Math.ceil(plan.width / CELL);
    const H = Math.ceil(plan.height / CELL);
    const under = new Ops();
    const over = new Ops();
    const top = new Ops(); // wall caps and the sign: the over canvas's last ops, which no tint covers

    // floors
    const body = artBox(plan.body);
    under.fill(body.x, body.y, body.w, body.h, "tiles");
    for (const r of plan.rooms) {
        const b = artBox(r.box);
        if (r.kind === "agents" || r.kind === "home") {
            under.fill(b.x, b.y, b.w, b.h, "wood");
        }
        if (r.kind === "meeting") {
            under.fill(b.x, b.y, b.w, b.h, "carpet");
        }
    }

    // the lounge: rug, TV, coffee machine, sofa, plant
    const l = artBox(plan.lounge);
    const L = (dx: number, dy: number): [number, number] => [l.x + art(dx), l.y + art(dy)];
    {
        const [rx, ry] = L(14, 54);
        const rw = art(150);
        const rh = art(140);
        under.box(rx, ry, rw, rh, "rug", "rug2");
        under.rect(rx + 2, ry + 2, rw - 4, 1, "rug2");
        under.rect(rx + 2, ry + rh - 3, rw - 4, 1, "rug2");
    }
    {
        const [cx, cy] = L(166, 104);
        under.box(cx, cy + 6, 12, 10, "deskFace");
        under.box(cx, cy + 4, 12, 5, "desk");
        under.box(cx + 2, cy - 4, 8, 10, "metal");
        under.rect(cx + 3, cy - 3, 6, 1, "metalHi");
        under.rect(cx + 4, cy + 1, 4, 2, "screen");
        under.px(cx + 8, cy - 2, "error");
        under.box(cx + 5, cy + 3, 3, 3, "cup");
        under.shadow(cx, cy - 4, 12, 20);
    }
    // the sofa faces the TV: its seat and arms under the people on it, its back over them
    const sx = l.x + art(34);
    const sw = art(162);
    {
        const sy = l.y + art(148);
        under.box(sx, sy, sw, 8, "sofaHi");
        under.box(sx, sy - 2, 4, 12, "sofa");
        under.box(sx + sw - 4, sy - 2, 4, 12, "sofa");
        const by = l.y + art(160);
        over.box(sx + 2, by, sw - 4, 6, "sofa");
        over.rect(sx + 3, by + 1, sw - 6, 1, "sofaHi");
        over.box(sx, by + 4, sw, 5, "sofaFace");
        under.rect(sx + sw, by - 1, 1, 10, "shadow");
        under.rect(sx + 1, by + 9, sw, 1, "shadow");
    }
    const plant = (x: number, y: number) => {
        under.box(x + 2, y + 9, 7, 5, "pot");
        under.rect(x + 3, y + 10, 5, 1, "potHi");
        under.grid(LEAF, x + 1, y + 1, LEAF_ROLES);
        under.rect(x + 9, y + 3, 1, 11, "shadow");
        under.rect(x + 3, y + 14, 7, 1, "shadow");
    };
    plant(...L(200, 172));
    for (const r of plan.rooms.filter((r) => r.kind === "agents")) {
        plant(art(r.box.x + r.box.w - 44), art(r.box.y + r.box.h - 64));
    }

    // desks: the chair under the person, the desk over them
    const chairBack = (layer: Ops, x: number, y: number) => {
        layer.box(x, y, 12, 6, "chair");
        layer.rect(x + 1, y + 1, 10, 1, "chairHi");
    };
    for (const d of plan.desks) {
        const x = art(d.x);
        const y = art(d.y);
        chairBack(under, x + 7, y - 9);
        // shadow on the floor, right and below
        under.rect(x + 27, y + 1, 1, 10, "shadow");
        under.rect(x + 1, y + 10, 27, 1, "shadow");
        // the desk: its top and its face
        over.rect(x, y, 27, 10, "ink");
        over.rect(x + 1, y + 1, 25, 6, "desk");
        over.rect(x + 1, y + 1, 25, 1, "deskHi");
        over.rect(x + 1, y + 7, 25, 2, "deskFace");
        // a laptop, its lid toward you: the logo on the lid glows with the agent's light
        over.box(x + 7, y - 3, 13, 6, "laptop");
        over.rect(x + 8, y - 2, 11, 1, "laptopHi");
        over.rect(x + 12, y, 3, 1, d.light === "working" ? "working" : d.light === "asking" ? "asking" : "laptopOff");
        if (tired && d.light === "working") {
            over.box(x + 2, y + 1, 4, 4, "cup");
        }
    }

    // meeting rooms: chairs, table, the DAG screen against the wall
    for (const r of plan.rooms.filter((r) => r.kind === "meeting")) {
        const t = r.table ? artBox(r.table) : null;
        if (r.table && t) {
            for (const s of plan.seats.filter((s) => s.room === r.key)) {
                const px = art(s.x - 3);
                const pb = art(s.bottom);
                if (s.bottom > r.table.y + 20) {
                    // the near side: its chair over the table, a pose never moves it
                    over.grid(NEAR_CHAIR, px, pb - 6, CHAIR_ROLES);
                } else {
                    chairBack(under, px + 1, pb - 10);
                }
            }
            under.rect(t.x + t.w, t.y + 1, 1, t.h, "shadow");
            under.rect(t.x + 1, t.y + t.h, t.w, 1, "shadow");
            over.rect(t.x, t.y, t.w, t.h, "ink");
            over.rect(t.x + 1, t.y + 1, t.w - 2, t.h - 5, "desk");
            over.rect(t.x + 1, t.y + 1, t.w - 2, 1, "deskHi");
            over.rect(t.x + 1, t.y + t.h - 4, t.w - 2, 3, "deskFace");
        }
        if (r.screen) {
            const sx0 = art(r.box.x + r.box.w - 170);
            const sy0 = art(r.box.y + 8);
            const sw0 = Math.max(26, r.screen.length * 4 + 5);
            under.box(sx0, sy0, sw0, 10, "metal");
            under.rect(sx0 + 2, sy0 + 2, sw0 - 4, 6, "screen");
            r.screen.forEach((c, i) => under.rect(sx0 + 3 + i * 4, sy0 + 3, 3, 2, SCREEN_CELL[c]));
            const done = r.screen.filter((c) => c === "done").length;
            under.rect(sx0 + 3, sy0 + 6, sw0 - 6, 1, "edgeMid");
            under.rect(sx0 + 3, sy0 + 6, Math.round(((sw0 - 6) * done) / r.screen.length), 1, "working");
            under.rect(sx0 + 3, sy0 + 10, 1, 2, "ink");
            under.rect(sx0 + sw0 - 4, sy0 + 10, 1, 2, "ink");
            under.shadow(sx0, sy0, sw0, 10);
        }
    }

    // walls: faces under people, caps over them
    const horiz = plan.walls.filter((w) => w.h === HWALL && w.w > WALL);
    const vert = plan.walls.filter((w) => !(w.h === HWALL && w.w > WALL));
    const tv = { x: l.x + art(60), w: art(114) };
    for (const w of horiz) {
        const b = artBox(w);
        // rows: 0 ink, 1 cap, 2 ink, 3.. face (into the room below by FACE rows), then the trim and its shadow
        const fy = b.y + 3;
        const fh = b.h - 3 + FACE;
        under.fill(b.x, fy, b.w, fh, "face");
        under.rect(b.x, fy + fh, b.w, 1, "trim");
        under.rect(b.x, fy + fh + 1, b.w, 1, "shadow");
        if (w.y === 0) {
            // the outer wall's windows, light glass by day and dark after hours
            for (let x = 60; x < plan.width - 80; x += 130) {
                const wx = art(x);
                if (wx + 12 > tv.x && wx < tv.x + tv.w) {
                    continue;
                }
                const spark = night ? "glass2" : "glassHi";
                under.box(wx, fy, 12, fh, "glass");
                under.rect(wx + 6, fy + 1, 1, fh - 2, "ink");
                under.px(wx + 2, fy + 1, spark);
                under.px(wx + 3, fy + 2, spark);
                under.px(wx + 8, fy + 1, spark);
                under.rect(wx + 1, fy + fh - 2, 5, 1, "glass2");
                under.rect(wx + 7, fy + fh - 2, 4, 1, "glass2");
            }
        }
    }
    // the lounge's TV on the outer wall's face
    {
        const ty = art(HWALL) - 3;
        under.box(tv.x, ty, tv.w, 7, "screen");
        under.rect(tv.x + 1, ty + 1, tv.w - 2, 1, "metal");
        for (let i = 0; i < 3; i++) {
            under.px(tv.x + 4 + i, ty + 4 - i, "metalHi");
        }
        under.rect(tv.x + 6, ty + 7, tv.w - 12, 1, "shadow");
    }

    // the facade: the outer bottom wall from outside
    const fy = art(plan.body.y + plan.body.h);
    {
        under.rect(0, fy, W, 1, "ink");
        under.rect(0, fy + 1, W, 1, "cap");
        under.rect(0, fy + 2, W, 1, "ink");
        under.fill(0, fy + 3, W, H - fy - 3, "brick", fy + 3);
        const e = artBox(plan.entrance);
        for (let x = 60; x < plan.width - 60; x += 140) {
            if (!(x + 36 < plan.entrance.x - 20 || x > plan.entrance.x + plan.entrance.w + 20)) {
                continue;
            }
            const wx = art(x);
            under.box(wx, fy + 4, 12, 7, "glass");
            under.rect(wx + 6, fy + 5, 1, 5, "ink");
            if (!night) {
                under.px(wx + 2, fy + 5, "glassHi");
                under.px(wx + 3, fy + 6, "glassHi");
            }
            under.rect(wx, fy + 11, 12, 1, "cap");
        }
        // glass doors, each half a whole number of pixels wide
        const half = Math.floor(e.w / 2);
        under.box(e.x, fy + 1, e.w, H - fy - 1, "metal");
        under.box(e.x + 2, fy + 3, half - 2, H - fy - 3, "glass");
        under.box(e.x + half, fy + 3, half - 2, H - fy - 3, "glass");
        under.px(e.x + half - 2, fy + 7, "ink");
        under.px(e.x + half + 1, fy + 7, "ink");
        if (!night) {
            under.px(e.x + 4, fy + 4, "glassHi");
            under.px(e.x + 5, fy + 5, "glassHi");
        }
    }

    // over: lights off, night, lamps, wall caps, the sign
    for (const r of plan.rooms.filter((r) => !r.lit)) {
        const b = artBox(r.box);
        over.rect(b.x, b.y - 3, b.w, b.h + 3, "dark");
    }
    if (night) {
        over.rect(body.x, body.y - 3, body.w, body.h + 3, "night");
        for (const d of plan.desks.filter((d) => d.light !== "off")) {
            const x = art(d.x);
            const y = art(d.y);
            over.list.push({ k: "pool", cx: x + 13, cy: y + 1, rx: 22, ry: 12 });
            over.box(x + 1, y - 3, 4, 3, "lamp");
            over.rect(x + 2, y, 2, 1, "ink");
        }
        for (const r of plan.rooms.filter((r) => r.kind === "meeting" && r.lit && r.table)) {
            const t = artBox(r.table!);
            over.list.push({
                k: "pool",
                cx: t.x + Math.round(t.w / 2),
                cy: t.y + 4,
                rx: Math.round(t.w / 2) + 10,
                ry: 14,
            });
        }
    }
    for (const w of horiz) {
        const b = artBox(w);
        top.rect(b.x, b.y, b.w, 1, "ink");
        top.rect(b.x, b.y + 1, b.w, 1, "cap");
        top.rect(b.x, b.y + 2, b.w, 1, "ink");
    }
    for (const w of vert) {
        const x = art(w.x);
        let y0 = art(w.y);
        const y1 = art(w.y + w.h);
        // a wall that starts under a horizontal wall's box climbs to its cap, over its face
        if (
            horiz.some((h) => Math.abs(art(h.y + h.h) - y0) <= 0 && x >= art(h.x) - 3 && x <= art(h.x + h.w) + 3) ||
            w.y === HWALL
        ) {
            y0 -= 4;
        }
        top.rect(x, y0, 3, y1 - y0, "ink");
        top.rect(x + 1, y0 + 1, 1, y1 - y0 - 2, "cap");
        under.rect(x + 3, y0 + 4, 1, y1 - y0 - 4, "shadow");
    }
    // the sign over the doors: the brand's frame, its letters in a 5x5 pixel face
    {
        const e = artBox(plan.entrance);
        const sw0 = 51;
        const sx0 = e.x + Math.round(e.w / 2) - Math.round(sw0 / 2);
        const sy0 = fy - 5;
        if (night) {
            top.rect(sx0 - 1, sy0 - 1, sw0 + 2, 11, "accent", 0.35);
        }
        top.box(sx0, sy0, sw0, 9, "accent");
        top.rect(sx0 + 2, sy0 + 2, sw0 - 4, 5, "code");
        let x = sx0 + 5;
        for (const ch of "ARCTERM") {
            top.grid(FONT[ch], x, sy0 + 2, { "#": "accent50" });
            x += 6;
        }
    }

    return { width: W, height: H, under: under.list, over: [...over.list, ...top.list] };
}

/** RGBA bytes for a list of ops on a w × h canvas; a role with no colour leaves its pixels as they were. */
export function rasterise(ops: Op[], w: number, h: number, colors: OfficeColors): Uint8ClampedArray {
    const d = new Uint8ClampedArray(w * h * 4);
    const put = (x: number, y: number, c: Rgb | undefined, alpha = 1) => {
        if (c == null || x < 0 || y < 0 || x >= w || y >= h) {
            return;
        }
        const i = (y * w + x) * 4;
        const a = (c[3] ?? 1) * alpha;
        if (a >= 1) {
            d[i] = c[0];
            d[i + 1] = c[1];
            d[i + 2] = c[2];
            d[i + 3] = 255;
            return;
        }
        const da = d[i + 3] / 255;
        const oa = a + da * (1 - a);
        if (oa <= 0) {
            return;
        }
        for (let k = 0; k < 3; k++) {
            d[i + k] = (c[k] * a + d[i + k] * da * (1 - a)) / oa;
        }
        d[i + 3] = oa * 255;
    };
    for (const op of ops) {
        switch (op.k) {
            case "rect": {
                const c = colors[op.role];
                for (let y = Math.max(0, op.y); y < Math.min(h, op.y + op.h); y++) {
                    for (let x = Math.max(0, op.x); x < Math.min(w, op.x + op.w); x++) {
                        put(x, y, c, op.alpha);
                    }
                }
                break;
            }
            case "fill":
                for (let y = Math.max(0, op.y); y < Math.min(h, op.y + op.h); y++) {
                    for (let x = Math.max(0, op.x); x < Math.min(w, op.x + op.w); x++) {
                        put(x, y, colors[materialAt(op.material, x, y, op.oy)]);
                    }
                }
                break;
            case "grid":
                op.rows.forEach((row, j) => {
                    for (let i = 0; i < row.length; i++) {
                        const role = op.roles[row[i]];
                        if (role) {
                            put(op.x + i, op.y + j, colors[role]);
                        }
                    }
                });
                break;
            case "pool": {
                // a lamp's light on the floor, dithered at its rim
                const c = colors.lamp;
                for (let y = -op.ry; y <= op.ry; y++) {
                    for (let x = -op.rx; x <= op.rx; x++) {
                        const q = (x * x) / (op.rx * op.rx) + (y * y) / (op.ry * op.ry);
                        if (q > 1 || (q > 0.62 && (x + y) % 2)) {
                            continue;
                        }
                        put(op.cx + x, op.cy + y, c && [c[0], c[1], c[2]], q > 0.62 ? 0.1 : 0.2);
                    }
                }
                break;
            }
        }
    }
    return d;
}

/**
 * What the canvases draw, as a string: they draw again only when it changes. The plan's geometry, each room's light,
 * each desk's light, each run's screen, tired, the phase and the theme (a run's screen and the laptops' lights are
 * status tokens). Never a pose, a walker or a label.
 */
export function sceneryKey(plan: Plan, phase: OfficePhase, tired: boolean, theme: string): string {
    return JSON.stringify([
        plan.width,
        plan.height,
        phase,
        tired,
        theme,
        plan.body,
        plan.lounge,
        plan.entrance,
        plan.walls,
        plan.rooms.map((r) => [r.key, r.box, r.lit, r.door ?? 0, r.table ?? 0, r.screen ?? 0]),
        plan.desks.map((d) => [d.x, d.y, d.light]),
        plan.seats.map((s) => [s.x, s.bottom]),
    ]);
}
