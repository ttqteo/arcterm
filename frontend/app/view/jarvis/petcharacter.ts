// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Which creature Jarvis is drawn as (petsprite.ts draws both). Pure: the renderers read the Settings choice through
// petCharacter.

import type { PetCharacter } from "./petsprite";

// Settings → Appearance (petstore.ts petCharacterAtom)
export const DEFAULT_PET_CHARACTER: PetCharacter = "sprout";

// What a label calls each one ("Minimize to Minion"), and what Settings offers
export const PET_CHARACTER_NAME: Record<PetCharacter, string> = { sprout: "Sprout", minion: "Minion" };

/** A stored choice, or Sprout for anything that is not one of the two (a hand-edited value). */
export function petCharacter(value: unknown): PetCharacter {
    return value === "sprout" || value === "minion" ? value : DEFAULT_PET_CHARACTER;
}
