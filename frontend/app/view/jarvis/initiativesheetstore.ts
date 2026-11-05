// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The initiative in the Brief's sheet (docs/superpowers/specs/2026-11-05-jarvis-revamp-design.md, decision 7): what
// its body shows. The sheet's subject is the effort (the active subject, briefsheetmodel.ts face `effort`); this holds
// the rest — the plan or the Activity feed, the chunk open inside it (decision 9), the plan's chunk cursor — reset
// whenever the sheet opens an initiative, so a chunk or a feed left open on one never shows on the next.
//
// Module atoms because the Brief unmounts on a surface switch and the keys (bindings.ts) read them through
// globalStore: initiativeSheetOpenAtom and chunkViewOpenAtom are the when() predicates' atoms (whenstate.ts).

import { globalStore } from "@/app/store/jotaiStore";
import { atom, type PrimitiveAtom } from "jotai";
import { briefQueueSheetAtom } from "./briefqueuestore";
import { councilSheetAtom } from "./councilsheetstore";
import { briefSheetOpenAtom } from "./jarvisstore";
import { activeSubjectAtom, selectSubject } from "./jarvissubjectstore";

export type InitiativeSheetView = "plan" | "activity";

// `chunk` is the label of the chunk open in the sheet (chunkview.tsx draws it over the plan), null on the plan
export type InitiativeSheetState = { view: InitiativeSheetView; chunk: string | null };

const PLAN: InitiativeSheetState = { view: "plan", chunk: null };

export const initiativeSheetAtom = atom<InitiativeSheetState>(PLAN) as PrimitiveAtom<InitiativeSheetState>;

// Notes only, in the chunk view: per viewer and NOT reset with the sheet, so it holds across chunks and initiatives
// for the session (spec decision 9)
export const chunkNotesOnlyAtom = atom(false) as PrimitiveAtom<boolean>;

// the plan's chunk cursor, by label: j/k move it, Enter opens it, Alt+↑/↓ move its chunk. Reset with the sheet.
export const initiativeCursorAtom = atom<string | null>(null) as PrimitiveAtom<string | null>;

// the stages the person folded or unfolded in the sheet, by row id (inlinetracker.ts stageRowId); an override beats
// the stage's starting state. Kept across opens, as the Brief's in-place tracker keeps its own.
export const sheetStageOverridesAtom = atom<Record<string, boolean>>({}) as PrimitiveAtom<Record<string, boolean>>;

// Alt+↑/↓ in the sheet's plan view: the plan view publishes the move for the chunk under its cursor. Its own atom
// rather than the Brief's chunkMoveAtom, which the Brief clears whenever its own cursor leaves a chunk.
export const sheetChunkMoveAtom = atom<((dir: "up" | "down") => void) | null>(null) as PrimitiveAtom<
    ((dir: "up" | "down") => void) | null
>;

// The sheet is drawing an initiative: the face briefsheetmodel.ts sheetFace picks, a council and a queue entry
// winning over the subject as they do there.
export const initiativeSheetOpenAtom = atom(
    (get) =>
        get(briefSheetOpenAtom) &&
        get(councilSheetAtom) == null &&
        get(briefQueueSheetAtom) == null &&
        get(activeSubjectAtom)?.kind === "effort"
);

// ...with a chunk open in its body (decision 9): the chunk view's keys (s, 1–6, Esc back) hold only then
export const chunkViewOpenAtom = atom(
    (get) =>
        get(initiativeSheetOpenAtom) &&
        get(initiativeSheetAtom).view === "plan" &&
        get(initiativeSheetAtom).chunk != null
);

/**
 * Opens the Brief's sheet on an initiative, on its plan (or its Activity feed, or one of its chunks). Every way in
 * goes through here — openref.ts selectEffort, openInitiativeChunk, the sheet's own Previous/Next — so each one
 * starts the body fresh.
 */
export function openInitiativeSheet(
    effortId: string,
    opts: { view?: InitiativeSheetView; chunk?: string | null } = {}
): void {
    const oid = effortId.replace(/^effort:/, "");
    selectSubject({ kind: "effort", id: oid });
    globalStore.set(initiativeSheetAtom, { view: opts.view ?? "plan", chunk: opts.chunk ?? null });
    globalStore.set(initiativeCursorAtom, opts.chunk ?? null);
    globalStore.set(briefSheetOpenAtom, true);
}

/**
 * Opens the initiative in the sheet on one of its chunks: the run sheet's ↳ reaches it through briefRevealChunkAtom,
 * which the Brief publishes. Selecting the subject warms the detail (jarvissubjectstore.ts selectSubject).
 */
export function openInitiativeChunk(oref: string, chunk: string): void {
    openInitiativeSheet(oref, { chunk });
}

// the sheet's body back to the plan, the cursor left on the chunk it came from
export function backToPlan(): void {
    const cur = globalStore.get(initiativeSheetAtom);
    if (cur.chunk != null) {
        globalStore.set(initiativeCursorAtom, cur.chunk);
    }
    globalStore.set(initiativeSheetAtom, PLAN);
}

export function showInitiativeActivity(): void {
    globalStore.set(initiativeSheetAtom, { view: "activity", chunk: null });
}

export function openSheetChunk(chunk: string): void {
    globalStore.set(initiativeCursorAtom, chunk);
    globalStore.set(initiativeSheetAtom, { view: "plan", chunk });
}
