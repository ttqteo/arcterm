// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
    addNote,
    composeAnswer,
    isPaintable,
    normalizePassage,
    notesCopy,
    orderNotes,
    pruneNotes,
    removeNote,
    setNoteText,
    type DocNote,
    type DocNotesState,
} from "./docreviewnotes";

const note = (start: number, end: number, text: string, body = ""): Omit<DocNote, "id"> => ({
    start,
    end,
    text,
    note: body,
});

const build = (...ns: Omit<DocNote, "id">[]): DocNote[] => ns.reduce<DocNote[]>(addNote, []);

describe("normalizePassage", () => {
    it("collapses newlines and tabs to single spaces and trims", () => {
        expect(normalizePassage("  Redis\tsessions,\n\n14-day   sliding TTL \r\n")).toBe(
            "Redis sessions, 14-day sliding TTL"
        );
    });
});

describe("addNote", () => {
    it("returns notes in document order, ties broken by end then insertion", () => {
        const notes = build(
            note(40, 50, "late"),
            note(10, 30, "long", "first on the range"),
            note(10, 20, "short"),
            note(10, 30, "long", "second on the range")
        );
        expect(notes.map((n) => [n.start, n.end, n.note])).toEqual([
            [10, 20, ""],
            [10, 30, "first on the range"],
            [10, 30, "second on the range"],
            [40, 50, ""],
        ]);
    });
    it("makes two notes with different ids for a passage quoted twice", () => {
        const notes = build(note(5, 9, "same"), note(5, 9, "same"));
        expect(notes).toHaveLength(2);
        expect(notes[0].id).not.toBe(notes[1].id);
    });
    it("keeps ids unique after a removal", () => {
        const two = build(note(0, 1, "a"), note(2, 3, "b"));
        const again = addNote(removeNote(two, two[0].id), note(4, 5, "c"));
        expect(new Set(again.map((n) => n.id)).size).toBe(2);
    });
    it("trims the note and leaves the input list alone", () => {
        const before: DocNote[] = [];
        expect(addNote(before, note(0, 4, "text", "  fix this \n"))[0].note).toBe("fix this");
        expect(before).toEqual([]);
    });
});

describe("setNoteText and removeNote", () => {
    const notes = build(note(0, 4, "one", "a"), note(5, 9, "two", "b"));
    it("change only the note with that id, in a new array", () => {
        const edited = setNoteText(notes, notes[1].id, "changed");
        expect(edited.map((n) => n.note)).toEqual(["a", "changed"]);
        expect(removeNote(notes, notes[0].id).map((n) => n.text)).toEqual(["two"]);
        expect(notes.map((n) => n.note)).toEqual(["a", "b"]);
    });
    it("leave an unknown id as a no-op", () => {
        expect(setNoteText(notes, "nope", "x")).toEqual(notes);
        expect(removeNote(notes, "nope")).toEqual(notes);
    });
});

describe("orderNotes", () => {
    it("sorts without mutating", () => {
        const raw: DocNote[] = [
            { id: "n1", start: 9, end: 12, text: "b", note: "" },
            { id: "n2", start: 1, end: 3, text: "a", note: "" },
        ];
        expect(orderNotes(raw).map((n) => n.id)).toEqual(["n2", "n1"]);
        expect(raw.map((n) => n.id)).toEqual(["n1", "n2"]);
    });
});

describe("isPaintable", () => {
    const doc = "Sessions\nRedis sessions, 14-day TTL.\n\nCookies\n";
    const at = (start: number, end: number, text: string): DocNote => ({ id: "n1", start, end, text, note: "" });
    it("is true across a block boundary where only whitespace differs", () => {
        const start = doc.indexOf("TTL.");
        const end = doc.indexOf("Cookies") + "Cookies".length;
        expect(isPaintable(at(start, end, "TTL. Cookies"), doc)).toBe(true);
    });
    it("is false when the document text changed", () => {
        const start = doc.indexOf("Redis");
        expect(isPaintable(at(start, start + "Redis sessions".length, "Postgres sessions"), doc)).toBe(false);
    });
    it("is false when the range is past the end, or empty", () => {
        expect(isPaintable(at(doc.length - 3, doc.length + 4, "ies"), doc)).toBe(false);
        expect(isPaintable(at(4, 4, ""), doc)).toBe(false);
        expect(isPaintable(at(doc.indexOf("\n\n"), doc.indexOf("\n\n") + 2, ""), doc)).toBe(false);
    });
});

