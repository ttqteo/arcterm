// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// The float ledge's pinned tabs (localStorage float.tabpins): the keys of the tabs the person pinned, in the order they
// were pinned. A per-viewer convenience: lost storage only unpins. The pure parts are in sproutroster.ts.

import { globalStore } from "@/app/store/jotaiStore";
import { atom } from "jotai";
import { parseTabPins, withTabPin, type FloatTab } from "./sproutroster";

const PINS_KEY = "float.tabpins";

function readPins(): string[] {
    try {
        return parseTabPins(localStorage.getItem(PINS_KEY));
    } catch {
        return [];
    }
}

const pinsBaseAtom = atom<string[]>(readPins());

export const floatTabPinsAtom = atom(
    (get) => get(pinsBaseAtom),
    (_get, set, next: string[]) => {
        set(pinsBaseAtom, next);
        try {
            localStorage.setItem(PINS_KEY, JSON.stringify(next));
        } catch {
            // storage unavailable: the pins hold for this session
        }
    }
);

/** Pins or unpins a tab; `live` is every tab the ledge has now, so a pin whose agent closed drops off. */
export function setTabPinned(key: string, on: boolean, live: readonly FloatTab[]): void {
    globalStore.set(floatTabPinsAtom, withTabPin(globalStore.get(floatTabPinsAtom), key, on, live));
}
