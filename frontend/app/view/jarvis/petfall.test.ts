// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { BOUNCE_PX, fallSeconds, landing, ledgeShift, MAX_FALL_S, MIN_FALL_S } from "./petfall";

describe("fallSeconds", () => {
    it("takes longer the farther it falls, as under gravity: four times the height, twice the time", () => {
        expect(fallSeconds(160)).toBeGreaterThan(fallSeconds(40));
        expect(fallSeconds(160) / fallSeconds(40)).toBeCloseTo(2, 5);
    });

    it("is clamped, so a short drop still reads and a long one does not drag", () => {
        expect(fallSeconds(1)).toBe(MIN_FALL_S);
        expect(fallSeconds(5000)).toBe(MAX_FALL_S);
    });

    it("reads the distance whichever side of the ledge it starts on", () => {
        expect(fallSeconds(-100)).toBe(fallSeconds(100));
    });
});

describe("ledgeShift", () => {
    it("is nothing at boot, with no ledge before it", () => {
        expect(ledgeShift(null, { top: 972, vh: 1000 })).toBe(0);
    });

    // the Cockpit's HintsBar is taller than the footer, so switching to it raises the ledge
    it("starts the sprite below a ledge that rose, where it stood a moment ago", () => {
        expect(ledgeShift({ top: 972, vh: 1000 }, { top: 965, vh: 1000 })).toBe(7);
    });

    // the Cockpit before its roster is ready draws no bar, so the window's bottom is the ledge
    it("starts the sprite above a ledge that fell away", () => {
        expect(ledgeShift({ top: 972, vh: 1000 }, { top: 1000, vh: 1000 })).toBe(-28);
    });

    it("ignores a window resize, which moves the ledge and the window's bottom together", () => {
        expect(ledgeShift({ top: 972, vh: 1000 }, { top: 872, vh: 900 })).toBe(0);
    });

    it("counts only the bar's change when a resize and a switch land together", () => {
        expect(ledgeShift({ top: 972, vh: 1000 }, { top: 865, vh: 900 })).toBe(7);
    });

    it("ignores sub-pixel layout jitter", () => {
        expect(ledgeShift({ top: 972, vh: 1000 }, { top: 972.4, vh: 1000 })).toBe(0);
    });
});

describe("landing", () => {
    it("has nothing to animate at the ledge", () => {
        expect(landing(0)).toBeNull();
    });

    it("falls from above, accelerating, then bounces one cell", () => {
        const l = landing(-120)!;
        expect(l.y).toEqual([-120, 0, -BOUNCE_PX, 0]);
        expect(l.ease[0]).toBe("easeIn");
        expect(l.duration).toBeGreaterThan(fallSeconds(120));
        // the fall takes its own share of the whole, and the bounce the rest
        expect(l.times[1]).toBeCloseTo(fallSeconds(120) / l.duration, 5);
    });

    it("hops up past a ledge that rose under it, then settles", () => {
        const l = landing(7)!;
        expect(l.y).toEqual([7, -BOUNCE_PX, 0]);
        expect(l.ease[0]).toBe("easeOut");
    });

    it("keys every segment in order, from the start to the end of the duration", () => {
        for (const l of [landing(-120)!, landing(7)!]) {
            expect(l.times[0]).toBe(0);
            expect(l.times[l.times.length - 1]).toBe(1);
            expect(l.times).toEqual([...l.times].sort((a, b) => a - b));
            expect(l.times).toHaveLength(l.y.length);
            expect(l.ease).toHaveLength(l.y.length - 1);
        }
    });
});
