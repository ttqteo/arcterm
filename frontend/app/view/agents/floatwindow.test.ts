// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
    FLOAT_DEFAULT_SIZE,
    FLOAT_MIN_SIZE,
    floatRect,
    framesMatch,
    MINI_CHAT_SIZE,
    MINI_REST_SIZE,
    miniSides,
    miniSproutRect,
    miniWindowRect,
    parseMiniRestore,
    parseRect,
    parseRestore,
    screenFor,
    spaceScale,
    sproutFromWindow,
    toSpace,
    type MiniSides,
} from "./floatwindow";

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

describe("miniSproutRect", () => {
    it("puts a Sprout with no spot in the bottom-right corner of the work area, 24px in", () => {
        expect(miniSproutRect(null, laptop, 2)).toEqual({
            x: laptop.x + laptop.width - 128 - 48,
            y: laptop.y + laptop.height - 128 - 48,
            width: 128,
            height: 128,
        });
    });
    it("keeps a spot that is on screen", () => {
        expect(miniSproutRect({ x: 100, y: 300, width: 128, height: 128 }, laptop, 2)).toEqual({
            x: 100,
            y: 300,
            width: 128,
            height: 128,
        });
    });
    it("pulls a Sprout past the screen's edge back onto it", () => {
        expect(miniSproutRect({ x: -500, y: 5000, width: 128, height: 128 }, laptop, 2)).toEqual({
            x: 0,
            y: laptop.y + laptop.height - 128,
            width: 128,
            height: 128,
        });
    });
    it("takes its size from this screen's scale, not the spot's", () => {
        expect(miniSproutRect({ x: 3000, y: 100, width: 128, height: 128 }, side, 1)).toMatchObject({
            width: 64,
            height: 64,
        });
    });
    it("a Sprout left on a monitor that is gone floats on the window's own", () => {
        const gone = { x: 9000, y: 200, width: 64, height: 64 };
        const screen = screenFor(gone, [{ area: laptop, scale: 2 }], { area: laptop, scale: 2 });
        const r = miniSproutRect(gone, screen.area, screen.scale);
        expect(r.x + r.width).toBeLessThanOrEqual(laptop.x + laptop.width);
        expect(r.y).toBeGreaterThanOrEqual(laptop.y);
    });
});

describe("miniSides", () => {
    it("opens left and up from the bottom-right corner", () => {
        expect(miniSides({ x: 2600, y: 1600, width: 160, height: 160 }, laptop)).toEqual({ h: "left", v: "up" });
    });
    it("opens right and down from the top-left corner", () => {
        expect(miniSides({ x: 40, y: 90, width: 160, height: 160 }, laptop)).toEqual({ h: "right", v: "down" });
    });
});

describe("miniWindowRect", () => {
    const corner = { x: 2600, y: 1600, width: 128, height: 128 };
    it("rests in a box with Sprout in its bottom-right corner when things open left and up", () => {
        expect(miniWindowRect(corner, MINI_REST_SIZE, { h: "left", v: "up" }, laptop, 2)).toEqual({
            x: 2600 + 128 - 640,
            y: 1600 + 128 - 464,
            width: 640,
            height: 464,
        });
    });
    it("opens right and down from a Sprout in the top-left corner", () => {
        const topLeft = { x: 40, y: 90, width: 128, height: 128 };
        expect(miniWindowRect(topLeft, MINI_CHAT_SIZE, { h: "right", v: "down" }, laptop, 2)).toEqual({
            x: 40,
            y: 90,
            width: 760,
            height: 1240,
        });
    });
    it("shortens the chat to the room there is rather than moving Sprout", () => {
        const small = { x: 0, y: 0, width: 1280, height: 700 };
        const low = { x: 1176, y: 480, width: 64, height: 64 };
        expect(miniWindowRect(low, MINI_CHAT_SIZE, { h: "left", v: "up" }, small, 1)).toEqual({
            x: 1176 + 64 - 380,
            y: 0,
            width: 380,
            height: 544,
        });
    });
});

describe("sproutFromWindow", () => {
    it("finds Sprout again from the window around it, whichever way it opens", () => {
        const corner = { x: 2600, y: 1600, width: 128, height: 128 };
        const all: MiniSides[] = [
            { h: "left", v: "up" },
            { h: "right", v: "down" },
            { h: "left", v: "down" },
            { h: "right", v: "up" },
        ];
        for (const sides of all) {
            const win = miniWindowRect(corner, MINI_CHAT_SIZE, sides, laptop, 2);
            expect(sproutFromWindow(win, sides, 2)).toEqual(corner);
        }
    });
});

describe("parseMiniRestore", () => {
    it("reads back what was stored", () => {
        const stored = {
            origin: "full",
            rect: { x: 10, y: 20, width: 720, height: 460 },
            maximized: true,
            fullscreen: false,
            pinned: false,
        };
        expect(parseMiniRestore(JSON.parse(JSON.stringify(stored)))).toEqual(stored);
    });
    // a session stored by the first fold, which only folded floats
    it("reads a restore from before Full could fold as a float's", () => {
        expect(parseMiniRestore({ rect: { x: 10, y: 20, width: 720, height: 460 }, pinned: true })).toEqual({
            origin: "float",
            rect: { x: 10, y: 20, width: 720, height: 460 },
            maximized: false,
            fullscreen: false,
            pinned: true,
        });
    });
    it("rejects a value without its pin or with a broken rect", () => {
        expect(parseMiniRestore({ rect: { x: 10, y: 20, width: 720, height: 460 } })).toBeNull();
        expect(parseMiniRestore({ rect: { x: 10 }, pinned: false })).toBeNull();
        expect(parseMiniRestore("junk")).toBeNull();
    });
});

describe("toSpace and spaceScale", () => {
    // a 2x laptop (1440x900 points) with a 1x monitor to its right: tao reports each in its own scale
    const laptopPhysical = { x: 0, y: 0, width: 2880, height: 1800 };
    const externalPhysical = { x: 1440, y: 0, width: 1920, height: 1080 };
    it("puts monitors of different scales into one space on macOS: points", () => {
        const a = toSpace(laptopPhysical, 2, true);
        const b = toSpace(externalPhysical, 1, true);
        expect(a).toEqual({ x: 0, y: 0, width: 1440, height: 900 });
        expect(b.x).toBe(a.x + a.width);
    });
    it("leaves Windows' physical pixels alone, which already share one space", () => {
        expect(toSpace(laptopPhysical, 2, false)).toEqual(laptopPhysical);
    });
    it("scales logical sizes by 1 in points and by the monitor's scale in physical pixels", () => {
        expect(spaceScale(2, true)).toBe(1);
        expect(spaceScale(1.5, false)).toBe(1.5);
    });
});

// macOS can still be animating a window (an unmaximize's zoom) when the fold sets its frame; the fold reads the frame
// back and sets it again until it holds
describe("framesMatch", () => {
    const want = { x: 1000, y: 600, width: 320, height: 232 };
    it("holds a frame that landed, give or take a rounding pixel", () => {
        expect(framesMatch(want, want)).toBe(true);
        expect(framesMatch({ ...want, x: 1001, height: 231 }, want)).toBe(true);
    });
    it("does not hold a frame something else moved or resized", () => {
        expect(framesMatch({ ...want, y: 25 }, want)).toBe(false);
        expect(framesMatch({ ...want, width: 1440, height: 875 }, want)).toBe(false);
    });
});
