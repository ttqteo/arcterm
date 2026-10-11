// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The tour's state. Module atoms because the dispatcher reads tourAtom to stand the Jarvis keys down while a tour
// shows (keybindings/dispatcher.ts), and the language outlives the surface.

import { atom, type PrimitiveAtom } from "jotai";
import { atomWithStorage } from "jotai/utils";
import type { TourLang, TourState } from "./jarvistour";

export const tourAtom = atom<TourState | null>(null) as PrimitiveAtom<TourState | null>;

export const tourLangAtom = atomWithStorage<TourLang>("jarvis.tour.lang", "vi", undefined, { getOnInit: true });
