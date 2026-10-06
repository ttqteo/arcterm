// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { avoidSpans, cornerFor, lowestLedge, measureLedge, type Box } from "./petledge";

const box = (left: number, top: number, right: number, bottom: number): Box => ({ left, top, right, bottom });
const VIEWPORT = { width: 1600, height: 900 };

describe("lowestLedge", () => {
    it("is the shown box with the greatest top", () => {
        const footer = box(0, 872, 1600, 900);
        expect(lowestLedge([box(78, 500, 900, 528), footer])).toBe(footer);
    });

    it("ignores boxes that are not shown", () => {
        const bar = box(78, 840, 1600, 868);
        expect(lowestLedge([bar, box(0, 0, 0, 0), box(0, 880, 1600, 880)])).toBe(bar);
    });

    it("is null when nothing is shown", () => {
        expect(lowestLedge([])).toBeNull();
        expect(lowestLedge([box(0, 0, 0, 0)])).toBeNull();
    });
});

describe("measureLedge", () => {
    it("runs from the nav rail to the window's right edge less 8 px, on the lowest ledge's top", () => {
        expect(measureLedge([box(0, 872, 1600, 900)], 78, VIEWPORT)).toEqual({ top: 872, left: 78, right: 1592 });
    });

    it("never runs past the ledge box's own ends", () => {
        // the Cockpit's HintsBar: from the surface's left to the Cockpit rail
        expect(measureLedge([box(90, 860, 1240, 890)], 78, VIEWPORT)).toEqual({ top: 860, left: 90, right: 1240 });
    });

    it("falls back to the window's bottom, and to the window's left without a nav rail", () => {
        expect(measureLedge([box(0, 0, 0, 0)], null, VIEWPORT)).toEqual({ top: 900, left: 0, right: 1592 });
    });
});

describe("avoidSpans", () => {
    const top = 872;

    it("keeps boxes that come within 80 px above the ledge", () => {
        const terminal = box(400, 100, 1200, 860);
        const composer = box(400, 800, 1200, 870);
        expect(avoidSpans([terminal, composer], top)).toEqual([
            [400, 1200],
            [400, 1200],
        ]);
    });

    it("drops boxes that end more than 80 px above the ledge, and boxes below it", () => {
        const high = box(100, 100, 300, top - 80);
        const below = box(100, top, 300, 900);
        const reaches = box(500, 100, 700, top - 79);
        expect(avoidSpans([high, below, reaches], top)).toEqual([[500, 700]]);
    });

    it("drops boxes that are not shown", () => {
        expect(avoidSpans([box(0, 0, 0, 0), box(400, 860, 400, 860)], top)).toEqual([]);
    });
});

describe("cornerFor", () => {
    it("is bottom-left while the creature's centre is in the left half, else bottom-right", () => {
        // centre = x + 24
        expect(cornerFor(775, 1600)).toBe("bottom-left");
        expect(cornerFor(776, 1600)).toBe("bottom-right");
        expect(cornerFor(1500, 1600)).toBe("bottom-right");
    });
});
