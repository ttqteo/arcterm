// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Jarvis surface state. The surface UNMOUNTS on nav-switch (only the agent surface stays mounted), so
// every survive-worthy value lives here as a module atom, never component useState.

import { atom, type PrimitiveAtom } from "jotai";
import type { EffortIndex } from "./briefrows";

// The record the Brief's peek is open on, or null. Module-level rather than surface state because the
// Jarvis surface unmounts when you navigate away from it, and a peek opened from an oref must survive the
// surface flip that oref triggers.
export const briefPeekRecordAtom = atom<string | null>(null) as PrimitiveAtom<string | null>;

// The project the Profile window (run defaults) is open on: null closed, "" on the window's own first pick.
// Module-level for the peek's reason: the palette opens it on a project across the surface flip to Jarvis.
export const briefProfileAtom = atom<string | null>(null) as PrimitiveAtom<string | null>;

// Whether the Brief's detail sheet is showing. The subject it draws is the surface's active subject, not a
// second copy of it here: keeping the target in two atoms is how a sheet and the thing it claims to show
// end up naming different objects. Session-scoped, because the subject is what is persisted and a closed
// sheet clears it — so what reopens on the next launch is the subject that was left open, not this flag.
export const briefSheetOpenAtom = atom(false);

// The one open plan-editing menu (a chunk's status menu or a stage's actions), by row id. Here rather than inside
// the view because it is the innermost Escape layer, and the dispatcher runs on window capture ahead of any
// listener the menu could register itself.
export const trackerMenuAtom = atom<string | null>(null) as PrimitiveAtom<string | null>;

// Alt+↑/↓ moves the chunk under a page's chunk cursor, published by the view holding the plan. Nothing on the Brief
// publishes it since initiatives left the page for the sheet (sheetChunkMoveAtom is the sheet's); the bindings still
// read it so a page-side plan can publish again.
export const chunkMoveAtom = atom<((dir: "up" | "down") => void) | null>(null) as PrimitiveAtom<
    ((dir: "up" | "down") => void) | null
>;

// The run sheet's ↳ chunk line opens that chunk's initiative in the Brief's sheet, on the chunk. The Brief publishes
// initiativesheetstore.ts openInitiativeChunk here while it is mounted.
export const briefRevealChunkAtom = atom<((effortOref: string, chunk: string) => void) | null>(null) as PrimitiveAtom<
    ((effortOref: string, chunk: string) => void) | null
>;

// The initiative under the Brief's page cursor (a card, a list row or an idea) and its Work on: what `p` pins and `w`
// works on while no sheet is open. The Brief publishes it; null when the cursor is on anything else.
export type BriefCursorInitiative = { oref: string; workOn: () => void };
export const briefCursorInitiativeAtom = atom<BriefCursorInitiative | null>(
    null
) as PrimitiveAtom<BriefCursorInitiative | null>;

// What the Brief's initiative menu asked the sheet to do once it is open on that initiative: rename it in its head, or
// open its details form. The sheet takes the request and clears it (initiativesheet.tsx).
export type InitiativeSheetRequest = { oref: string; action: "rename" | "details" };
export const initiativeSheetRequestAtom = atom<InitiativeSheetRequest | null>(
    null
) as PrimitiveAtom<InitiativeSheetRequest | null>;

// the Brief's effort titles and chunk stages by oid, for the run sheet's ↳ chunk line (it mounts outside
// the Brief's snapshot)
export const briefEffortIndexAtom = atom<EffortIndex>(new Map()) as PrimitiveAtom<EffortIndex>;

// the run oids of the group the open run sheet belongs to (live runs, or shipped), in row order: the
// sheet's "n / N" and its ↑/↓ (design L420-424)
export const briefRunListAtom = atom<string[]>([]) as PrimitiveAtom<string[]>;

// the effort orefs of the Brief's initiatives in page order (the cards, then the list): the initiative sheet's
// Previous/Next step through it (spec decision 7). The Brief publishes it as it publishes briefRunListAtom.
export const briefInitiativeListAtom = atom<string[]>([]) as PrimitiveAtom<string[]>;
