// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { FLOAT_DEFAULT_SIZE, FLOAT_MIN_SIZE, floatRect, parseRect, parseRestore, screenFor } from "./floatwindow";

// a 1440x900 laptop screen at 2x, its menu bar taking the top 25 logical pixels
const laptop = { x: 0, y: 50, width: 2880, height: 1750 };
// a 1920x1080 monitor at 1x to its right
const side = { x: 2880, y: 0, width: 1920, height: 1080 };

describe("floatRect", () => {
    it("puts a first float at the default size in the bottom-right corner", () => {
        const r = floatRect(null, laptop, 2);
        expect(r.width).toBe(FLOAT_DEFAULT_SIZE.width * 2);
        expect(r.height).toBe(FLOAT_DEFAULT_SIZE.height * 2);
        expect(r.x + r.width).toBe(laptop.x + laptop.width - 48);
        expect(r.y + r.height).toBe(laptop.y + laptop.height - 48);
    });
    it("reopens where the last float was", () => {
        const last = { x: 3000, y: 100, width: 800, height: 500 };
        expect(floatRect(last, side, 1)).toEqual(last);
    });
    it("pulls a float that hangs off the screen back onto it", () => {
        const r = floatRect({ x: 4500, y: 900, width: 800, height: 500 }, side, 1);
        expect(r).toEqual({ x: side.x + side.width - 800, y: side.y + side.height - 500, width: 800, height: 500 });
    });
    it("never goes below the float's minimum size or above the screen's", () => {
        expect(floatRect({ x: 0, y: 50, width: 100, height: 100 }, laptop, 2)).toMatchObject({
            width: FLOAT_MIN_SIZE.width * 2,
            height: FLOAT_MIN_SIZE.height * 2,
        });
        expect(floatRect({ x: 2880, y: 0, width: 5000, height: 5000 }, side, 1)).toEqual(side);
    });
});

describe("screenFor", () => {
    const laptopScreen = { area: laptop, scale: 2 };
    const sideScreen = { area: side, scale: 1 };
    it("is the screen the last float's centre was on", () => {
        const last = { x: 3000, y: 100, width: 800, height: 500 };
        expect(screenFor(last, [laptopScreen, sideScreen], laptopScreen)).toBe(sideScreen);
    });
    it("is the window's own screen for a first float, or when that screen is gone", () => {
        expect(screenFor(null, [laptopScreen, sideScreen], laptopScreen)).toBe(laptopScreen);
        const last = { x: 9000, y: 0, width: 800, height: 500 };
        expect(screenFor(last, [laptopScreen], laptopScreen)).toBe(laptopScreen);
    });
});

describe("parseRect and parseRestore", () => {
    it("read back what was stored", () => {
        const rect = { x: -10, y: 20, width: 800, height: 500 };
        expect(parseRect(rect)).toEqual(rect);
        expect(parseRestore({ rect, maximized: true, terminalFullscreen: false })).toEqual({
            rect,
            maximized: true,
            terminalFullscreen: false,
        });
    });
    it("reject anything malformed", () => {
        expect(parseRect(null)).toBeNull();
        expect(parseRect({ x: 0, y: 0, width: "800", height: 500 })).toBeNull();
        expect(parseRect({ x: 0, y: 0, width: 0, height: 500 })).toBeNull();
        expect(parseRestore({ rect: { x: 0, y: 0, width: 800, height: 500 }, maximized: "yes" })).toBeNull();
        expect(parseRestore("{}")).toBeNull();
    });
});
