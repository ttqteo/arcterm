// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The tour's state. Module atoms because the dispatcher reads tourAtom to stand the Jarvis keys down while a tour
// shows (keybindings/dispatcher.ts), and the language outlives the surface.

import { atom, type PrimitiveAtom } from "jotai";
import { atomWithStorage } from "jotai/utils";
import type { TourLang, TourState } from "./jarvistour";

export const tourAtom = atom<TourState | null>(null) as PrimitiveAtom<TourState | null>;

// The header ? menu's open state. Its Escape belongs to the menu, not to the surface behind it, so the dispatcher
// counts it as modalOpen (keybindings/dispatcher.ts) and useDismiss's document listener gets the key.
export const tourMenuOpenAtom = atom(false);

export const tourLangAtom = atomWithStorage<TourLang>("jarvis.tour.lang", "vi", undefined, { getOnInit: true });
