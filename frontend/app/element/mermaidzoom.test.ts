// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
    copyPixelScale,
    easeScale,
    fitScale,
    fitScroll,
    layoutAt,
    MAX_SCALE,
    MIN_SCALE,
    resizeScroll,
    wheelAction,
    wheelFactor,
    wheelZoomFactor,
    zoomScroll,
} from "./mermaidzoom";

describe("fitScale and fitScroll", () => {
    it("shrinks a wide diagram to the box, centred", () => {
        expect(fitScale({ w: 2000, h: 400 }, { w: 1048, h: 600 })).toBeCloseTo(0.5);
        expect(fitScroll({ w: 2000, h: 400 }, { w: 1048, h: 600 })).toEqual({ scale: 0.5, left: 0, top: 0 });
    });

    it("never enlarges a small diagram", () => {
        expect(fitScale({ w: 200, h: 100 }, { w: 1000, h: 800 })).toBe(1);
    });

    it("falls back to the natural size when nothing is measured yet", () => {
        expect(fitScale({ w: 0, h: 0 }, { w: 800, h: 600 })).toBe(1);
        expect(fitScale({ w: 300, h: 200 }, { w: 0, h: 0 })).toBe(1);
    });
});

describe("layoutAt", () => {
    it("centres a diagram smaller than the box in a box-sized canvas", () => {
        expect(layoutAt({ w: 200, h: 100 }, { w: 1000, h: 800 }, 1)).toEqual({ w: 1000, h: 800, x: 400, y: 350 });
    });

    it("grows the canvas past the box with room at the edges", () => {
        expect(layoutAt({ w: 1000, h: 500 }, { w: 800, h: 600 }, 2)).toEqual({ w: 2048, h: 1048, x: 24, y: 24 });
    });
});

describe("zoomScroll", () => {
    const content = { w: 1000, h: 800 };
    const box = { w: 800, h: 600 };
    // the diagram point under a box point
    const under = (v: { scale: number; left: number; top: number }, px: number, py: number) => {
        const l = layoutAt(content, box, v.scale);
        return { x: (v.left + px - l.x) / v.scale, y: (v.top + py - l.y) / v.scale };
    };

    it("keeps the point under the cursor still", () => {
        const cur = { scale: 1, left: 100, top: 150 };
        const z = zoomScroll(content, box, cur, 2, 300, 200);
        expect(z.scale).toBe(2);
        expect(under(z, 300, 200).x).toBeCloseTo(under(cur, 300, 200).x);
        expect(under(z, 300, 200).y).toBeCloseTo(under(cur, 300, 200).y);
    });

    it("stops the scroll at the canvas's edge, and the scale at its bounds", () => {
        const z = zoomScroll(content, box, { scale: 1, left: 0, top: 0 }, 0.5, 0, 0);
        expect(z).toEqual({ scale: 0.5, left: 0, top: 0 });
        expect(zoomScroll(content, box, { scale: 4, left: 0, top: 0 }, 100, 0, 0).scale).toBe(MAX_SCALE);
        expect(zoomScroll(content, box, { scale: 0.2, left: 0, top: 0 }, 0.001, 0, 0).scale).toBe(MIN_SCALE);
    });
});

describe("resizeScroll", () => {
    it("keeps the diagram point at the box's centre", () => {
        const content = { w: 2000, h: 2000 };
        const cur = { scale: 1, left: 500, top: 400 };
        const next = resizeScroll(content, { w: 800, h: 600 }, { w: 1000, h: 700 }, cur);
        // centre point (500 + 400 - 24, 400 + 300 - 24) before, the same after
        expect(next.left + 500 - 24).toBeCloseTo(876);
        expect(next.top + 350 - 24).toBeCloseTo(676);
    });
});

describe("wheelFactor", () => {
    it("zooms in on a wheel up, out on a wheel down", () => {
        expect(wheelFactor(-100)).toBeGreaterThan(1);
        expect(wheelFactor(100)).toBeLessThan(1);
        expect(wheelFactor(100) * wheelFactor(-100)).toBeCloseTo(1);
    });
});

describe("wheelZoomFactor", () => {
    const base = { deltaY: 0, deltaMode: 0, ctrlKey: false };

    it("zooms a cmd wheel by its px", () => {
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

describe("wheelAction", () => {
    const base = { deltaY: 0, deltaMode: 0, ctrlKey: false, metaKey: false };

    it("leaves a plain wheel, a trackpad swipe or a mouse notch, to the box's own scroll", () => {
        expect(wheelAction({ ...base, deltaY: 12 })).toEqual({ kind: "scroll" });
        expect(wheelAction({ ...base, deltaY: 100 })).toEqual({ kind: "scroll" });
        expect(wheelAction({ ...base, deltaY: 3, deltaMode: 1 })).toEqual({ kind: "scroll" });
    });

    it("zooms a pinch (ctrl wheel) at once, and a cmd wheel eased toward the cursor", () => {
        const pinch = { ...base, deltaY: -4, ctrlKey: true };
        expect(wheelAction(pinch)).toEqual({ kind: "zoom", factor: wheelZoomFactor(pinch), instant: true });
        const cmd = { ...base, deltaY: -100, metaKey: true };
        expect(wheelAction(cmd)).toEqual({ kind: "zoom", factor: wheelFactor(-100), instant: false });
        const cmdLines = { ...base, deltaY: 3, deltaMode: 1, metaKey: true };
        expect(wheelAction(cmdLines)).toEqual({ kind: "zoom", factor: wheelFactor(99), instant: false });
    });
});

describe("easeScale", () => {
    it("moves part of the way each frame and lands on the target once close", () => {
        const mid = easeScale(1, 2, 16);
        expect(mid).toBeGreaterThan(1);
        expect(mid).toBeLessThan(2);
        let v = 1;
        for (let i = 0; i < 60; i++) {
            v = easeScale(v, 1.5, 16);
        }
        expect(v).toBe(1.5);
    });
});

describe("copyPixelScale", () => {
    it("copies at twice the size, less for a huge diagram", () => {
        expect(copyPixelScale({ w: 800, h: 300 })).toBe(2);
        expect(copyPixelScale({ w: 8192, h: 100 })).toBe(1);
        expect(copyPixelScale({ w: 0, h: 0 })).toBe(2);
    });
});
