// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { beforeEach, describe, expect, it } from "vitest";
import {
    ENTRANCE_COOLDOWN_MS,
    entranceLength,
    entrancePhase,
    markOfficeLeft,
    nearestWindow,
    resetOfficeLeft,
    shouldPlayEntrance,
    swingPoint,
} from "./officeentrance";
import { TELEPORT_MS } from "@/app/view/jarvis/petteleport";

beforeEach(() => resetOfficeLeft());

describe("shouldPlayEntrance", () => {
    it("plays the first time the office opens", () => {
        expect(shouldPlayEntrance(10_000, false)).toBe(true);
    });

    it("skips it within two minutes of leaving, and plays it after", () => {
        markOfficeLeft(10_000);
        expect(shouldPlayEntrance(10_000 + ENTRANCE_COOLDOWN_MS - 1, false)).toBe(false);
        expect(shouldPlayEntrance(10_000 + ENTRANCE_COOLDOWN_MS, false)).toBe(true);
    });

    it("never plays under reduced motion", () => {
        expect(shouldPlayEntrance(10_000, true)).toBe(false);
    });
});

describe("entrancePhase", () => {
    it("walks Spider-Man through the canvas's six frames", () => {
        expect(entrancePhase("spidey", 0)).toBe("swing");
        expect(entrancePhase("spidey", 699)).toBe("swing");
        expect(entrancePhase("spidey", 700)).toBe("land");
        expect(entrancePhase("spidey", 1000)).toBe("stand");
        expect(entrancePhase("spidey", 1300)).toBe("unmask");
        expect(entrancePhase("spidey", 1800)).toBe("puff");
        expect(entrancePhase("spidey", 2200)).toBe("done");
    });

    it("gives Sprout and the Minion the teleport's arrival", () => {
        expect(entrancePhase("sprout", 0)).toBe("beam");
        expect(entrancePhase("minion", TELEPORT_MS.arrive - 1)).toBe("beam");
        expect(entrancePhase("minion", TELEPORT_MS.arrive)).toBe("done");
    });

    it("lasts as long as its phases", () => {
        expect(entranceLength("spidey")).toBe(2200);
        expect(entranceLength("sprout")).toBe(TELEPORT_MS.arrive);
    });
});

describe("swingPoint", () => {
    const from = { x: 99, y: 0 };
    const to = { x: 300, y: 240 };

    it("starts at the window and lands on the spot", () => {
        expect(swingPoint(from, to, 0)).toEqual(from);
        expect(swingPoint(from, to, 1)).toEqual(to);
    });

    it("dips below the straight line on the way, as a swing does", () => {
        const mid = swingPoint(from, to, 0.5);
        expect(mid.y).toBeGreaterThan((from.y + to.y) / 2);
    });

    it("moves in whole 3 px cells", () => {
        const p = swingPoint(from, to, 0.37);
        expect(p.x % 3).toBe(0);
        expect(p.y % 3).toBe(0);
    });
});

describe("nearestWindow", () => {
    it("picks the window nearest the spot along the wall", () => {
        const ws = [{ x: 60, y: 10 }, { x: 190, y: 10 }, { x: 320, y: 10 }];
        expect(nearestWindow(ws, { x: 250, y: 300 })).toEqual({ x: 190, y: 10 });
    });

    it("is null with no window", () => {
        expect(nearestWindow([], { x: 0, y: 0 })).toBeNull();
    });
});
