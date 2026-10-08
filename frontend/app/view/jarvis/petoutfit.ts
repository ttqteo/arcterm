// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// What the pet wears in Vietnam's colours (petsprite.ts draws it). Pure: petview.tsx hands in the Settings choice and
// the clock.

import type { PetOutfit } from "./petsprite";

// Settings → Appearance (petstore.ts petOutfitChoiceAtom): the flag shirt, the flag in hand, or neither
export type PetOutfitChoice = "shirt" | "flag" | "off";

export const DEFAULT_PET_OUTFIT: PetOutfitChoice = "shirt";

// Reunification Day, Labour Day and National Day: dressed on these whatever the choice
const FLAG_DAYS: readonly [month: number, day: number][] = [
    [4, 30],
    [5, 1],
    [9, 2],
];

/** Whether `now` falls on a flag day, by the local calendar. */
export function isFlagDay(now: Date): boolean {
    return FLAG_DAYS.some(([month, day]) => now.getMonth() + 1 === month && now.getDate() === day);
}

/** A stored choice, or the default for anything that is not one of the three (a hand-edited value). */
export function petOutfitChoice(value: unknown): PetOutfitChoice {
    return value === "shirt" || value === "flag" || value === "off" ? value : DEFAULT_PET_OUTFIT;
}

/** What the pet wears: the choice, and the shirt on a flag day when the choice is off. */
export function petOutfit(choice: PetOutfitChoice, now: Date): PetOutfit | null {
    if (choice === "flag") {
        return "vn-flag";
    }
    return choice === "shirt" || isFlagDay(now) ? "vn-shirt" : null;
}
