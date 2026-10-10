// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Which digit hints show: Ctrl (Command on a Mac) held numbers the rail's surfaces for Ctrl+1..7, Alt (Option) the
// Active list's agents for Alt+1..9. A modifier only shows them once it has been held on its own for HINT_DELAY_MS, so
// a quick Ctrl+C or Ctrl+2 never flashes them; they stay through the digits until the key goes up, so a jump can be
// followed by another, and any other key (the C of a Ctrl+C, the Z of an Alt+Z, a second modifier) makes it a chord
// and hides them. cockpit-root.tsx feeds window key and blur events through nextDigitHint, and a "timer" event once
// the delay runs out.

import { isMacOS } from "@/util/platformutil";
import { atom, type PrimitiveAtom } from "jotai";

export type HintMod = "ctrl" | "alt";

// held: the modifier down on its own, its delay running until shown
export type DigitHintState = { held: HintMod | null; shown: boolean };

export const NO_DIGIT_HINT: DigitHintState = { held: null, shown: false };

export const HINT_DELAY_MS = 300;

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

// The hints digitHintAtom shows for a state.
export function shownDigitHint(st: DigitHintState): HintMod | null {
    return st.shown ? st.held : null;
}

export function nextDigitHint(st: DigitHintState, ev: HintEvent): DigitHintState {
    // blur: the key released while another window has focus sends this one no keyup
    if (ev.type === "blur") {
        return NO_DIGIT_HINT;
    }
    if (ev.type === "timer") {
        return st.held != null ? { held: st.held, shown: true } : st;
    }
    const mod = modOf(ev.key);
    if (ev.type === "keyup") {
        return mod != null && mod === st.held ? NO_DIGIT_HINT : st;
    }
    if (ev.type !== "keydown") {
        return st;
    }
    if (st.held == null) {
        // a modifier going down on its own starts the delay; one still repeating after a chord stays hidden
        return ev.repeat || mod == null ? st : { held: mod, shown: false };
    }
    if (mod === st.held) {
        return st; // the modifier repeating while held
    }
    // the digits leave shown hints up; one pressed before they show is a quick jump, and like any other key a chord
    return st.shown && isDigit(ev) ? st : NO_DIGIT_HINT;
}
