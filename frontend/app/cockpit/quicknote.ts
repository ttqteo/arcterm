// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// A new note in one press, from the rail's Note button or Mod+Shift+N: the search palette opens straight into its note
// editor, on the Notes scope, with the caret in the title. The palette reads and clears the flag as it opens
// (command-palette.tsx), as it does paletteSeedAtom; leaving the editor lands on the Notes list, as from its own
// "New note" row.

import { globalStore } from "@/app/store/jotaiStore";
import { atom, type PrimitiveAtom } from "jotai";

export const paletteNewNoteAtom = atom(false) as PrimitiveAtom<boolean>;

export function openNewNote(model: { paletteOpenAtom: PrimitiveAtom<boolean> }): void {
    globalStore.set(paletteNewNoteAtom, true);
    globalStore.set(model.paletteOpenAtom, true);
}

// The Notes list, from the Open on Chat's "Added to Notes" toast: it lists newest first with an empty query, so the note
// just added is the selected row and its preview shows.
export const paletteNotesListAtom = atom(false) as PrimitiveAtom<boolean>;

export function openNotesList(model: { paletteOpenAtom: PrimitiveAtom<boolean> }): void {
    globalStore.set(paletteNotesListAtom, true);
    globalStore.set(model.paletteOpenAtom, true);
}
