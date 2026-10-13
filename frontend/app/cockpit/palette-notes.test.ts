// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
    draftDirty,
    draftOf,
    newDraft,
    noteDayLabel,
    noteKey,
    noteMarkdown,
    noteTitleError,
    pressArm,
    selectionAfterDelete,
} from "./palette-notes";

const note = (over: Partial<UserNote> = {}): UserNote => ({ id: "2026-10-08-a", title: "A", day: "2026-10-08", ...over });

describe("noteDayLabel", () => {
    it("names today and yesterday, across a month boundary too", () => {
        expect(noteDayLabel("2026-10-08", "2026-10-08")).toBe("today");
        expect(noteDayLabel("2026-09-30", "2026-10-01")).toBe("yesterday");
    });
    it("returns an older day as is", () => {
        expect(noteDayLabel("2026-10-05", "2026-10-08")).toBe("2026-10-05");
    });
});

describe("noteMarkdown", () => {
    it("reads as the file does", () => {
        expect(noteMarkdown(note({ body: "hello\nworld" }))).toBe("# A\n\nhello\nworld\n");
    });
    it("is the heading alone for an empty or missing body", () => {
        expect(noteMarkdown(note({ body: "" }))).toBe("# A\n");
        expect(noteMarkdown(note())).toBe("# A\n");
    });
    it("leaves no blank line beyond the single newline", () => {
        expect(noteMarkdown(note({ body: "x\n\n" }))).toBe("# A\n\nx\n");
    });
});

describe("noteTitleError", () => {
    it("refuses empty and whitespace-only", () => {
        expect(noteTitleError("")).not.toBeNull();
        expect(noteTitleError("   ")).not.toBeNull();
    });
    it("counts bytes: 200 passes, 201 fails, multi-byte counts more", () => {
        expect(noteTitleError("a".repeat(200))).toBeNull();
        expect(noteTitleError("a".repeat(201))).not.toBeNull();
        expect(noteTitleError("é".repeat(100))).toBeNull(); // 200 bytes
        expect(noteTitleError("é".repeat(101))).not.toBeNull(); // 202 bytes
    });
    it("refuses a newline", () => {
        expect(noteTitleError("a\nb")).not.toBeNull();
    });
    it("takes a good title", () => {
        expect(noteTitleError("  ship it  ")).toBeNull();
    });
});

describe("draftDirty", () => {
    it("is false unchanged, true when changed, false when changed back", () => {
        const d = draftOf(note({ body: "b" }));
        expect(draftDirty(d)).toBe(false);
        expect(draftDirty({ ...d, title: "B" })).toBe(true);
        expect(draftDirty({ ...d, body: "c" })).toBe(true);
        expect(draftDirty({ ...{ ...d, body: "c" }, body: "b" })).toBe(false);
    });
    it("a new draft is dirty only with a title from the query", () => {
        expect(draftDirty(newDraft("  fix  "))).toBe(true);
        expect(newDraft("  fix  ").title).toBe("fix");
        expect(draftDirty(newDraft("  "))).toBe(false);
    });
});

describe("pressArm", () => {
    const k = noteKey("a");
    it("arms on the first press and fires on the second", () => {
        const first = pressArm(null, "del", k);
        expect(first).toEqual({ armed: { key: "del", target: k }, fire: false });
        expect(pressArm(first.armed, "del", k)).toEqual({ armed: null, fire: true });
    });
    it("del on another note re-arms on that one", () => {
        const r = pressArm({ key: "del", target: k }, "del", noteKey("b"));
        expect(r).toEqual({ armed: { key: "del", target: noteKey("b") }, fire: false });
    });
    it("esc while del is armed arms esc without firing", () => {
        expect(pressArm({ key: "del", target: k }, "esc", "")).toEqual({
            armed: { key: "esc", target: "" },
            fire: false,
        });
    });
});

describe("selectionAfterDelete", () => {
    it("keeps the middle, moves up from the last, and rests at 0 for the only note", () => {
        expect(selectionAfterDelete(1, 3)).toBe(1);
        expect(selectionAfterDelete(2, 3)).toBe(1);
        expect(selectionAfterDelete(0, 1)).toBe(0);
    });
});
