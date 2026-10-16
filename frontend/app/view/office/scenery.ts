// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The cockpit office's building on two canvases (cockpit office spec, "Drawing"): the plan → what the canvas under
// the people and the one over them draw, in art pixels (one is PLAN_CELL CSS px), each op naming a colour role, never
// a colour. rasterise turns a list into RGBA bytes; sceneryKey says when to draw again. Ported from the canvas's
// prototype (.superpowers/design/cockpit-office-pixel/prototype/scene.mjs), op for op. It draws the one floor the
// plan holds (office floors spec, "A floor"): four rooms round the hall with the lift at its foot, G's facade or a
// plain wall under it. Pure: no React, no DOM.

import { HWALL, MEET_H, WALL, type Box, type Plan, type Point } from "@/app/view/agents/officeplanmodel";
import { NEAR_CHAIR } from "./officegrids";
import type { OfficeColors, OfficePhase, OfficeRole } from "./officepalette";
import type { Rgb } from "./spritecache";

export const CELL = 3;
export const art = (v: number) => Math.round(v / CELL);
// the rows of a wall's face that fall inside the room under its box
const FACE = 3;
// a horizontal wall's rows above its face: ink, cap, ink
const FACE_TOP = 3;
// an outer-wall window pane's width in art px
const WINDOW_W = 12;

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
const DIAL_ROLES: Record<string, OfficeRole> = { O: "ink", S: "screen" };
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

// the lounge's TV on the outer wall's face, in art px: no window goes over its x span
const tvSpan = (plan: Plan) => ({ x: artBox(plan.lounge).x + art(60), w: art(114) });

/** The outer wall's windows in plan px: each one's centre at the wall face's top (Spider-Man's entrance swings in
 *  through the nearest). The scenery draws a pane at each. */
export function outerWindows(plan: Plan): Point[] {
    const wall = plan.walls.find((w) => w.y === 0 && w.h === HWALL && w.w > WALL);
    if (!wall) {
        return [];
    }
    const tv = tvSpan(plan);
    const y = (artBox(wall).y + FACE_TOP) * CELL;
    const out: Point[] = [];
    for (let x = 60; x < plan.width - 80; x += 130) {
        const wx = art(x);
        if (wx + WINDOW_W > tv.x && wx < tv.x + tv.w) {
            continue;
        }
        out.push({ x: (wx + WINDOW_W / 2) * CELL, y });
    }
    return out;
}

const BOARD_ART_W = 26;
const BOARD_ART_H = 17;
const BOARD_ART_TOP = 10; // the bubble over the board takes the rows above its frame

/** The notice board's parts in art px, from its box in the hall: the wood frame, the cork inside it and the two legs
 *  (their tops under the frame). The scenery draws them and cockpitoffice.tsx pins its slips over the cork. */
export function boardArt(box: Box) {
    const b = artBox(box);
    const frame = {
        x: b.x + Math.floor((b.w - BOARD_ART_W) / 2),
        y: b.y + BOARD_ART_TOP,
        w: BOARD_ART_W,
        h: BOARD_ART_H,
    };
    const cork = { x: frame.x + 2, y: frame.y + 2, w: frame.w - 4, h: frame.h - 4 };
    const leg = (x: number) => ({ x, y: frame.y + frame.h - 1, w: 3, h: 5 });
    return { frame, cork, legs: [leg(frame.x + 3), leg(frame.x + frame.w - 6)] };
}

/** The lift's dial as the rows of a grid, w x h art px: a half disc standing on the doors, ink round a screen face
 *  (`O` ink, `S` screen, `.` clear), its rows widening toward the doors and its top row ink alone. */
function dialRows(w: number, h: number): string[] {
    const c = Math.floor(w / 2);
    const reach = (r: number) => Math.min(c, Math.round((w / 2) * Math.sqrt(1 - ((h - r - 0.5) / h) ** 2)));
    return Array.from({ length: h }, (_, r) => {
        // a face pixel needs ink-free neighbours on its row and the row above it
        const face = r === 0 ? -1 : Math.min(reach(r) - 1, reach(r - 1));
        let row = "";
        for (let x = 0; x < w; x++) {
            const d = Math.abs(x - c);
            row += d > reach(r) ? "." : d <= face ? "S" : "O";
        }
        return row;
    });
}

/** The dial's needle: the pixels from its pivot, the middle of the face's last row, `len` long, at `deg` degrees from
 *  straight up (left negative). The floors fan out over 120 degrees, G leftmost. */
