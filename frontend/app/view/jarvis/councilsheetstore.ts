// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The council the Brief's sheet is open on (docs/superpowers/specs/2026-11-05-jarvis-revamp-design.md, decision 8). A
// council is no ActiveSubject, as a queue entry is not (briefqueuestore.ts): the sheet reads it from here. The sheet's
// three ways in close one another: opening a council clears the subject and the queue entry, opening a queue entry
// clears the council (openQueueSheet), and a subject that opens clears both (yieldToSubject, from briefsheet.tsx).

import { globalStore } from "@/app/store/jotaiStore";
import { atom, type PrimitiveAtom } from "jotai";
import { briefQueueSheetAtom } from "./briefqueuestore";
import { briefSheetOpenAtom } from "./jarvisstore";
import { clearSubject } from "./jarvissubjectstore";

export const councilSheetAtom = atom<string | null>(null) as PrimitiveAtom<string | null>;

/** Opens the Brief's sheet on a council's report. */
export function openCouncilSheet(councilId: string): void {
    clearSubject();
    globalStore.set(briefQueueSheetAtom, null);
    globalStore.set(councilSheetAtom, councilId);
    globalStore.set(briefSheetOpenAtom, true);
}

/** A subject opened in the sheet: the queue entry and the council it was drawing give way to it. */
export function yieldToSubject(): void {
    globalStore.set(briefQueueSheetAtom, null);
    globalStore.set(councilSheetAtom, null);
}
