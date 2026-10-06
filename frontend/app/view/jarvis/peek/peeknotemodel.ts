// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The memory note peek, decided. Pure; peeknote.tsx renders it.

import type { PeekFacts } from "../peekstore";

// A note is gone when its read is rejected. It has no surface and nothing to focus on.
export function notePeekFacts(result: "ok" | "error"): PeekFacts {
    return { gone: result === "error" };
}

// PeekNote.dc.html's meta line: the note's project, then the day it was last updated (MM-DD)
export function noteMetaLine(note: { project?: string; updated: number }): string {
    const parts: string[] = [];
    if (note.project) {
        parts.push(note.project);
    }
    if (note.updated > 0) {
        const d = new Date(note.updated);
        parts.push(`${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`);
    }
    return parts.join(" · ");
}
