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

// The Brief's inline tracker: the chunk row whose note trail the sidebar is showing, and the keys of the
// note cards toggled open. Here rather than inside briefsurface because Escape has to claim them ahead of
// esc-home (bindings.ts), the same way the Vault's reader overlay does — a single press must close the
// note you are reading, not the note AND the surface.
export const noteChunkAtom = atom<string | null>(null) as PrimitiveAtom<string | null>;
export const readingNoteAtom = atom<Set<string>>(new Set<string>()) as PrimitiveAtom<Set<string>>;

// The one open plan-editing menu (a chunk's status menu or a stage's actions), by row id. Here for the
// same reason: it is the innermost Escape layer, and the dispatcher runs on window capture ahead of any
// listener the menu could register itself.
export const trackerMenuAtom = atom<string | null>(null) as PrimitiveAtom<string | null>;

// Alt+↑/↓ moves the chunk under the Brief cursor. The Brief publishes the handler while the cursor is on
// a chunk, because only it holds the plan the move is computed against.
export const chunkMoveAtom = atom<((dir: "up" | "down") => void) | null>(null) as PrimitiveAtom<
    ((dir: "up" | "down") => void) | null
>;

// The run sheet's ↳ chunk line opens that chunk in the Brief's inline tracker. The Brief publishes the
// handler, because only it holds the cursor and the stage overrides the reveal writes to.
export const briefRevealChunkAtom = atom<((effortOref: string, chunk: string) => void) | null>(null) as PrimitiveAtom<
    ((effortOref: string, chunk: string) => void) | null
>;

// the Brief's effort titles and chunk stages by oid, for the run sheet's ↳ chunk line (it mounts outside
// the Brief's snapshot)
export const briefEffortIndexAtom = atom<EffortIndex>(new Map()) as PrimitiveAtom<EffortIndex>;

// the run oids of the group the open run sheet belongs to (live runs, or shipped), in row order: the
// sheet's "n / N" and its ↑/↓ (design L420-424)
export const briefRunListAtom = atom<string[]>([]) as PrimitiveAtom<string[]>;
