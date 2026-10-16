// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The queue entry the Brief's sheet is open on. A queue entry is not an ActiveSubject (it would reach the subject
// store, restore and the palette), so the sheet reads it from here; opening any subject clears it (briefsheet.tsx).

import { globalStore } from "@/app/store/jotaiStore";
import { atom, type PrimitiveAtom } from "jotai";
import { briefSheetOpenAtom } from "./jarvisstore";
import { clearSubject } from "./jarvissubjectstore";

export const briefQueueSheetAtom = atom<string | null>(null) as PrimitiveAtom<string | null>;

export function openQueueSheet(entryId: string): void {
    clearSubject();
    globalStore.set(briefQueueSheetAtom, entryId);
    globalStore.set(briefSheetOpenAtom, true);
}
