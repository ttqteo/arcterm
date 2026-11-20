// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
    copyPixelScale,
    easeToward,
    fitView,
    MAX_SCALE,
    MIN_SCALE,
    panBy,
    wheelFactor,
    wheelZoomFactor,
    zoomAt,
} from "./mermaidzoom";

describe("fitView", () => {
    it("shrinks a wide diagram to the box and centres it", () => {
        const v = fitView({ w: 2000, h: 400 }, { w: 1048, h: 600 });
        expect(v.scale).toBeCloseTo(0.5);
        expect(v.x).toBeCloseTo(24);
        expect(v.y).toBeCloseTo((600 - 200) / 2);
    });

    it("never enlarges a small diagram", () => {
        const v = fitView({ w: 200, h: 100 }, { w: 1000, h: 800 });
        expect(v.scale).toBe(1);
        expect(v.x).toBe(400);
        expect(v.y).toBe(350);
    });

    it("falls back to the natural size when nothing is measured yet", () => {
        expect(fitView({ w: 0, h: 0 }, { w: 800, h: 600 })).toEqual({ scale: 1, x: 0, y: 0 });
        expect(fitView({ w: 300, h: 200 }, { w: 0, h: 0 })).toEqual({ scale: 1, x: 0, y: 0 });
    });
});

describe("zoomAt", () => {
    it("keeps the point under the cursor still", () => {
        const v = { scale: 1, x: 10, y: 20 };
        const z = zoomAt(v, 2, 110, 70);
        // the diagram point under (110, 70) was (100, 50); it is still under the cursor
        expect((110 - z.x) / z.scale).toBeCloseTo(100);
        expect((70 - z.y) / z.scale).toBeCloseTo(50);
        expect(z.scale).toBe(2);
    });

    it("stops at the scale bounds without drifting", () => {
        const top = zoomAt({ scale: MAX_SCALE, x: 5, y: 5 }, 2, 300, 300);
        expect(top).toEqual({ scale: MAX_SCALE, x: 5, y: 5 });
        expect(zoomAt({ scale: 0.2, x: 0, y: 0 }, 0.01, 0, 0).scale).toBe(MIN_SCALE);
    });
});

describe("panBy and wheelFactor", () => {
    it("moves the view by the drag", () => {
        expect(panBy({ scale: 2, x: 1, y: 2 }, 10, -5)).toEqual({ scale: 2, x: 11, y: -3 });
    });

    it("zooms in on a wheel up, out on a wheel down", () => {
        expect(wheelFactor(-100)).toBeGreaterThan(1);
        expect(wheelFactor(100)).toBeLessThan(1);
        expect(wheelFactor(100) * wheelFactor(-100)).toBeCloseTo(1);
    });
});

describe("wheelZoomFactor", () => {
    const base = { deltaY: 0, deltaMode: 0, ctrlKey: false };

    it("zooms a plain wheel as before", () => {
        expect(wheelZoomFactor({ ...base, deltaY: 100 })).toBeCloseTo(wheelFactor(100));
    });

    it("zooms a pinch (ctrl wheel, a few px) faster per px, capped per event", () => {
        expect(wheelZoomFactor({ ...base, deltaY: -4, ctrlKey: true })).toBeGreaterThan(wheelFactor(-4));
        expect(wheelZoomFactor({ ...base, deltaY: -100, ctrlKey: true })).toBeLessThan(1.3);
        expect(wheelZoomFactor({ ...base, deltaY: 4, ctrlKey: true })).toBeLessThan(1);
    });

    it("reads a wheel that counts lines as px", () => {
        expect(wheelZoomFactor({ ...base, deltaY: 3, deltaMode: 1 })).toBeCloseTo(wheelFactor(99));
    });
});

describe("easeToward", () => {
    it("moves part of the way each frame, keeping the zoom point still", () => {
        const cur = { scale: 1, x: 0, y: 0 };
        const target = zoomAt(cur, 2, 100, 50);
        const mid = easeToward(cur, target, 16);
        expect(mid.scale).toBeGreaterThan(1);
        expect(mid.scale).toBeLessThan(2);
        // the point (100, 50) of the viewport shows the same diagram point mid-way
        expect((100 - mid.x) / mid.scale).toBeCloseTo(100);
        expect((50 - mid.y) / mid.scale).toBeCloseTo(50);
    });

    it("lands on the target once close", () => {
        const target = { scale: 1.5, x: 10, y: 10 };
        let v = { scale: 1, x: 0, y: 0 };
        for (let i = 0; i < 60; i++) {
            v = easeToward(v, target, 16);
        }
        expect(v).toBe(target);
    });
});

describe("copyPixelScale", () => {
    it("copies at twice the size, less for a huge diagram", () => {
        expect(copyPixelScale({ w: 800, h: 300 })).toBe(2);
        expect(copyPixelScale({ w: 8192, h: 100 })).toBe(1);
        expect(copyPixelScale({ w: 0, h: 0 })).toBe(2);
    });
});