function needlePixels(len: number, deg: number): { dx: number; up: number }[] {
    const a = (deg * Math.PI) / 180;
    return Array.from({ length: len + 1 }, (_, t) => ({
        dx: Math.round(t * Math.sin(a)),
        up: Math.round(t * Math.cos(a)),
    }));
}

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
    // a project room is wood with a carpet strip at its foot, where its runs' tables stand (a project with no run
    // keeps the bare strip); a table's zone and an empty room are carpet. plan.rooms lists a room before its zones
    for (const r of plan.rooms) {
        const b = artBox(r.box);
        if (r.kind === "agents") {
            under.fill(b.x, b.y, b.w, b.h, "wood");
            const strip = artBox({ x: r.box.x, y: r.box.y + r.box.h - MEET_H, w: r.box.w, h: MEET_H });
            under.fill(strip.x, strip.y, strip.w, strip.h, "carpet");
        }
        if (r.kind === "meeting" || r.kind === "empty") {
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
    // a project room's plants: one where the plan left a desk place free, one on the strip with no table in it
    for (const r of plan.rooms) {
        for (const p of r.plants ?? []) {
            plant(art(p.x), art(p.y));
        }
    }

    // the Needs you notice board in the hall under the lounge: cork in a wood frame on two legs. Its paper slips are
    // DOM (cockpitoffice.tsx), so a row coming or going never draws this again
    {
        const { frame: f, cork: c, legs } = boardArt(plan.board.box);
        const foot = legs[0].y + legs[0].h;
        under.rect(f.x + 3, foot, f.w - 6, 1, "shadow");
        for (const leg of legs) {
            under.box(leg.x, leg.y, leg.w, leg.h, "deskFace");
        }
        under.box(f.x, f.y, f.w, f.h, "trim");
        under.rect(c.x, c.y, c.w, c.h, "desk");
        for (let j = 0; j < 3; j++) {
            for (let i = 0; i < 5; i++) {
                under.px(c.x + 1 + i * 4 + (j % 2) * 2, c.y + 2 + j * 4, "seam");
            }
        }
        under.shadow(f.x, f.y, f.w, f.h);
    }

    // the lift at the hall's foot: two steel doors with a split between them, a call button beside them, and a dial
    // over them whose needle points at the floor shown among the floors, G leftmost. The label "Floor <n>" and the asks
    // on other floors are DOM (cockpitoffice.tsx), so a new ask never draws this again
    {
        const d = artBox(plan.lift.doors);
        const split = d.x + Math.floor(d.w / 2);
        under.box(d.x, d.y, d.w, d.h, "metal");
        for (const [x0, x1] of [
            [d.x + 1, split],
            [split + 1, d.x + d.w - 1],
        ]) {
            // each leaf catches the light along its top and down its left edge
            under.rect(x0, d.y + 1, x1 - x0, 1, "metalHi");
            under.rect(x0, d.y + 2, 1, d.h - 4, "metalHi");
        }
        under.rect(split, d.y + 1, 1, d.h - 2, "ink");
        under.rect(d.x + d.w, d.y + 1, 1, d.h - 1, "shadow");
        // the call button: a steel plate with a lit lamp over a pale one
        const bx = d.x + d.w + 2;
        const by = d.y + 5;
        under.box(bx, by, 5, 9, "laptop");
        under.rect(bx + 1, by + 2, 3, 2, "lamp");
        under.rect(bx + 1, by + 5, 3, 2, "face");
        under.shadow(bx, by, 5, 9);

        const e = artBox(plan.lift.dial);
        under.grid(dialRows(e.w, e.h), e.x, e.y, DIAL_ROLES);
        const at = Math.max(
            0,
            plan.floors.findIndex((f) => f.floor === plan.floor)
        );
        const deg = (at - (plan.floors.length - 1) / 2) * (120 / Math.max(1, plan.floors.length - 1));
        for (const { dx, up } of needlePixels(e.h - 3, deg)) {
            under.px(e.x + Math.floor(e.w / 2) + dx, e.y + e.h - 1 - up, "lamp");
        }
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

    // table zones: chairs, table, the run's DAG screen over it
    for (const r of plan.rooms.filter((r) => r.kind === "meeting")) {
        const t = r.table ? artBox(r.table) : null;
        if (r.table && t) {
            for (const s of plan.seats.filter((s) => s.zone === r.key)) {
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
        if (r.screen && t) {
            // the run's DAG on a thin screen at the zone's top, centred over the table, behind the people on the far
            // side: they sit from 12 px down the zone, so the screen takes the band above their heads
            const sw0 = Math.max(26, r.screen.length * 4 + 5);
            const sx0 = t.x + Math.round((t.w - sw0) / 2);
            const sy0 = art(r.box.y);
            under.box(sx0, sy0, sw0, 6, "metal");
            under.rect(sx0 + 2, sy0 + 1, sw0 - 4, 4, "screen");
            const x0 = sx0 + 2 + Math.floor((sw0 - 4 - (r.screen.length * 4 - 1)) / 2);
            r.screen.forEach((c, i) => under.rect(x0 + i * 4, sy0 + 2, 3, 2, SCREEN_CELL[c]));
            under.shadow(sx0, sy0, sw0, 6);
        }
    }

    // walls: faces under people, caps over them
    const horiz = plan.walls.filter((w) => w.h === HWALL && w.w > WALL);
    const vert = plan.walls.filter((w) => !(w.h === HWALL && w.w > WALL));
    const tv = tvSpan(plan);
    for (const w of horiz) {
        const b = artBox(w);
        // rows: 0 ink, 1 cap, 2 ink, 3.. face (into the room below by FACE rows), then the trim and its shadow
        const fy = b.y + FACE_TOP;
        const fh = b.h - FACE_TOP + FACE;
        under.fill(b.x, fy, b.w, fh, "face");
        under.rect(b.x, fy + fh, b.w, 1, "trim");
        under.rect(b.x, fy + fh + 1, b.w, 1, "shadow");
        if (w.y === 0) {
            // the outer wall's windows, light glass by day and dark after hours
            for (const win of outerWindows(plan)) {
                const wx = art(win.x) - WINDOW_W / 2;
                const spark = night ? "glass2" : "glassHi";
                under.box(wx, fy, WINDOW_W, fh, "glass");
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

    // the foot of the building: the outer bottom wall from outside. On G it is brick with the entrance, on a floor above
    // it is the plain wall face with a window every 128 px and no door
    const fy = art(plan.body.y + plan.body.h);
    {
        under.rect(0, fy, W, 1, "ink");
        under.rect(0, fy + 1, W, 1, "cap");
        under.rect(0, fy + 2, W, 1, "ink");
        if (plan.ground) {
            under.fill(0, fy + 3, W, H - fy - 3, "brick", fy + 3);
        } else {
            under.fill(0, fy + 3, W, H - fy - 3, "face");
        }
        for (let x = 60; x < plan.width - 60; x += plan.ground ? 140 : 128) {
            if (plan.ground && !(x + 36 < plan.entrance.x - 20 || x > plan.entrance.x + plan.entrance.w + 20)) {
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
        if (plan.ground) {
            // glass doors, each half a whole number of pixels wide
            const e = artBox(plan.entrance);
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
    }

    // over: lights off, night, lamps, wall caps, the sign
    // a room with no one at work is dark, its wall face included (an empty room is never lit); a table whose run is at
    // rest dims on its own box, and not again when its room is dark already
    const roomOf = new Map(plan.rooms.map((r) => [r.key, r]));
    for (const r of plan.rooms.filter((r) => !r.lit)) {
        const b = artBox(r.box);
        if (r.kind !== "meeting") {
            over.rect(b.x, b.y - 3, b.w, b.h + 3, "dark");
        } else if (roomOf.get(r.parent ?? "")?.lit !== false) {
            over.rect(b.x, b.y, b.w, b.h, "dark");
        }
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
    // the sign over the doors, on G only: the brand's frame, its letters in a 5x5 pixel face
    if (plan.ground) {
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
 * What the canvases draw, as a string: they draw again only when it changes. The plan's geometry, the floor shown and
 * the floors there are (the dial's needle, G's facade), each room's light, plant, chip and run's screen, each desk's
 * light, tired, the phase and the theme (a run's screen and the laptops' lights are status tokens). Never a pose, a
 * walker or a label.
 */
export function sceneryKey(plan: Plan, phase: OfficePhase, tired: boolean, theme: string): string {
    return JSON.stringify([
        plan.width,
        plan.height,
        phase,
        tired,
        theme,
        plan.floor,
        plan.floors.map((f) => f.label),
        plan.body,
        plan.lounge,
        plan.board.box,
        plan.lift.doors,
        plan.lift.dial,
        plan.entrance,
        plan.walls,
        plan.rooms.map((r) => [
            r.key,
            r.box,
            r.lit,
            r.door ?? 0,
            r.table ?? 0,
            r.screen ?? 0,
            r.plants ?? 0,
            r.chip?.text ?? 0,
        ]),
        plan.desks.map((d) => [d.x, d.y, d.light]),
        plan.seats.map((s) => [s.x, s.bottom]),
    ]);
}
