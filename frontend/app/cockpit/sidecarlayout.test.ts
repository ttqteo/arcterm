// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
    layoutFor,
    pinButtonChange,
    RESOURCES_MIN_H,
    RESOURCES_MIN_W,
    resourcesColumnFits,
    SMALL_BREAK_PX,
    smallButtonChange,
} from "./sidecarlayout";

describe("resourcesColumnFits", () => {
    it("shows the column only on the wall, wide and tall enough", () => {
        expect(resourcesColumnFits("wall", RESOURCES_MIN_W, RESOURCES_MIN_H)).toBe(true);
        expect(resourcesColumnFits("wall", RESOURCES_MIN_W - 1, 2000)).toBe(false);
        expect(resourcesColumnFits("wall", 4000, RESOURCES_MIN_H - 1)).toBe(false);
        expect(resourcesColumnFits("small", 4000, 2000)).toBe(false);
    });
});

describe("layoutFor", () => {
    it("the full window from 1100 px, the small form below it", () => {
        expect(SMALL_BREAK_PX).toBe(1100);
        expect(layoutFor(1099)).toBe("small");
        expect(layoutFor(1100)).toBe("wall");
    });

    it("the narrowest window and a wide screen land on their side", () => {
        expect(layoutFor(340)).toBe("small");
        expect(layoutFor(1920)).toBe("wall");
    });

    it("a window that fills a high-scale screen is the wall, whatever its CSS width", () => {
        // 1920 px at 175%: the screen and a maximized or full-screen window are both about 1097 CSS px
        expect(layoutFor(1097, 1097)).toBe("wall");
        expect(layoutFor(1085, 1097)).toBe("wall");
        // the same screen, the window dragged narrower: the small form
        expect(layoutFor(700, 1097)).toBe("small");
        expect(layoutFor(340, 1097)).toBe("small");
        // a screen that is not known reads as width alone
        expect(layoutFor(1097, 0)).toBe("small");
    });

    it("a window not measured yet (0 px) is the small form, not a crash", () => {
        expect(layoutFor(0)).toBe("small");
    });
});

describe("the S and pin buttons' changes", () => {
    it("S asks for the other form and says nothing of the pin", () => {
        expect(smallButtonChange({ small: false, pinned: false })).toEqual({ small: true });
        expect(smallButtonChange({ small: true, pinned: true })).toEqual({ small: false });
    });

    it("the pin flips the pin alone, small or not", () => {
        expect(pinButtonChange({ small: true, pinned: true })).toEqual({ pinned: false });
        expect(pinButtonChange({ small: true, pinned: false })).toEqual({ pinned: true });
        expect(pinButtonChange({ small: false, pinned: false })).toEqual({ pinned: true });
    });
});
