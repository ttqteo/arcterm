// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The ledge's Note tab in Float (docs/superpowers/specs/2026-10-17-float-note-translate-design.md): the pure parts of
// the one global scratch note, how a failed save reads and how long after a keystroke it saves. The state and the
// actions are floatnotestore.ts. The Translate tab is the Translate panel (translatestore.ts).

// how long after the last keystroke the note saves
export const SCRATCH_SAVE_MS = 500;

/** The one line under the note when a save failed. */
export function scratchErrorLine(err: unknown): string {
    const raw = err instanceof Error ? err.message : String(err);
    const message = raw.replace(/^Error: /, "").replace(/\.$/, "");
    return `Couldn't save the note: ${message}. Your text stays here, and your next edit tries again.`;
}
