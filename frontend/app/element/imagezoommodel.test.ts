// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
    MAX_SCALE,
    canPan,
    clampView,
    fitScale,
    fitView,
    panBy,
    stageCenter,
    wheelFactor,
    zoomAt,
    zoomKeyAction,
    zoomPercent,
} from "./imagezoommodel";

const stage = { width: 800, height: 600 };
const big = { width: 1600, height: 800 };
const small = { width: 200, height: 100 };

describe("fit", () => {
    it("shrinks a large image to the stage's tighter axis", () => {
        expect(fitScale(big, stage)).toBe(0.5);
    });

    it("never enlarges a small image", () => {
        expect(fitScale(small, stage)).toBe(1);
    });

    it("treats an unmeasured image or stage as 1:1", () => {
        expect(fitScale({ width: 0, height: 0 }, stage)).toBe(1);
        expect(fitScale(big, { width: 0, height: 0 })).toBe(1);
    });

    it("centers the fitted image on both axes", () => {
        expect(fitView(big, stage)).toEqual({ scale: 0.5, x: 0, y: 100 });
        expect(fitView(small, stage)).toEqual({ scale: 1, x: 300, y: 250 });
    });
});

describe("zoomAt", () => {
    it("keeps the image pixel under the pointer in place", () => {
        const fit = fitView(big, stage);
        const at = { x: 200, y: 300 };
        const imgPx = { x: (at.x - fit.x) / fit.scale, y: (at.y - fit.y) / fit.scale };
        const zoomed = zoomAt(fit, 2, at, big, stage);
        expect(zoomed.scale).toBe(1);
        expect(zoomed.x + imgPx.x * zoomed.scale).toBeCloseTo(at.x);
        expect(zoomed.y + imgPx.y * zoomed.scale).toBeCloseTo(at.y);
    });

    it("does not zoom out past fit", () => {
        const fit = fitView(big, stage);
        expect(zoomAt(fit, 0.5, stageCenter(stage), big, stage)).toEqual(fit);
    });

    it("stops at the maximum scale", () => {
        const view = zoomAt(fitView(big, stage), 1000, stageCenter(stage), big, stage);
        expect(view.scale).toBe(MAX_SCALE);
    });

    it("zooming about the center keeps the center pixel centered", () => {
        const fit = fitView(big, stage);
        const c = stageCenter(stage);
        const zoomed = zoomAt(fit, 3, c, big, stage);
        const imgPx = (c.x - fit.x) / fit.scale;
        expect(zoomed.x + imgPx * zoomed.scale).toBeCloseTo(c.x);
    });

    it("clamps a zoom near an edge so no gap opens", () => {
        const fit = fitView(big, stage);
        const zoomed = zoomAt(fit, 2, { x: 0, y: 100 }, big, stage);
        expect(zoomed.x).toBe(0);
        expect(zoomed.y).toBeLessThanOrEqual(0);
    });

    it("fits again from a zoomed view", () => {
        const fit = fitView(big, stage);
        const zoomed = zoomAt(fit, 4, { x: 300, y: 200 }, big, stage);
        expect(zoomed.scale).toBeGreaterThan(fit.scale);
        // the 0 key drops the view and the overlay shows fitView afresh
        expect(fitView(big, stage)).toEqual(fit);
        // zooming back out by the same factor from the same point also lands on fit, never below it
        expect(zoomAt(zoomed, 1 / 4, { x: 300, y: 200 }, big, stage)).toEqual(fit);
    });
});

describe("pan", () => {
    it("moves a zoomed image within its bounds", () => {
        const view = { scale: 1, x: -400, y: -100 };
        expect(panBy(view, 100, 50, big, stage)).toEqual({ scale: 1, x: -300, y: -50 });
    });

    it("stops at the image edges", () => {
        const view = { scale: 1, x: -400, y: -100 };
        expect(panBy(view, 10_000, 10_000, big, stage)).toEqual({ scale: 1, x: 0, y: 0 });
        expect(panBy(view, -10_000, -10_000, big, stage)).toEqual({ scale: 1, x: -800, y: -200 });
    });

    it("keeps an image that fits centered", () => {
        expect(panBy(fitView(small, stage), 50, 50, small, stage)).toEqual(fitView(small, stage));
    });

    it("can pan only while part of the image is outside the stage", () => {
        expect(canPan(fitView(big, stage), big, stage)).toBe(false);
        expect(canPan({ scale: 1, x: 0, y: 0 }, big, stage)).toBe(true);
    });
});

describe("clampView", () => {
    it("raises a scale below fit to fit, as after the stage grows", () => {
        expect(clampView({ scale: 0.1, x: 0, y: 0 }, big, stage).scale).toBe(0.5);
    });
});

describe("readout and input", () => {
    it("reports the scale as a whole percent", () => {
        expect(zoomPercent({ scale: 0.4567, x: 0, y: 0 })).toBe(46);
    });

    it("zooms in on a wheel scrolled up and out on one scrolled down", () => {
        expect(wheelFactor(-100)).toBeGreaterThan(1);
        expect(wheelFactor(100)).toBeLessThan(1);
        expect(wheelFactor(0)).toBe(1);
    });

    it("maps +, -, 0 with or without Shift and ignores other keys", () => {
        expect(["+", "="].map(zoomKeyAction)).toEqual(["in", "in"]);
        expect(["-", "_"].map(zoomKeyAction)).toEqual(["out", "out"]);
        expect(zoomKeyAction("0")).toBe("fit");
        expect(zoomKeyAction("a")).toBeNull();
    });
});
