// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Pure model for the palette's Notes scope: labels, the copied markdown, the title rule the editor checks
// before it asks the server, the editor draft, and the arm-then-confirm presses. No React, no RPC.

export const NEW_NOTE_KEY = "note:new";
export const NOTE_TITLE_MAX_BYTES = 200; // notestore.maxTitleLen

export function noteKey(id: string): string {
    return `note:${id}`;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function dayMs(day: string): number {
    return Date.parse(`${day}T00:00:00Z`);
}

export function noteDayLabel(day: string, today: string): string {
    const diff = Math.round((dayMs(today) - dayMs(day)) / MS_PER_DAY);
    if (diff === 0) {
        return "today";
    }
    return diff === 1 ? "yesterday" : day;
}

// the note as its file reads
export function noteMarkdown(note: UserNote): string {
    const body = (note.body ?? "").trim();
    return body === "" ? `# ${note.title}\n` : `# ${note.title}\n\n${body}\n`;
}

export function noteTitleError(title: string): string | null {
    const t = title.trim();
    if (t === "") {
        return "A note needs a title.";
    }
    if (/[\r\n]/.test(t) || new TextEncoder().encode(t).length > NOTE_TITLE_MAX_BYTES) {
        return `A note title is one line of at most ${NOTE_TITLE_MAX_BYTES} bytes.`;
    }
    return null;
}

export interface NoteDraft {
    id: string | null; // null: a new note
    title: string;
    body: string;
    saved: { title: string; body: string }; // what it was opened with
}

export function draftOf(note: UserNote): NoteDraft {
    const body = note.body ?? "";
    return { id: note.id, title: note.title, body, saved: { title: note.title, body } };
}

export function newDraft(query: string): NoteDraft {
    return { id: null, title: query.trim(), body: "", saved: { title: "", body: "" } };
}

export function draftDirty(d: NoteDraft): boolean {
    return d.title !== d.saved.title || d.body !== d.saved.body;
}

// one armed confirmation at a time: a second press of the same key on the same target fires it,
// anything else disarms
export type ArmKey = "del" | "esc";
export interface Armed {
    key: ArmKey;
    target: string; // a note key, or "" for esc
}

export function pressArm(armed: Armed | null, key: ArmKey, target: string): { armed: Armed | null; fire: boolean } {
    if (armed != null && armed.key === key && armed.target === target) {
        return { armed: null, fire: true };
    }
    return { armed: { key, target }, fire: false };
}

// where the selection lands after the note at index i leaves a list of n notes
export function selectionAfterDelete(i: number, n: number): number {
    return Math.max(0, Math.min(i, n - 2));
}
