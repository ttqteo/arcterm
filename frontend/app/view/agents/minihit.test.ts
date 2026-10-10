// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { hitAny, toPagePoint } from "./minihit";

const sprout = { left: 260, top: 32, right: 340, bottom: 112 };
const chip = { left: 40, top: 70, right: 250, bottom: 100 };

describe("hitAny", () => {
    it("hits inside a drawn box", () => {
        expect(hitAny({ x: 300, y: 70 }, [sprout, chip])).toBe(true);
        expect(hitAny({ x: 41, y: 99 }, [sprout, chip])).toBe(true);
    });
    it("passes through the see-through margin", () => {
        expect(hitAny({ x: 255, y: 70 }, [sprout, chip])).toBe(false);
        expect(hitAny({ x: 10, y: 10 }, [sprout, chip])).toBe(false);
    });
    it("counts the left and top edges in and the right and bottom edges out", () => {
        expect(hitAny({ x: 260, y: 32 }, [sprout])).toBe(true);
        expect(hitAny({ x: 340, y: 50 }, [sprout])).toBe(false);
        expect(hitAny({ x: 300, y: 112 }, [sprout])).toBe(false);
    });
    it("passes everything through when nothing is drawn", () => {
        expect(hitAny({ x: 300, y: 70 }, [])).toBe(false);
    });
});

describe("toPagePoint", () => {
    it("turns Windows' physical cursor into the page's CSS pixels", () => {
        expect(toPagePoint({ x: 2600, y: 1700 }, { x: 2000, y: 1500 }, { cursor: 2, window: 2 }, false)).toEqual({
            x: 300,
            y: 100,
        });
    });
    // macOS reports the cursor in the primary monitor's scale and the window in its own: a 2x laptop with Sprout on a
    // 1x monitor put every cursor far outside every box, and the window ignored all clicks
    it("measures in points on macOS when the cursor's scale and the window's differ", () => {
        const cursor = { x: 3080, y: 600 }; // points (1540, 300) at the 2x primary's scale
        const inner = { x: 1500, y: 250 }; // points (1500, 250) at the 1x window's scale
        expect(toPagePoint(cursor, inner, { cursor: 2, window: 1 }, true)).toEqual({ x: 40, y: 50 });
    });
});
