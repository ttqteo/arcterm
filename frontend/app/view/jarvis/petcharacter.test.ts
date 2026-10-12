// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { DEFAULT_PET_CHARACTER, PET_CHARACTER_NAME, petCharacter } from "./petcharacter";

describe("petCharacter", () => {
    it("is Sprout until another is chosen", () => {
        expect(DEFAULT_PET_CHARACTER).toBe("sprout");
    });

    it.each(["sprout", "minion", "spidey"] as const)("keeps a stored %s", (value) => {
        expect(petCharacter(value)).toBe(value);
    });

    // a hand-edited value, or one a later build no longer draws
    it.each([undefined, null, "", "Minion", "Spider-Man", "clawd", 1])("falls back to Sprout for %s", (value) => {
        expect(petCharacter(value)).toBe("sprout");
    });
});

describe("PET_CHARACTER_NAME", () => {
    // what a label calls the creature, as in "Minimize to Minion"
    it("names each character the way Settings does", () => {
        expect(PET_CHARACTER_NAME).toEqual({ sprout: "Sprout", minion: "Minion", spidey: "Spider-Man" });
    });
});
