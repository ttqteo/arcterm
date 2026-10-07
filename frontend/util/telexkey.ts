// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// A Vietnamese input method that hooks the keyboard (EVKey, Unikey) rewrites keys before the app sees them, whether or
// not a text field has focus: with Telex on, the second `d` of `dd` arrives as a Backspace and then "đ", a `w` as "ư",
// `a` then `s` as "á". Outside a field those letters are shortcuts, so the dispatcher reads such a character back as
// the key that made it. Pure.

// the Telex key each combining mark comes from: the five tones, and the shapes a key adds to a vowel
const TONE_KEY: Record<string, string> = {
    "́": "s", // sắc
    "̀": "f", // huyền
    "̉": "r", // hỏi
    "̃": "x", // ngã
    "̣": "j", // nặng
};
const BREVE_OR_HORN = new Set(["̆", "̛"]); // ă, ơ ư: typed with w
const CIRCUMFLEX = "̂"; // â ê ô: typed by doubling the vowel

/** Pure: the key a Telex input method turned into `ch`, the last one pressed: "đ" -> "d", "ư" -> "w", "â" -> "a", and a
 *  toned vowel its tone's key ("á" -> "s"). A vowel with a tone and a shape ("ấ") reads as its tone, the usual order.
 *  Upper case stays upper, as Shift made it. null for anything that is not a Vietnamese letter. */
export function telexBaseKey(ch: string): string | null {
    if (ch.length !== 1) {
        return null;
    }
    const lower = ch.toLowerCase();
    const upper = ch !== lower;
    let key: string | null = null;
    if (lower === "đ") {
        key = "d";
    } else {
        const [base, ...marks] = lower.normalize("NFD");
        // only a Vietnamese vowel takes a tone or a shape, so ñ or ç is not misread as x or nothing
        if (marks.length === 0 || !"aeiouy".includes(base)) {
            return null;
        }
        const tone = marks.find((m) => TONE_KEY[m] != null);
        if (tone != null) {
            key = TONE_KEY[tone];
        } else if (marks.some((m) => BREVE_OR_HORN.has(m))) {
            key = "w";
        } else if (marks.includes(CIRCUMFLEX)) {
            key = base;
        }
    }
    return key != null && upper ? key.toUpperCase() : key;
}
