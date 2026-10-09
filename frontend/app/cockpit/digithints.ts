// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Which digit hints show: Ctrl (Command on a Mac) held numbers the rail's surfaces for Ctrl+1..7, Alt (Option) the
// Active list's agents for Alt+1..9. A modifier only shows them once it has been held on its own for HINT_DELAY_MS, so
// the Ctrl of a Ctrl+C or an Alt+Z never flashes them; once shown they stay until the key goes up, so a jump can be
// followed by another. cockpit-root.tsx feeds window key and blur events through nextDigitHint, and a "timer" event
// once the delay runs out.

import { isMacOS } from "@/util/platformutil";
import { atom, type PrimitiveAtom } from "jotai";

export type HintMod = "ctrl" | "alt";

export type DigitHintState = { armed: HintMod | null; shown: HintMod | null };

export const NO_DIGIT_HINT: DigitHintState = { armed: null, shown: null };

export const HINT_DELAY_MS = 300;

export const digitHintAtom = atom<HintMod | null>(null) as PrimitiveAtom<HintMod | null>;

export type HintEvent = { type: string; key?: string };

function modOf(key: string | undefined): HintMod | null {
    if (key === "Alt") {
        return "alt";
    }
    return key === (isMacOS() ? "Meta" : "Control") ? "ctrl" : null;
}

export function nextDigitHint(st: DigitHintState, ev: HintEvent): DigitHintState {
    // blur: the key released while another window has focus sends this one no keyup
    if (ev.type === "blur") {
        return NO_DIGIT_HINT;
    }
    if (ev.type === "timer") {
        return st.armed != null ? { armed: null, shown: st.armed } : st;
    }
    const mod = modOf(ev.key);
    if (ev.type === "keyup") {
        return mod != null && (mod === st.armed || mod === st.shown) ? NO_DIGIT_HINT : st;
    }
    if (ev.type !== "keydown") {
        return st;
    }
    if (st.shown != null) {
        return st; // the digits, and any other key, leave shown hints up
    }
    if (mod != null && st.armed == null) {
        return { armed: mod, shown: null };
    }
    // a key repeating while it is held keeps it armed; any other key makes it a chord, not a look
    return mod != null && mod === st.armed ? st : NO_DIGIT_HINT;
}
