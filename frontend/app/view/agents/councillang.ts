// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The language of a council (councillang.test.ts). This is the TypeScript copy of pkg/council's LangOf (lang.go): Setup
// uses it to preview the seat and group names in the language the question will be held in, and Go reads the same
// question again at Start and stores the answer on the council. Both copies are tested on one table of cases.
// Pure, no React, no Wave runtime imports.

export type CouncilLang = "en" | "vi";

// the letters only Vietnamese writes: đ ă ơ ư, the circumflex vowels â ê ô, the tone-marked vowels of Latin-1 and Latin
// Extended-A (à á ã è é ì í ĩ ò ó õ ù ú ũ ý), and all of Latin Extended Additional (U+1EA0 to U+1EF9: ạ ả ấ ầ … ỹ)
const VI_LETTER = /[àáâãèéêìíĩòóôõùúũýăđơưẠ-ỹ]/;
// the same vowels decomposed: a base vowel, then grave, acute, circumflex, tilde, breve, hook above, horn or dot below
const VI_COMBINED = /[aeiouy][̛̣̀́̂̃̆̉]/;

/** Pure: "vi" when the text holds a letter only Vietnamese writes (đ, ă, â, ê, ô, ơ, ư, or a vowel with a Vietnamese
 *  tone mark), else "en". Vietnamese typed with no marks at all reads as English: nothing in it says otherwise. */
export function langOf(text: string): CouncilLang {
    const lower = text.toLowerCase();
    return VI_LETTER.test(lower) || VI_COMBINED.test(lower) ? "vi" : "en";
}
