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
    it("hangs one swag per gap, hooked 2px in from the boxes' top corners, and one from each bar edge", () => {
        expect(swagsFor(312, [SEARCH, METERS, NEW, SPROUT], 1436)).toEqual([
            { x1: 312, y1: 1, x2: 469, y2: 5.5 },
            { x1: 825, y1: 5.5, x2: 996, y2: 5.5 },
            { x1: 1292, y1: 5.5, x2: 1306, y2: 5.5 },
            { x1: 1386, y1: 5.5, x2: 1400, y2: 5.5 },
            { x1: 1422, y1: 5.5, x2: 1436, y2: 1 },
        ]);
    });

    it("takes the boxes in any order", () => {
        expect(swagsFor(null, [SPROUT, SEARCH, NEW, METERS], null)).toEqual(
            swagsFor(null, [SEARCH, METERS, NEW, SPROUT], null)
        );
    });

    it("leaves out the end swag on Windows, where the window controls follow the fold button", () => {
        const swags = swagsFor(312, [SEARCH, METERS, NEW, SPROUT], null);
        expect(swags).toHaveLength(4);
        expect(swags[3]).toEqual({ x1: 1386, y1: 5.5, x2: 1400, y2: 5.5 });
    });

    it("skips a gap too narrow for a bulb, and boxes with no width", () => {
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

    it("gives a 10px gap between two buttons a single bulb in its middle", () => {
        const { sockets } = swagShape({ x1: 1292, y1: 5.5, x2: 1306, y2: 5.5 });
        expect(sockets).toEqual([{ x: 1299, y: expect.any(Number) }]);
        expect(sockets[0].y).toBeGreaterThan(5.5);
    });
});
