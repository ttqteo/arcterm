// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { swagShape, swagsFor, type Post } from "./christmasswag";

// the bar at 1440px on a Mac: search, meters, New, the fold button; boxes 26px tall from y 6
const SEARCH: Post = { left: 467, right: 827, top: 6 };
const METERS: Post = { left: 994, right: 1294, top: 6 };
const NEW: Post = { left: 1304, right: 1388, top: 6 };
const SPROUT: Post = { left: 1398, right: 1424, top: 6 };

describe("swagsFor", () => {
    it("hangs a swag in each gap wide enough for 3+ bulbs, hooked 2px in from the boxes' top corners", () => {
        // the 14px gaps around New and the fold button, and the fold button to the bar's edge, would hold one bulb
        expect(swagsFor(312, [SEARCH, METERS, NEW, SPROUT], 1436)).toEqual([
            { x1: 312, y1: 1, x2: 469, y2: 5.5 },
            { x1: 825, y1: 5.5, x2: 996, y2: 5.5 },
        ]);
    });

    it("hangs a swag from 3 bulbs (~65px) and none at 2", () => {
        const a: Post = { left: 0, right: 100, top: 6 };
        const at = (gap: number) => swagsFor(null, [a, { left: 100 + gap - 4, right: 300, top: 6 }], null);
        expect(at(65)).toHaveLength(1);
        expect(at(60)).toEqual([]);
    });

    it("takes the boxes in any order", () => {
        expect(swagsFor(null, [SPROUT, SEARCH, NEW, METERS], null)).toEqual(
            swagsFor(null, [SEARCH, METERS, NEW, SPROUT], null)
        );
    });

    it("hangs the end swag from the bar's corner when the gap to it is wide", () => {
        expect(swagsFor(null, [SEARCH], 900)).toEqual([{ x1: 825, y1: 5.5, x2: 900, y2: 1 }]);
    });

    it("skips a narrow gap, and boxes with no width", () => {
        const tight: Post = { left: 830, right: 900, top: 6 };
        const hidden: Post = { left: 950, right: 950, top: 6 };
        expect(swagsFor(null, [SEARCH, tight, hidden], null)).toEqual([]);
    });

    it("hangs nothing when the bar has no boxes", () => {
        expect(swagsFor(312, [], 1436)).toEqual([]);
    });
});

describe("swagShape", () => {
    it("puts a socket every ~26px along a wide gap, every one below its hooks and above the bar's bottom", () => {
        const [, gap] = swagsFor(312, [SEARCH, METERS], null);
        const { path, sockets } = swagShape(gap);
        expect(path).toMatch(/^M825 5.5 Q/);
        expect(sockets).toHaveLength(Math.round((996 - 825) / 26));
        for (const s of sockets) {
            expect(s.x).toBeGreaterThan(825);
            expect(s.x).toBeLessThan(996);
            expect(s.y).toBeGreaterThan(5.5);
            // a 6x9 bulb hangs 2px under its socket: it must end above the bar's bottom border (y 37)
            expect(s.y + 11).toBeLessThan(37);
        }
    });

    it("gives the narrowest swag that hangs three bulbs", () => {
        expect(swagShape({ x1: 0, y1: 5.5, x2: 65, y2: 5.5 }).sockets).toHaveLength(3);
    });
});
