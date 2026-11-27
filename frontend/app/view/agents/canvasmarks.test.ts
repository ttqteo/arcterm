// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
    addMark,
    boxToMark,
    canvasHandoffLine,
    cropRect,
    feedbackRelPath,
    groupMarks,
    groupShot,
    markContextLabel,
    marksIn,
    nextFeedbackName,
    NO_CONTEXT,
    removeMark,
    setMarkNote,
    setMarkShot,
    shotBox,
    spansContexts,
    visibleRect,
    type Mark,
    type MarkShot,
} from "./canvasmarks";
import type { MarkContext } from "./protomodel";

const HOME: MarkContext = { screen: "Home", slots: [{ id: "list", label: "list", letter: "A" }] };
const LATER: MarkContext = { screen: "Later", slots: [{ id: "list", label: "list", letter: "B" }] };
const BIG = { x0: 0, y0: 0, x1: 30, y1: 30 };

let ids = 0;
function mark(note: string, x = 0, ctx: MarkContext = NO_CONTEXT): Mark {
    return { id: ++ids, x, y: 0, w: 20, h: 20, note, ctx, shot: null };
}

function shotOf(rect: MarkShot["rect"], scale = 1): MarkShot {
    return { png: new Blob([new Uint8Array([1])], { type: "image/png" }), rect, scale };
}

describe("boxToMark", () => {
    it("normalizes a right-to-left, bottom-to-top drag", () => {
        expect(boxToMark({ x0: 100, y0: 80, x1: 40, y1: 20 })).toMatchObject({ x: 40, y: 20, w: 60, h: 60, note: "" });
    });

    it("keeps only a box over the minimum on both sides", () => {
        expect(boxToMark({ x0: 0, y0: 0, x1: 10, y1: 40 })).toBeNull();
        expect(boxToMark({ x0: 0, y0: 0, x1: 40, y1: 10 })).toBeNull();
        expect(boxToMark({ x0: 0, y0: 0, x1: 11, y1: 11 })).toMatchObject({ x: 0, y: 0, w: 11, h: 11, note: "" });
    });
});

describe("a mark's context and picture", () => {
    it("keeps the context it was drawn on, and has no picture yet", () => {
        const [m] = addMark([], BIG, LATER);
        expect(m.ctx).toEqual(LATER);
        expect(m.shot).toBeNull();
    });

    it("has no context when it is drawn on a board that reports none", () => {
        expect(addMark([], BIG)[0].ctx).toEqual(NO_CONTEXT);
        expect(boxToMark(BIG)!.ctx).toEqual(NO_CONTEXT);
    });

    it("gives each mark an id no other mark has had, even after one is removed", () => {
        let marks = addMark(addMark([], BIG), BIG);
        const seen = marks.map((m) => m.id);
        marks = addMark(removeMark(marks, 1), BIG);
        expect(new Set([...seen, marks[1].id]).size).toBe(3);
    });

    it("sets a picture on the mark with that id, wherever it sits in the list now", () => {
        const marks = [mark("a"), mark("b"), mark("c")];
        const shot = shotOf({ left: 0, top: 0, width: 10, height: 10 });
        const next = setMarkShot(removeMark(marks, 0), marks[2].id, shot);
        expect(next.map((m) => m.shot)).toEqual([null, shot]);
        expect(marks[2].shot).toBeNull();
    });

    it("ignores a picture for a mark that is gone, and keeps one through a note change", () => {
        const marks = [mark("a")];
        const shot = shotOf({ left: 0, top: 0, width: 10, height: 10 });
        expect(setMarkShot(marks, -1, shot)).toEqual(marks);
        const shot0 = setMarkShot(marks, marks[0].id, shot);
        expect(setMarkNote(shot0, 0, "wider")[0].shot).toBe(shot);
    });
});

