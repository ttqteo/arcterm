// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { TELEPORT_MS, TELEPORT_TAIL_MS } from "./petteleport";
import { ANCHOR, HANDS, SHOOT_MS, strandCells, SWING_FROM, webSwingFrame, type WebCell } from "./petwebswing";

const touching = (cells: WebCell[]) =>
    cells.every((c, i) => i === 0 || (Math.abs(c.x - cells[i - 1].x) <= 1 && Math.abs(c.y - cells[i - 1].y) <= 1));

describe("strandCells", () => {
    it("runs from one end to the other, each cell touching the last", () => {
        const s = strandCells({ x: 10, y: 0 }, { x: 14, y: -14 });
        expect(s[0]).toEqual({ x: 10, y: 0 });
        expect(s[s.length - 1]).toEqual({ x: 14, y: -14 });
        expect(touching(s)).toBe(true);
    });

    it("is one cell when both ends are one", () => {
        expect(strandCells({ x: 3, y: 3 }, { x: 3, y: 3 })).toEqual([{ x: 3, y: 3 }]);
    });
});

describe("webSwingFrame", () => {
    it("lasts what the teleport lasts, so the fold's timing does not change", () => {
        for (const kind of ["depart", "arrive"] as const) {
            expect(TELEPORT_MS[kind]).toBeLessThanOrEqual(TELEPORT_TAIL_MS[kind]);
            expect(webSwingFrame(kind, TELEPORT_TAIL_MS[kind]).strand).toEqual([]);
        }
    });

    it("holds the strand in SPIDEY_SWING's hand", () => {
        expect(HANDS).toEqual({ x: 10, y: 0 });
    });

    it("departs: the strand shoots from its hand to the anchor, then it is pulled up it and gone", () => {
        const start = webSwingFrame("depart", 0);
        expect(start.pet).toEqual({ dx: 0, dy: 0, opacity: 1 });
        expect(start.strand[0]).toEqual(HANDS);
        const shot = webSwingFrame("depart", SHOOT_MS);
        expect(shot.strand[shot.strand.length - 1]).toEqual(ANCHOR);
        const mid = webSwingFrame("depart", (SHOOT_MS + TELEPORT_MS.depart) / 2);
        expect(mid.pet.dy).toBeLessThan(0);
        const end = webSwingFrame("depart", TELEPORT_MS.depart);
        expect(end.pet.opacity).toBe(0);
        expect(end.strand).toEqual([]);
    });

    it("arrives: a strand drops, it swings in down it, and lands where it stands with no strand left", () => {
        const start = webSwingFrame("arrive", 0);
        expect(start.pet.opacity).toBe(0);
        expect(start.strand[0]).toEqual(ANCHOR);
        let last = { dx: SWING_FROM.dx, dy: SWING_FROM.dy };
        for (let t = SHOOT_MS; t < TELEPORT_MS.arrive; t += 10) {
            const f = webSwingFrame("arrive", t);
            expect(f.pet.opacity).toBe(1);
            expect(Math.abs(f.pet.dx)).toBeLessThanOrEqual(Math.abs(last.dx));
            expect(Math.abs(f.pet.dy)).toBeLessThanOrEqual(Math.abs(last.dy));
            expect(f.strand[0]).toEqual({ x: HANDS.x + f.pet.dx, y: HANDS.y + f.pet.dy });
            expect(f.strand[f.strand.length - 1]).toEqual(ANCHOR);
            last = f.pet;
        }
        expect(webSwingFrame("arrive", TELEPORT_MS.arrive)).toEqual({ pet: { dx: 0, dy: 0, opacity: 1 }, strand: [] });
    });

    it("moves only in whole cells, so it stays pixel art", () => {
        for (const kind of ["depart", "arrive"] as const) {
            for (let t = 0; t <= TELEPORT_MS[kind]; t += 7) {
                const f = webSwingFrame(kind, t);
                expect(Number.isInteger(f.pet.dx) && Number.isInteger(f.pet.dy)).toBe(true);
                expect(f.strand.every((c) => Number.isInteger(c.x) && Number.isInteger(c.y))).toBe(true);
            }
        }
    });
});
