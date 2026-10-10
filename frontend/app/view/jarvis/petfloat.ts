// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// What the float bar draws of the creature. Float mode hides the walking Sprout with the footer it walks on, which left
// a question or a review gate with nowhere to show while you worked in another app. The bar carries a still Sprout
// wearing the posture's mark, and nothing at all when nothing waits on you: the bar is the window's whole chrome then.
// Pure, like petcondition.ts; petfloatmark.tsx draws it.

import type { PetPosture } from "./petcondition";
import { spriteFor, type PetCharacter, type PetOutfit } from "./petsprite";
import { POSTURE_MARK } from "./petwalk";

export function floatMarkSprite(
    posture: PetPosture,
    outfit: PetOutfit | null,
    character: PetCharacter = "sprout"
): ReturnType<typeof spriteFor> | null {
    const mark = POSTURE_MARK[posture];
    return mark == null ? null : spriteFor("stand", [mark], outfit, character);
}
