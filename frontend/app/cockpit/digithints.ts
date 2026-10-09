// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Which digit hints show: Ctrl (Command on a Mac) held numbers the rail's surfaces for Ctrl+1..7, Alt (Option) the
// Active list's agents for Alt+1..9. A modifier shows them the moment it goes down on its own; they stay through the
// digits until the key goes up, so a jump can be followed by another, and any other key (the C of a Ctrl+C, the Z of
// an Alt+Z, a second modifier) makes it a chord and hides them. cockpit-root.tsx feeds window key and blur events
// through nextDigitHint.

import { isMacOS } from "@/util/platformutil";
import { atom, type PrimitiveAtom } from "jotai";

export type HintMod = "ctrl" | "alt";

export type DigitHintState = HintMod | null;

export const NO_DIGIT_HINT: DigitHintState = null;

export const digitHintAtom = atom<HintMod | null>(null) as PrimitiveAtom<HintMod | null>;

export type HintEvent = { type: string; key?: string; code?: string; repeat?: boolean };

function modOf(key: string | undefined): HintMod | null {
    if (key === "Alt") {
        return "alt";
    }
    return key === (isMacOS() ? "Meta" : "Control") ? "ctrl" : null;
}

// by code too: Option+digit on a Mac types a symbol ("¡", "™"), not the digit
function isDigit(ev: HintEvent): boolean {
    return /^(Digit|Numpad)\d$/.test(ev.code ?? "") || /^\d$/.test(ev.key ?? "");
}

export function nextDigitHint(st: DigitHintState, ev: HintEvent): DigitHintState {
    // blur: the key released while another window has focus sends this one no keyup
    if (ev.type === "blur") {
        return NO_DIGIT_HINT;
    }
    const mod = modOf(ev.key);
    if (ev.type === "keyup") {
        return mod != null && mod === st ? NO_DIGIT_HINT : st;
    }
    if (ev.type !== "keydown") {
        return st;
    }
    if (st == null) {
        // a modifier going down on its own shows its hints at once; one still repeating after a chord stays hidden
        return ev.repeat ? st : mod;
    }
    // the digits, and the modifier repeating while held, leave them up; any other key makes it a chord
    return mod === st || isDigit(ev) ? st : NO_DIGIT_HINT;
}
