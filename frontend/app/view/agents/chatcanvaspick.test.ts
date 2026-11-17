// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import type { CanvasBoard } from "./canvasmodel";
import { boardTitle, canvasPick, lastQuestion, namedLetters, optionRows, pickLine } from "./chatcanvaspick";

const board = (name: string, extra: Partial<CanvasBoard> = {}): CanvasBoard => ({
    name,
    x: 0,
    y: 0,
    w: 1440,
    h: 900,
    ...extra,
});

const BOARDS = [
    board("Main.dc.html"),
    board("A-merge-runs.dc.html", { title: "Option A: Gộp các lần liên tiếp cùng file" }),
    board("B-one-row-each.dc.html", { title: "Option B: One row per edit" }),
    board("C-timeline.dc.html"),
];

const REPLY = [
    "I drew three ways to show the edits:",
    "",
    "**A** — merge the runs on one file",
    "- B: one row per edit",
    "",
    "Which one do you want, A or B?",
].join("\n");

describe("namedLetters", () => {
    it("reads the option lines: a letter, bold or not, then a dash, colon, dot or paren", () => {
        const reply = [
            "A — first",
            "**B** second",
            "- C: third",
            "D) fourth",
            "1. E. fifth",
            "**F:** sixth",
            "**G**: seventh",
        ].join("\n");
        expect([...namedLetters(reply)].sort()).toEqual(["A", "B", "C", "D", "E", "F", "G"]);
    });

    it("reads a comma after the letter, inside the bold or out", () => {
        const reply = [
            "- **A, chip trầm** (`A-quiet-chip.dc.html`): cùng khung với pill file.",
            "- **B**, nhãn chữ",
            "C, nhuộm màu",
        ].join("\n");
        expect([...namedLetters(reply)].sort()).toEqual(["A", "B", "C"]);
    });

    it("skips a sentence that opens with a capital, a word, a board name and a letter in a code block", () => {
        const reply = [
            "I think so.",
            "A plain sentence.",
            "API: the call",
            "A-merge-runs.dc.html",
            "```",
            "B — code",
            "```",
        ].join("\n");
        expect([...namedLetters(reply)]).toEqual([]);
    });

    it("needs the bold closed", () => {
        expect([...namedLetters("**A first")]).toEqual([]);
    });
});

describe("boardTitle", () => {
    it("drops the Option X: prefix, and falls back to the slug", () => {
        expect(boardTitle(BOARDS[1])).toBe("Gộp các lần liên tiếp cùng file");
        expect(boardTitle(BOARDS[3])).toBe("timeline");
        expect(boardTitle(board("A-x.dc.html", { title: "Option A — Dense list" }))).toBe("Dense list");
    });
});

describe("optionRows", () => {
    it("keeps the boards the reply names, in canvas.json's order", () => {
        expect(optionRows(BOARDS, REPLY)).toEqual([
            { letter: "A", title: "Gộp các lần liên tiếp cùng file", board: "A-merge-runs.dc.html" },
            { letter: "B", title: "One row per edit", board: "B-one-row-each.dc.html" },
        ]);
    });

    it("is none when fewer than two named boards are on the canvas", () => {
        expect(optionRows(BOARDS, "A — only this one\n\nOk?")).toEqual([]);
        expect(optionRows(BOARDS, "X — not a board\nY — nor this\n\nWhich?")).toEqual([]);
    });

    it("takes the board modified last when two share a letter", () => {
        const boards = [
            board("A-old.dc.html", { modifiedMs: 5000 }),
            board("B-two.dc.html"),
            board("A-new.dc.html", { modifiedMs: 9000 }),
        ];
        expect(optionRows(boards, REPLY).map((r) => r.board)).toEqual(["B-two.dc.html", "A-new.dc.html"]);
        const older = [
            board("A-new.dc.html", { modifiedMs: 9000 }),
            board("A-old.dc.html", { modifiedMs: 5000 }),
            boards[1],
        ];
        expect(optionRows(older, REPLY).map((r) => r.board)).toEqual(["A-new.dc.html", "B-two.dc.html"]);
    });
});

describe("lastQuestion", () => {
    it("is the last sentence that ends with a question mark, marks off", () => {
        expect(lastQuestion(REPLY)).toBe("Which one do you want, A or B?");
        expect(lastQuestion("Both work. ==Which do **you** prefer?==")).toBe("Which do you prefer?");
    });
});

describe("pickLine", () => {
    it("is the letter and the title", () => {
        expect(pickLine({ letter: "A", title: "Gộp các lần liên tiếp cùng file", board: "x" })).toBe(
            "A — Gộp các lần liên tiếp cùng file"
        );
    });
});

describe("canvasPick", () => {
    const base = { reply: REPLY, idle: true, focused: true, brainstorm: false, boards: BOARDS, sent: null };

    it("shows the question and the named boards", () => {
        expect(canvasPick(base)).toEqual({
            question: "Which one do you want, A or B?",
            rows: optionRows(BOARDS, REPLY),
        });
    });

    it("is null while the agent works, out of focus, with a brainstorm or without a canvas", () => {
        expect(canvasPick({ ...base, idle: false })).toBeNull();
        expect(canvasPick({ ...base, focused: false })).toBeNull();
        expect(canvasPick({ ...base, brainstorm: true })).toBeNull();
        expect(canvasPick({ ...base, boards: null })).toBeNull();
        expect(canvasPick({ ...base, reply: null })).toBeNull();
    });

    it("is null when the reply asks nothing, and once a row was sent for this reply", () => {
        expect(canvasPick({ ...base, reply: REPLY.replace("?", ".") })).toBeNull();
        expect(canvasPick({ ...base, sent: REPLY })).toBeNull();
        expect(canvasPick({ ...base, sent: "an older reply" })).not.toBeNull();
    });

    it("is null once the agent moved the unchosen boards out of canvas.json", () => {
        expect(canvasPick({ ...base, boards: [BOARDS[0], BOARDS[1]] })).toBeNull();
    });
});