describe("groupMarks", () => {
    it("groups by context in the order each first appears, numbering across the whole list", () => {
        const marks = [mark("a", 0, HOME), mark("b", 0, LATER), mark("c", 0, HOME)];
        const groups = groupMarks(marks);
        expect(groups.map((g) => g.ctx)).toEqual([HOME, LATER]);
        expect(groups.map((g) => g.marks.map((m) => m.n))).toEqual([[1, 3], [2]]);
        expect(groups[0].marks[1].mark).toBe(marks[2]);
    });

    it("is one group for marks with no context, numbered 1 up", () => {
        const groups = groupMarks([mark("a"), mark("b")]);
        expect(groups).toHaveLength(1);
        expect(groups[0].marks.map((m) => m.n)).toEqual([1, 2]);
    });

    it("takes the same screen and letters as one context however the slots are ordered or labeled", () => {
        const a: MarkContext = {
            screen: "Home",
            slots: [
                { id: "x", label: "X", letter: "A" },
                { id: "y", label: "Y", letter: "B" },
            ],
        };
        const b: MarkContext = {
            screen: "Home",
            slots: [
                { id: "y", label: "why", letter: "B" },
                { id: "x", label: "X", letter: "A" },
            ],
        };
        expect(groupMarks([mark("a", 0, a), mark("b", 0, b)])).toHaveLength(1);
    });

    it("keeps screens apart, and letters apart", () => {
        const sameLetterElsewhere: MarkContext = { ...HOME, screen: "Later" };
        const otherLetter: MarkContext = { ...HOME, slots: [{ id: "list", label: "list", letter: "B" }] };
        expect(
            groupMarks([mark("a", 0, HOME), mark("b", 0, sameLetterElsewhere), mark("c", 0, otherLetter)])
        ).toHaveLength(3);
    });

    it("is empty for no marks", () => {
        expect(groupMarks([])).toEqual([]);
    });
});

describe("marksIn", () => {
    it("lists the marks of one context with their numbers in the whole list", () => {
        const marks = [mark("a", 0, HOME), mark("b", 0, LATER), mark("c", 0, HOME)];
        expect(marksIn(marks, HOME).map((m) => m.n)).toEqual([1, 3]);
        expect(marksIn(marks, LATER).map((m) => m.n)).toEqual([2]);
        expect(marksIn(marks, NO_CONTEXT)).toEqual([]);
    });
});

describe("groupShot", () => {
    const rect = { left: 0, top: 0, width: 10, height: 10 };

    it("is the newest picture in the group", () => {
        const old = { ...mark("a", 0, HOME), shot: shotOf(rect) };
        const fresh = { ...mark("b", 0, HOME), shot: shotOf(rect) };
        expect(groupShot(groupMarks([old, mark("x", 0, LATER), fresh])[0])).toBe(fresh.shot);
    });

    it("skips a newer mark whose capture failed", () => {
        const old = { ...mark("a", 0, HOME), shot: shotOf(rect) };
        expect(groupShot(groupMarks([old, mark("b", 0, HOME)])[0])).toBe(old.shot);
    });

    it("is null when no mark in the group has one", () => {
        expect(groupShot(groupMarks([mark("a", 0, HOME)])[0])).toBeNull();
    });
});

describe("shotBox", () => {
    it("moves a box into the picture's pixels when the board is scrolled and scaled", () => {
        // the picture holds the part of the frame that starts 100 CSS px down it, at 2 device px per CSS px
        const shot = shotOf({ left: 0, top: 100, width: 400, height: 300 }, 2);
        expect(shotBox({ x: 30, y: 140, w: 50, h: 20 }, shot)).toEqual({ x: 60, y: 80, w: 100, h: 40 });
    });

    it("moves a box left of a picture that starts inside the frame", () => {
        expect(shotBox({ x: 30, y: 10, w: 50, h: 20 }, shotOf({ left: 10, top: 0, width: 200, height: 200 }))).toEqual({
            x: 20,
            y: 10,
            w: 50,
            h: 20,
        });
    });

    it("lets a box above the picture fall off its top edge rather than moving it", () => {
        expect(shotBox({ x: 0, y: 60, w: 10, h: 10 }, shotOf({ left: 0, top: 100, width: 50, height: 50 }, 2)).y).toBe(
            -80
        );
    });
});

describe("marks of more than one context", () => {
    it("tells whether the marks span more than one", () => {
        expect(spansContexts([])).toBe(false);
        expect(spansContexts([mark("a", 0, HOME), mark("b", 0, HOME)])).toBe(false);
        expect(spansContexts([mark("a", 0, HOME), mark("b", 0, LATER)])).toBe(true);
    });

    it("names a context the way the handoff line does, and a mark with none as the board", () => {
        expect(markContextLabel(LATER)).toBe('screen "Later", slot list = B');
        expect(markContextLabel(NO_CONTEXT)).toBe("the board");
    });
});

describe("mark list", () => {
    it("appends a big enough box and ignores a click-sized one", () => {
        const one = addMark([], { x0: 0, y0: 0, x1: 11, y1: 11 });
        expect(one).toHaveLength(1);
        expect(addMark(one, { x0: 0, y0: 0, x1: 10, y1: 40 })).toBe(one);
    });

    it("removes by index and keeps the rest in order", () => {
        expect(removeMark([mark("a"), mark("b"), mark("c")], 1).map((m) => m.note)).toEqual(["a", "c"]);
    });

    it("sets one mark's note", () => {
        const marks = [mark("a"), mark("b")];
        const next = setMarkNote(marks, 1, "too wide");
        expect(next.map((m) => m.note)).toEqual(["a", "too wide"]);
        expect(marks[1].note).toBe("b");
    });
});

