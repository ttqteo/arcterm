// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
    changedLineCount,
    editorDiscard,
    editorLoaded,
    editorReload,
    editorSaved,
    editorTyped,
    EMPTY_EDITOR,
    harnessRowLabel,
    harnessRowState,
    headerStatus,
    isDirty,
    saveBaseMtime,
    saveTargetCount,
} from "./setupmodel";

function h(runtime: string, over: Partial<AgentSyncHarness> = {}): AgentSyncHarness {
    return {
        runtime,
        label: runtime.toUpperCase(),
        present: true,
        path: `/h/${runtime}.md`,
        steering: "absent",
        skillsmanaged: 0,
        skillsunmanaged: 0,
        ...over,
    };
}

describe("harnessRowState", () => {
    it("reads a current region as in sync and a stale one as out of date", () => {
        expect(harnessRowState(h("claude", { steering: "current" }))).toBe("in-sync");
        expect(harnessRowState(h("claude", { steering: "stale" }))).toBe("out-of-date");
    });

    it("reads no region, no file or a blank shared doc as not written yet", () => {
        expect(harnessRowState(h("claude", { steering: "absent" }))).toBe("not-written");
        expect(harnessRowLabel("not-written")).toBe("Not written yet");
    });

    it("reads a missing harness as not set up, whatever its file says", () => {
        expect(harnessRowState(h("pi", { present: false, steering: "current" }))).toBe("not-set-up");
        expect(harnessRowLabel("not-set-up")).toBe("Not set up");
    });
});

describe("saveTargetCount", () => {
    it("counts the present harnesses whatever their state", () => {
        const rows = [
            h("claude", { steering: "current" }),
            h("codex", { steering: "stale" }),
            h("opencode", { present: false }),
            h("pi"),
        ];
        expect(saveTargetCount(rows)).toBe(3);
    });
});

describe("headerStatus", () => {
    it("reports no harness when none is set up", () => {
        expect(headerStatus([h("pi", { present: false })])).toEqual({ text: "No harnesses set up", tone: "none" });
    });

    it("reports every present harness up to date", () => {
        const rows = [h("claude", { steering: "current" }), h("pi", { present: false })];
        expect(headerStatus(rows)).toEqual({ text: "1 harness up to date", tone: "ok" });
    });

    it("counts stale and unwritten harnesses as behind the shared doc", () => {
        const rows = [h("claude", { steering: "current" }), h("codex", { steering: "stale" }), h("pi")];
        expect(headerStatus(rows)).toEqual({ text: "2 of 3 harnesses out of date", tone: "warn" });
    });
});

describe("changedLineCount", () => {
    it("is zero for an untouched draft", () => {
        expect(changedLineCount("a\nb", "a\nb")).toBe(0);
    });

    it("counts an edited line once and an insertion without shifting the rest", () => {
        expect(changedLineCount("a\nb\nc", "a\nB\nc")).toBe(1);
        expect(changedLineCount("a\nb\nc", "x\na\nb\nc")).toBe(1);
    });

    it("counts every line a draft adds when it adds more than it drops", () => {
        expect(changedLineCount("a", "a\nb\nc\nd")).toBe(3);
    });

    it("counts every line a draft drops when it drops more than it adds", () => {
        expect(changedLineCount("a\nb\nc\nd", "a")).toBe(3);
    });

    it("counts a repeated line once per copy added or dropped", () => {
        expect(changedLineCount("a", "a\na\na")).toBe(2);
        expect(changedLineCount("a\na\na", "a")).toBe(2);
    });

    it("takes the larger of the lines added and dropped for a rewrite", () => {
        expect(changedLineCount("a\nb\nc", "x\ny")).toBe(3);
        expect(changedLineCount("a\nb", "x\ny\nz")).toBe(3);
    });
});

describe("editor conflict transitions", () => {
    const loaded = editorReload("v1", 10);

    it("saves with the read mtime, and with 0 on overwrite", () => {
        expect(saveBaseMtime(loaded, false)).toBe(10);
        expect(saveBaseMtime(loaded, true)).toBe(0);
    });

    it("a clean save rebases the draft on what was written", () => {
        const typed = editorTyped(loaded, "v2");
        expect(isDirty(typed)).toBe(true);
        const saved = editorSaved(typed, "v2", { mtime: 20, conflict: false });
        expect(saved).toEqual({ base: "v2", mtime: 20, draft: "v2", conflict: false });
        expect(isDirty(saved)).toBe(false);
    });

    it("a conflict keeps the draft and the old mtime", () => {
        const typed = editorTyped(loaded, "v2");
        const c = editorSaved(typed, "v2", { mtime: 30, conflict: true });
        expect(c).toEqual({ base: "v1", mtime: 10, draft: "v2", conflict: true });
        // a plain retry still sends the stale mtime; only overwrite skips the guard
        expect(saveBaseMtime(c, false)).toBe(10);
        expect(saveBaseMtime(c, true)).toBe(0);
    });

    it("overwrite after a conflict clears it", () => {
        const c = editorSaved(editorTyped(loaded, "v2"), "v2", { mtime: 30, conflict: true });
        expect(editorSaved(c, "v2", { mtime: 40, conflict: false })).toEqual({
            base: "v2",
            mtime: 40,
            draft: "v2",
            conflict: false,
        });
    });

    it("reload after a conflict loses the draft", () => {
        expect(editorReload("disk", 30)).toEqual({ base: "disk", mtime: 30, draft: "disk", conflict: false });
    });

    it("a background read passes an outside edit through a clean editor", () => {
        expect(editorLoaded(loaded, "theirs", 50)).toEqual({
            base: "theirs",
            mtime: 50,
            draft: "theirs",
            conflict: false,
        });
        expect(editorLoaded(EMPTY_EDITOR, "x", 1).draft).toBe("x");
    });

    it("a background read under a draft keeps the old mtime when the text changed, so the save still conflicts", () => {
        const typed = editorTyped(loaded, "mine");
        const after = editorLoaded(typed, "theirs", 50);
        expect(after).toEqual(typed);
        expect(saveBaseMtime(after, false)).toBe(10);
    });

    it("a background read under a draft takes the new mtime when only the rest of the file moved", () => {
        const after = editorLoaded(editorTyped(loaded, "mine"), "v1", 50);
        expect(after).toEqual({ base: "v1", mtime: 50, draft: "mine", conflict: false });
    });

    it("discard drops the draft and the conflict", () => {
        const c = editorSaved(editorTyped(loaded, "v2"), "v2", { mtime: 30, conflict: true });
        expect(editorDiscard(c)).toEqual({ base: "v1", mtime: 10, draft: "v1", conflict: false });
    });
});
