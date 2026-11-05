// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
    CHRISTMAS_THEME,
    christmasMotionOn,
    christmasSnowShows,
    GIFT_MAX,
    giftCount,
    hasChristmasDecor,
    santaHatBox,
} from "./christmas";

describe("hasChristmasDecor", () => {
    it("shows for the Christmas preset while its effects are on", () => {
        expect(CHRISTMAS_THEME).toBe("christmas");
        expect(hasChristmasDecor("christmas", false)).toBe(true);
    });

    it("hides once the effects are turned off", () => {
        expect(hasChristmasDecor("christmas", true)).toBe(false);
    });

    it("never shows for another preset", () => {
        for (const preset of ["claude", "spider", "", "Christmas"]) {
            expect(hasChristmasDecor(preset, false)).toBe(false);
            expect(hasChristmasDecor(preset, true)).toBe(false);
        }
    });
});

describe("christmasMotionOn", () => {
    it("moves while the decor shows and reduced motion is off", () => {
        expect(christmasMotionOn(true, false)).toBe(true);
    });

    it("stops under reduced motion", () => {
        expect(christmasMotionOn(true, true)).toBe(false);
    });

    it("stops whenever the decor is off", () => {
        expect(christmasMotionOn(false, false)).toBe(false);
        expect(christmasMotionOn(false, true)).toBe(false);
    });
});

describe("christmasSnowShows", () => {
    it("shows only while the decor shows and the Snow switch is on", () => {
        expect(christmasSnowShows(true, true)).toBe(true);
        expect(christmasSnowShows(true, false)).toBe(false);
        expect(christmasSnowShows(false, true)).toBe(false);
        expect(christmasSnowShows(false, false)).toBe(false);
    });
});

describe("giftCount", () => {
    it("is one box a finished agent or done task", () => {
        expect(giftCount(0, 0)).toBe(0);
        expect(giftCount(3, 2)).toBe(5);
    });

    it("stops at six boxes", () => {
        expect(GIFT_MAX).toBe(6);
        expect(giftCount(4, 9)).toBe(6);
        expect(giftCount(6, 0)).toBe(6);
    });

    it("never goes below zero", () => {
        expect(giftCount(-2, 0)).toBe(0);
        expect(giftCount(0, -5)).toBe(0);
        expect(giftCount(-1, 3)).toBe(3);
    });
});

describe("santaHatBox", () => {
    // board A (christmas-nav-icons/A-rail-hats.dc.html) draws these two sizes
    it("draws a 20px icon's hat at 14px, 6px left and 8px up", () => {
        expect(santaHatBox(20)).toEqual({ size: 14, left: -6, top: -8 });
    });

    it("draws a 16px icon's hat at 11px, 4px left and 7px up", () => {
        expect(santaHatBox(16)).toEqual({ size: 11, left: -4, top: -7 });
    });

    it("keeps clear of the top-right badge: the hat ends left of the icon's right edge", () => {
        for (const icon of [16, 20]) {
            const b = santaHatBox(icon);
            expect(b.left + b.size).toBeLessThan(icon * 0.5);
        }
    });
});
