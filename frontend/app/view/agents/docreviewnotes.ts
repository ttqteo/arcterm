// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Notes the human pins to passages of the document under review (docreviewdialog.tsx). They travel with
// Approve or Request changes to the lead as one text answer: each note is its passage quoted on one line,
// then the note.

import { atom, type PrimitiveAtom } from "jotai";

export interface DocNote {
    id: string;
    // offsets into the document container's text (its text nodes concatenated in order)
    start: number;
    end: number;
    text: string;
    note: string;
}

export type DocReviewSent = "approve" | "request";

export interface DocNotesState {
    notes: DocNote[];
    sent?: DocReviewSent;
}

// askId -> that ask's notes
export const docNotesAtom = atom<Record<string, DocNotesState>>({}) as PrimitiveAtom<Record<string, DocNotesState>>;

const ID_PREFIX = "n";
const BLOCK_GAP = "\n\n";
const REQUEST_LABEL = "Request changes";

export function normalizePassage(raw: string): string {
    return raw.replace(/\s+/g, " ").trim();
}

const nextId = (notes: DocNote[]): string => {
    const used = notes.map((n) => Number(n.id.slice(ID_PREFIX.length))).filter(Number.isFinite);
    return `${ID_PREFIX}${Math.max(0, ...used) + 1}`;
};

// the sort is stable, so notes on the same range keep the order they were added in
export function orderNotes(notes: DocNote[]): DocNote[] {
    return [...notes].sort((a, b) => a.start - b.start || a.end - b.end);
}

export function addNote(notes: DocNote[], n: Omit<DocNote, "id">): DocNote[] {
    return orderNotes([...notes, { ...n, note: n.note.trim(), id: nextId(notes) }]);
}

export function setNoteText(notes: DocNote[], id: string, note: string): DocNote[] {
    return notes.map((n) => (n.id === id ? { ...n, note } : n));
}

export function removeNote(notes: DocNote[], id: string): DocNote[] {
    return notes.filter((n) => n.id !== id);
}

const stripSpace = (s: string): string => s.replace(/\s+/g, "");

// a selection's text and the text nodes disagree on whitespace between blocks, so compare without any
export function isPaintable(note: DocNote, docText: string): boolean {
    if (note.start < 0 || note.end > docText.length || note.start >= note.end) {
        return false;
    }
    const slice = stripSpace(docText.slice(note.start, note.end));
    return slice !== "" && slice === stripSpace(note.text);
}

const noteBlock = (n: DocNote): string => {
    const note = n.note.trim();
    return note ? `> ${n.text}\n${note}` : `> ${n.text}`;
};

export function composeAnswer(input: {
    kind: DocReviewSent;
    approveLabel: string;
    message: string;
    notes: DocNote[];
}): string {
    const lead = input.kind === "approve" ? input.approveLabel : input.message.trim();
    return [lead, ...orderNotes(input.notes).map(noteBlock)].filter(Boolean).join(BLOCK_GAP);
}

// returns the same object when nothing is dropped, so a store set with it wakes no subscriber
export function pruneNotes(
    state: Record<string, DocNotesState>,
    liveAskIds: Set<string>
): Record<string, DocNotesState> {
    const kept = Object.entries(state).filter(([askId]) => liveAskIds.has(askId));
    return kept.length === Object.keys(state).length ? state : Object.fromEntries(kept);
}

export function notesCopy(input: { count: number; approveLabel: string; placeholder: string }): {
    approve: string;
    request: string;
    noteLabel: string;
    notePlaceholder: string;
    send: string;
    sentApprove: string;
    sentRequest: string;
} {
    const { count, approveLabel, placeholder } = input;
    if (count === 0) {
        return {
            approve: approveLabel,
            request: REQUEST_LABEL,
            noteLabel: "What should change?",
            notePlaceholder: placeholder,
            send: "Send to the lead",
            sentApprove: approveLabel,
            sentRequest: `${REQUEST_LABEL}, with your note`,
        };
    }
    const n = count === 1 ? "1 note" : `${count} notes`;
    return {
        approve: `${approveLabel} with ${n}`,
        request: `${REQUEST_LABEL} · ${n}`,
        noteLabel: `Anything beyond your ${n}?`,
        notePlaceholder: "Optional",
        send: `Send ${n} to the lead`,
        sentApprove: `${approveLabel}, with ${n}`,
        sentRequest: `${REQUEST_LABEL}, with ${n}`,
    };
}
