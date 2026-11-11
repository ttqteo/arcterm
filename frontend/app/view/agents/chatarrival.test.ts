// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { ARRIVAL_CAP_PX, arrivalFrom, tailArrivals } from "./chatarrival";

describe("tailArrivals", () => {
    it("is the keys appended after the ones already drawn", () => {
        expect([...tailArrivals(["a", "b"], ["a", "b", "c", "d"])]).toEqual(["c", "d"]);
        expect([...tailArrivals(["a", "b"], ["a", "b"])]).toEqual([]);
    });

    it("draws the first load whole: nothing arrives into an empty list", () => {
        expect([...tailArrivals([], ["a", "b", "c"])]).toEqual([]);
    });

    it("does not animate items drawn in front (Show earlier, a restored place), only the tail that follows", () => {
        expect([...tailArrivals(["c", "d"], ["a", "b", "c", "d"])]).toEqual([]);
        expect([...tailArrivals(["c", "d"], ["a", "b", "c", "d", "e"])]).toEqual(["e"]);
    });

    it("is empty when none of the drawn keys remain (another conversation)", () => {
        expect([...tailArrivals(["a", "b"], ["x", "y"])]).toEqual([]);
    });

    it("does not count a key new between kept ones", () => {
        expect([...tailArrivals(["a", "c"], ["a", "b", "c"])]).toEqual([]);
    });
});

describe("arrivalFrom", () => {
    it("opens a short row from nothing", () => {
        expect(arrivalFrom(0)).toBeNull();
        expect(arrivalFrom(ARRIVAL_CAP_PX)).toBeNull();
    });

    it("opens a tall row only over its last ARRIVAL_CAP_PX", () => {
        expect(ARRIVAL_CAP_PX).toBe(320);
        expect(arrivalFrom(900)).toBe(580);
        expect(arrivalFrom(320.6)).toBe(1);
    });
});
