// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Quick translate's state (docs/superpowers/specs/2026-10-29-rail-translate-design.md): whether the panel is up, the
// input, the last answer, the error line and the language pair, with the debounce and the ordering of replies. Module-
// level atoms: the rail's panel unmounts when it closes and every surface but Agent unmounts on a switch, and the text
// must outlive both (it does not outlive the launch; the pair does, in localStorage). The pure parts are
// translatemodel.ts; the engine is translateengine.ts. Float shows the same panel on its own, and the lines at the end
// keep the two variants and the Note tab from showing together.

import { globalStore } from "@/app/store/jotaiStore";
import { atom, type PrimitiveAtom } from "jotai";
import { closeFloatNote, floatNoteOpenAtom } from "./floatnotestore";
import { floatModeAtom } from "./floatstore";
import { translate } from "./translateengine";
import {
    isCurrent,
    PAIR_KEY,
    parsePair,
    requestFor,
    swap,
    TRANSLATE_DEBOUNCE_MS,
    translateErrorLine,
    type Pair,
    type SwapState,
    type TranslateResult,
} from "./translatemodel";

/** The pair out of localStorage, the default when storage is unavailable or holds nothing usable. */
export function readStoredPair(): Pair {
    try {
        return parsePair(localStorage.getItem(PAIR_KEY));
    } catch {
        return parsePair(null);
    }
}

// whether the rail's panel is up
export const translateOpenAtom = atom(false) as PrimitiveAtom<boolean>;
// the input box's text
export const translateTextAtom = atom("") as PrimitiveAtom<string>;
// the last answer for the text; null before one, after a clear, a blank input, a failure or a swap
export const translateResultAtom = atom<TranslateResult | null>(null) as PrimitiveAtom<TranslateResult | null>;
// the line shown in the translation's place after a failed request; the next answer clears it
export const translateErrorAtom = atom<string | null>(null) as PrimitiveAtom<string | null>;

const pairBaseAtom = atom<Pair>(readStoredPair());

// writing it remembers the pair for the next launch
export const translatePairAtom = atom(
    (get) => get(pairBaseAtom),
    (_get, set, next: Pair) => {
        set(pairBaseAtom, next);
        try {
            localStorage.setItem(PAIR_KEY, JSON.stringify(next));
        } catch {
            // storage unavailable: the pair holds for this session
        }
    }
);

// ---- requests ----

let timer: ReturnType<typeof setTimeout> | null = null;
// counts requests, clears and blank inputs; a reply for any other number is dropped (translatemodel.isCurrent)
let latest = 0;

function stopTimer(): void {
    if (timer != null) {
        clearTimeout(timer);
        timer = null;
    }
}

// Translates the text as it stands now. A blank text sends nothing and drops every reply still out.
function send(): void {
    stopTimer();
    const seq = ++latest;
    const req = requestFor(globalStore.get(translateTextAtom), globalStore.get(translatePairAtom));
    if (req == null) {
        globalStore.set(translateResultAtom, null);
        globalStore.set(translateErrorAtom, null);
        return;
    }
    translate(req).then(
        (result) => {
            if (isCurrent(seq, latest)) {
                globalStore.set(translateResultAtom, result);
                globalStore.set(translateErrorAtom, null);
            }
        },
        (err) => {
            if (isCurrent(seq, latest)) {
                // the text stays; the answer for it is gone, so a swap never moves an older one into the input
                globalStore.set(translateResultAtom, null);
                globalStore.set(translateErrorAtom, translateErrorLine(err));
            }
        }
    );
}

/** A keystroke in the input: shows at once and translates TRANSLATE_DEBOUNCE_MS after the last one; blank text clears. */
export function setTranslateText(text: string): void {
    globalStore.set(translateTextAtom, text);
    if (text.trim() === "") {
        send();
        return;
    }
    stopTimer();
    timer = setTimeout(send, TRANSLATE_DEBOUNCE_MS);
}

/** The × button: empties the input and the translation, and drops any reply still out. */
export function clearTranslate(): void {
    globalStore.set(translateTextAtom, "");
    send();
}

/** A new pair, remembered, and the current text translated into it at once. */
export function setPair(next: Pair): void {
    globalStore.set(translatePairAtom, next);
    send();
}

/** The ⇄ button (translatemodel.swap): the pair flips and the translation becomes the input, translated back at once.
 *  From Detect language with nothing detected it does nothing. */
export function swapTranslate(): void {
    const before: SwapState = {
        pair: globalStore.get(translatePairAtom),
        input: globalStore.get(translateTextAtom),
        result: globalStore.get(translateResultAtom),
    };
    const after = swap(before);
    if (after === before) {
        return;
    }
    globalStore.set(translatePairAtom, after.pair);
    globalStore.set(translateTextAtom, after.input);
    globalStore.set(translateResultAtom, after.result);
    send();
}

// ---- the panel ----

export function openTranslate(): void {
    globalStore.set(translateOpenAtom, true);
}

export function closeTranslate(): void {
    globalStore.set(translateOpenAtom, false);
}

/** The `translate` binding, the rail's button and Float's Translate tab. */
export function toggleTranslate(): void {
    globalStore.set(translateOpenAtom, !globalStore.get(translateOpenAtom));
}

// ---- Float ----

// One open flag serves the rail's panel (drawn only outside Float, cockpitshell.tsx) and Float's (drawn only in it,
// cockpit-root.tsx), so a flag left set across a switch would bring the other variant up over the new view: entering or
// leaving Float closes the panel. In Float the panel and the Note tab's body cover the same terminal area, so opening
// either one closes the other.
globalStore.sub(floatModeAtom, closeTranslate);
globalStore.sub(translateOpenAtom, () => {
    if (globalStore.get(translateOpenAtom) && globalStore.get(floatNoteOpenAtom)) {
        closeFloatNote();
    }
});
globalStore.sub(floatNoteOpenAtom, () => {
    if (globalStore.get(floatNoteOpenAtom)) {
        closeTranslate();
    }
});