describe("nextFeedbackName", () => {
    it("starts at 001", () => {
        expect(nextFeedbackName([])).toBe("001.png");
    });

    // only NNN.png counts: a notes file, a two-digit name or a backup must not move the number
    it("follows the highest numbered capture and ignores other files", () => {
        expect(nextFeedbackName(["001.png", "003.png", "notes.txt", "12.png", "007.png.bak"])).toBe("004.png");
    });

    it("keeps counting past 999", () => {
        expect(nextFeedbackName(["999.png"])).toBe("1000.png");
        expect(nextFeedbackName(["999.png", "1000.png"])).toBe("1001.png");
    });
});

describe("feedbackRelPath", () => {
    it("is relative to the agent's cwd with forward slashes", () => {
        expect(feedbackRelPath("t", "003.png")).toBe(".superpowers/design/t/feedback/003.png");
    });
});

describe("canvasHandoffLine", () => {
    it("numbers the marks, names an empty note, and stays one line", () => {
        const line = canvasHandoffLine(".superpowers/design/t/feedback/003.png", "Main.dc.html", [
            mark("too wide"),
            mark("  "),
            mark("a\nb"),
        ]);
        expect(line).toBe(
            "look at .superpowers/design/t/feedback/003.png — marks on Main.dc.html: 1 too wide; 2 (no note); 3 a b"
        );
    });

    // only the line matters: a ; inside a note is kept as written
    it("keeps a semicolon in a note verbatim", () => {
        expect(canvasHandoffLine("f.png", "Main.dc.html", [mark("a; b")])).toBe(
            "look at f.png — marks on Main.dc.html: 1 a; b"
        );
    });

    it("says nothing more for a context that holds no screen and no slot", () => {
        expect(canvasHandoffLine("f.png", "Main.dc.html", [mark("a")], NO_CONTEXT)).toBe(
            canvasHandoffLine("f.png", "Main.dc.html", [mark("a")])
        );
    });

    it("names the screen and the variant after the board", () => {
        expect(canvasHandoffLine("f.png", "Later.dc.html", [mark("too wide", 0, LATER)], LATER)).toBe(
            'look at f.png — marks on Later.dc.html, screen "Later", slot list = B: 1 too wide'
        );
    });

    it("numbers the marks as the caller says, for a group inside a longer list", () => {
        expect(canvasHandoffLine("f.png", "Main.dc.html", [mark("a"), mark("b")], NO_CONTEXT, [1, 3])).toBe(
            "look at f.png — marks on Main.dc.html: 1 a; 3 b"
        );
    });

    it("leaves out the picture it has none for, and keeps the rest", () => {
        expect(canvasHandoffLine(null, "Later.dc.html", [mark("a", 0, LATER)], LATER, [2])).toBe(
            'marks on Later.dc.html, screen "Later", slot list = B: 2 a'
        );
    });
});

describe("cropRect", () => {
    it("scales the board rect to the capture's pixels", () => {
        expect(cropRect({ left: 100, top: 50, width: 640, height: 400 }, 1600, { width: 3200, height: 1900 })).toEqual({
            sx: 200,
            sy: 100,
            sw: 1280,
            sh: 800,
        });
    });

    it("clamps to the bitmap", () => {
        expect(
            cropRect({ left: 1200, top: 800, width: 640, height: 400 }, 1600, { width: 3200, height: 1900 })
        ).toEqual({ sx: 2400, sy: 1600, sw: 800, sh: 300 });
    });
});

describe("visibleRect", () => {
    const clip = { left: 100, top: 200, width: 800, height: 500 };

    it("is the board itself when it is all in view", () => {
        const board = { left: 150, top: 220, width: 600, height: 400 };
        expect(visibleRect(board, clip)).toEqual(board);
    });

    it("cuts a board scrolled under the toolbar and past the bottom to the part in view", () => {
        expect(visibleRect({ left: 100, top: 50, width: 800, height: 900 }, clip)).toEqual({
            left: 100,
            top: 200,
            width: 800,
            height: 500,
        });
    });

    it("is empty when the board is out of view", () => {
        const r = visibleRect({ left: 100, top: 800, width: 800, height: 300 }, clip);
        expect(r.width * r.height).toBe(0);
    });
});
