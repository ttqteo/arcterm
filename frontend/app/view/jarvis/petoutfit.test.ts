// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { DEFAULT_PET_OUTFIT, isFlagDay, petOutfit, petOutfitChoice } from "./petoutfit";

// local dates: the day the user's own calendar shows
const on = (month: number, day: number, hour = 12) => new Date(2026, month - 1, day, hour);
const ordinary = on(10, 8);

describe("isFlagDay", () => {
    it.each([
        [4, 30],
        [5, 1],
        [9, 2],
    ])("is a flag day on %i/%i, from the first minute to the last", (month, day) => {
        expect(isFlagDay(on(month, day, 0))).toBe(true);
        expect(isFlagDay(new Date(2026, month - 1, day, 23, 59))).toBe(true);
    });

    it("is not the days either side", () => {
        expect(isFlagDay(on(4, 29))).toBe(false);
        expect(isFlagDay(on(5, 2))).toBe(false);
        expect(isFlagDay(on(9, 1))).toBe(false);
        expect(isFlagDay(on(9, 3))).toBe(false);
    });

    it("comes back every year", () => {
        expect(isFlagDay(new Date(2031, 8, 2, 9))).toBe(true);
    });
});

describe("petOutfit", () => {
    it("wears the shirt by default", () => {
        expect(DEFAULT_PET_OUTFIT).toBe("shirt");
        expect(petOutfit(DEFAULT_PET_OUTFIT, ordinary)).toBe("vn-shirt");
    });

    it("holds the flag when that is the choice, flag days included", () => {
        expect(petOutfit("flag", ordinary)).toBe("vn-flag");
        expect(petOutfit("flag", on(9, 2))).toBe("vn-flag");
    });

    it("wears nothing on an ordinary day when it is off", () => {
        expect(petOutfit("off", ordinary)).toBeNull();
    });

    it("wears the shirt on a flag day even when it is off", () => {
        expect(petOutfit("off", on(4, 30))).toBe("vn-shirt");
    });
});

describe("petOutfitChoice", () => {
    it("keeps each of the three choices", () => {
        for (const c of ["shirt", "flag", "off"] as const) {
            expect(petOutfitChoice(c)).toBe(c);
        }
    });

    // a hand-edited or older stored value is not a choice anyone made
    it("reads anything else as the default", () => {
        for (const v of [undefined, null, "", "hat", 1, true]) {
            expect(petOutfitChoice(v)).toBe(DEFAULT_PET_OUTFIT);
        }
    });
});
