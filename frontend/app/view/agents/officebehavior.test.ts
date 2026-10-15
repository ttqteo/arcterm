// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
    admitWalkers,
    afterHours,
    awayTarget,
    DEFAULT_HOURS,
    energyOf,
    idHash,
    isReset,
    lookOf,
    sanitizeHours,
    shortAge,
    yawnsNow,
} from "./officebehavior";

const NOW = 10_000_000;
const idle = (ago: number, finished = false) => ({ id: "a", state: "idle" as const, idleSince: NOW - ago, finished });

describe("officebehavior", () => {
    it("sends an idle agent past the Finished window to the coffee, and to the sofa after ten minutes", () => {
        expect(awayTarget(idle(2 * 60_000, true), NOW)).toBeUndefined();
        expect(awayTarget(idle(6 * 60_000, true), NOW)).toBeUndefined();
        expect(awayTarget(idle(4 * 60_000), NOW)).toBeUndefined();
        expect(awayTarget(idle(5 * 60_000), NOW)).toBe("coffee");
        expect(awayTarget(idle(10 * 60_000), NOW)).toBe("sofa");
        expect(awayTarget({ id: "w", state: "working", finished: false }, NOW)).toBeUndefined();
        expect(awayTarget({ id: "n", state: "idle", finished: false }, NOW)).toBeUndefined();
    });

    it("lets at most three walk at once, the longest idle first", () => {
        const waiting = [
            { id: "c", idleSince: 30 },
            { id: "a", idleSince: 10 },
            { id: "b", idleSince: 20 },
            { id: "d", idleSince: 40 },
        ];
        expect(admitWalkers(waiting, 0)).toEqual(["a", "b", "c"]);
        expect(admitWalkers(waiting, 2)).toEqual(["a"]);
        expect(admitWalkers(waiting, 3)).toEqual([]);
    });

    it("is after hours before the start, from the end, and all weekend", () => {
        // 2026-10-12 is a Monday, 2026-10-17 a Saturday
        expect(afterHours(new Date(2026, 9, 12, 8, 59), DEFAULT_HOURS)).toBe(true);
        expect(afterHours(new Date(2026, 9, 12, 9, 0), DEFAULT_HOURS)).toBe(false);
        expect(afterHours(new Date(2026, 9, 12, 17, 59), DEFAULT_HOURS)).toBe(false);
        expect(afterHours(new Date(2026, 9, 12, 18, 0), DEFAULT_HOURS)).toBe(true);
        expect(afterHours(new Date(2026, 9, 17, 12, 0), DEFAULT_HOURS)).toBe(true);
    });

    it("reads stored hours back, falling back to 9 to 18 on anything odd", () => {
        expect(sanitizeHours({ start: 8, end: 17 })).toEqual({ start: 8, end: 17 });
        expect(sanitizeHours({ start: 18, end: 9 })).toEqual(DEFAULT_HOURS);
        expect(sanitizeHours({ start: "9", end: "18" })).toEqual(DEFAULT_HOURS);
        expect(sanitizeHours({ start: -1, end: 24 })).toEqual(DEFAULT_HOURS);
        expect(sanitizeHours(null)).toEqual(DEFAULT_HOURS);
        expect(sanitizeHours("garbage")).toEqual(DEFAULT_HOURS);
    });

    it("turns the 5-hour window into tiredness", () => {
        expect(energyOf(undefined)).toBe("fresh");
        expect(energyOf(69.9)).toBe("fresh");
        expect(energyOf(70)).toBe("yawny");
        expect(energyOf(89.9)).toBe("yawny");
        expect(energyOf(90)).toBe("tired");
    });

    it("yawns one frame in eight when yawny, one in four when tired, never when fresh", () => {
        const count = (e: "fresh" | "yawny" | "tired") =>
            Array.from({ length: 8 }, (_, t) => yawnsNow("loom", t, e)).filter(Boolean).length;
        expect(count("fresh")).toBe(0);
        expect(count("yawny")).toBe(1);
        expect(count("tired")).toBe(2);
    });

    it("sees a reset from 70 % or more to under 20 %", () => {
        expect(isReset(75, 5)).toBe(true);
        expect(isReset(65, 5)).toBe(false);
        expect(isReset(75, 25)).toBe(false);
        expect(isReset(undefined, 5)).toBe(false);
    });

    it("keeps an agent's look and hash", () => {
        expect(idHash("loom")).toBe(idHash("loom"));
        for (const id of ["a", "b", "loom", "quill", "fx-office-scratch"]) {
            expect(lookOf(id)).toBeGreaterThanOrEqual(1);
            expect(lookOf(id)).toBeLessThanOrEqual(4);
        }
    });

    it("says an age in minutes under an hour, else in hours", () => {
        expect(shortAge(10_000)).toBe("1m");
        expect(shortAge(14 * 60_000)).toBe("14m");
        expect(shortAge(130 * 60_000)).toBe("2h");
    });
});
