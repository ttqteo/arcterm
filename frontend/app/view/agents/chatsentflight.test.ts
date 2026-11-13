// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { flightAt, flightOpacity, scrollToGo, type FlightAnchor, type SentFrom } from "./chatsentflight";

// the box's text at 14px, its first line centred at y 700; the bubble's text at 13.5px, 14px in and ~19px down
const from: SentFrom = { x: 120, y: 700, fontSize: 14 };
const anchor: FlightAnchor = { x: 14, y: 19.5, fontSize: 13.5 };
const target = { left: 500, top: 400 };

// where the flying element's text starts on screen under a transform
const textAt = (f: { dx: number; dy: number; scale: number }) => ({
    x: target.left + f.dx + anchor.x * f.scale,
    y: target.top + f.dy + anchor.y * f.scale,
});

describe("flightAt", () => {
    it("starts with the bubble's text over the box's, at the box's size", () => {
        const f = flightAt(from, target, anchor, 0);
        expect(f.scale).toBeCloseTo(14 / 13.5);
        const at = textAt(f);
        expect(at.x).toBeCloseTo(from.x);
        expect(at.y).toBeCloseTo(from.y);
    });

    it("lands as no transform at all", () => {
        expect(flightAt(from, target, anchor, 1)).toEqual({ dx: 0, dy: 0, scale: 1 });
    });

    it("holds the ends past the spring's range", () => {
        expect(flightAt(from, target, anchor, 1.02)).toEqual(flightAt(from, target, anchor, 1));
        expect(flightAt(from, target, anchor, -0.1)).toEqual(flightAt(from, target, anchor, 0));
    });

    it("slides toward its side a little ahead of its rise, so the path curves", () => {
        const at = textAt(flightAt(from, target, anchor, 0.5));
        const xDone = (at.x - from.x) / (target.left + anchor.x - from.x);
        const yDone = (at.y - from.y) / (target.top + anchor.y - from.y);
        expect(yDone).toBeCloseTo(0.5);
        expect(xDone).toBeGreaterThan(yDone);
        expect(xDone).toBeLessThan(1);
    });

    it("follows a place that moves while it flies: the text heads for where the place is now", () => {
        const moved = { left: 500, top: 340 };
        const f = flightAt(from, moved, anchor, 0.5);
        const y = moved.top + f.dy + anchor.y * f.scale;
        expect(y).toBeCloseTo(from.y + (moved.top + anchor.y - from.y) * 0.5);
    });

    it("keeps the size when the box has none to give", () => {
        expect(flightAt({ ...from, fontSize: 0 }, target, anchor, 0).scale).toBe(1);
    });
});

describe("flightOpacity", () => {
    it("leaves the box at full strength and lands dimmed", () => {
        expect(flightOpacity(0.55, 0)).toBe(1);
        expect(flightOpacity(0.55, 1)).toBeCloseTo(0.55);
        expect(flightOpacity(0.55, 0.5)).toBeCloseTo(0.775);
        expect(flightOpacity(0.55, 1.1)).toBeCloseTo(0.55);
    });
});

describe("scrollToGo", () => {
    it("is what is left to the scroller's end, never below zero", () => {
        expect(scrollToGo({ scrollHeight: 2000, clientHeight: 600, scrollTop: 1360 })).toBe(40);
        expect(scrollToGo({ scrollHeight: 2000, clientHeight: 600, scrollTop: 1400 })).toBe(0);
        expect(scrollToGo({ scrollHeight: 300, clientHeight: 600, scrollTop: 0 })).toBe(0);
    });
});