describe("composeAnswer", () => {
    // added out of document order on purpose
    const notes = build(
        note(80, 120, "Accept the legacy sid cookie for one release", "Two releases"),
        note(10, 40, "Redis sessions, 14-day sliding TTL", "Make it 30 days")
    );
    it("approve with two notes: the label, then the notes in document order", () => {
        expect(composeAnswer({ kind: "approve", approveLabel: "Approve", message: "ignored", notes })).toBe(
            "Approve\n\n> Redis sessions, 14-day sliding TTL\nMake it 30 days\n\n> Accept the legacy sid cookie for one release\nTwo releases"
        );
    });
    it("request with a message and notes: the trimmed message, no label line", () => {
        expect(composeAnswer({ kind: "request", approveLabel: "Approve", message: "  Rework auth.\n", notes })).toBe(
            "Rework auth.\n\n> Redis sessions, 14-day sliding TTL\nMake it 30 days\n\n> Accept the legacy sid cookie for one release\nTwo releases"
        );
    });
    it("request with notes and an empty message: the notes alone", () => {
        expect(composeAnswer({ kind: "request", approveLabel: "Approve", message: "  ", notes })).toBe(
            "> Redis sessions, 14-day sliding TTL\nMake it 30 days\n\n> Accept the legacy sid cookie for one release\nTwo releases"
        );
    });
    it("a note with no text sends its passage line alone", () => {
        const bare = build(note(10, 40, "Redis sessions"), note(50, 60, "Cookies", "Drop them"));
        expect(composeAnswer({ kind: "approve", approveLabel: "Approve", message: "", notes: bare })).toBe(
            "Approve\n\n> Redis sessions\n\n> Cookies\nDrop them"
        );
    });
});

describe("pruneNotes", () => {
    const state: Record<string, DocNotesState> = {
        a1: { notes: build(note(0, 4, "one")) },
        a2: { notes: [], sent: "approve" },
    };
    it("drops an ask that is gone", () => {
        expect(pruneNotes(state, new Set(["a2", "a3"]))).toEqual({ a2: state.a2 });
    });
    it("returns the identical object when every ask is live", () => {
        expect(pruneNotes(state, new Set(["a1", "a2"]))).toBe(state);
    });
});

describe("notesCopy", () => {
    const input = {
        approveLabel: "Accept all and proceed",
        placeholder: "Which finding to handle differently, and how",
    };
    it("is today's copy with no notes", () => {
        expect(notesCopy({ ...input, count: 0 })).toEqual({
            approve: "Accept all and proceed",
            request: "Request changes",
            noteLabel: "What should change?",
            notePlaceholder: "Which finding to handle differently, and how",
            send: "Send to the lead",
            sentApprove: "Accept all and proceed",
            sentRequest: "Request changes, with your note",
        });
    });
    it("is singular for one note", () => {
        expect(notesCopy({ ...input, count: 1 })).toEqual({
            approve: "Accept all and proceed with 1 note",
            request: "Request changes · 1 note",
            noteLabel: "Anything beyond your 1 note?",
            notePlaceholder: "Optional",
            send: "Send 1 note to the lead",
            sentApprove: "Accept all and proceed, with 1 note",
            sentRequest: "Request changes, with 1 note",
        });
    });
    it("counts six notes", () => {
        expect(notesCopy({ ...input, count: 6 })).toEqual({
            approve: "Accept all and proceed with 6 notes",
            request: "Request changes · 6 notes",
            noteLabel: "Anything beyond your 6 notes?",
            notePlaceholder: "Optional",
            send: "Send 6 notes to the lead",
            sentApprove: "Accept all and proceed, with 6 notes",
            sentRequest: "Request changes, with 6 notes",
        });
    });
});
