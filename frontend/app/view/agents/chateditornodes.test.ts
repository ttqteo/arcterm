// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { segmentsOf, type Segment } from "./chateditormodel";
import {
    adjacentPill,
    buildLine,
    isBreak,
    linesText,
    placeOf,
    placeOffset,
    type EditorLine,
    type EditorPlace,
} from "./chateditornodes";

const text = (t: string): Segment => ({ kind: "text", text: t });
const pill = (path: string): Segment => ({ kind: "pill", path });
const BR = text("\n");

describe("buildLine", () => {
    it("is empty for an empty message", () => {
        expect(buildLine(segmentsOf(""))).toEqual([]);
    });

    it("keeps a line of text and a pill as they are", () => {
        expect(buildLine(segmentsOf("see @src/a.ts now", 0))).toEqual([text("see "), pill("src/a.ts"), text(" now")]);
    });

    it("splits a newline out of a text run into a break of its own", () => {
        expect(buildLine([text("ab\ncd")])).toEqual([text("ab"), BR, text("cd")]);
        expect(buildLine([text("\n")])).toEqual([BR]);
        expect(buildLine([text("a\n\nb\n")])).toEqual([text("a"), BR, BR, text("b"), BR]);
    });

    it("breaks lines around a pill", () => {
        expect(buildLine(segmentsOf("a\n@x/y.ts\nb", 0))).toEqual([text("a"), BR, pill("x/y.ts"), BR, text("b")]);
    });

    it("marks only a lone newline as a break", () => {
        expect(isBreak(BR)).toBe(true);
        expect(isBreak(text("a"))).toBe(false);
        expect(isBreak(pill("a/b.ts"))).toBe(false);
    });
});

describe("linesText", () => {
    it("writes each pill as the mention it came from, quoted when the path holds a space", () => {
        expect(linesText([[text("a "), pill("x/y.ts"), text(" b "), pill("My Files/a.md")]])).toBe(
            'a @x/y.ts b @"My Files/a.md"'
        );
    });

    it("joins separate lines with a newline", () => {
        expect(linesText([[text("a")], [], [pill("b/c.ts")]])).toBe("a\n\n@b/c.ts");
        expect(linesText([])).toBe("");
    });

    it("round-trips the text through the segments and back", () => {
        for (const t of [
            "",
            "plain",
            "see @src/a.ts now",
            "@a/b.ts",
            "@a/b.ts @c/d.ts",
            'quoted @"My Files/a b.md" mention',
            "two\nlines @x/y.ts\n\nand a third\n",
            "\n\n",
            "mail a@b.c and @alice here",
        ]) {
            expect(linesText([buildLine(segmentsOf(t))])).toBe(t);
        }
    });
});

describe("placeOffset and placeOf", () => {
    // "ab" [pill x/y.ts = 7 chars] "cd" ⏎ "ef"   →   "ab@x/y.tscd\nef"
    const line: EditorLine = [text("ab"), pill("x/y.ts"), text("cd"), BR, text("ef")];
    const textOf = linesText([line]);

    it("agrees with the text it was built from", () => {
        expect(textOf).toBe("ab@x/y.tscd\nef");
        expect(placeOffset([line], { line: 0, index: 0, offset: 0 })).toBe(0);
        expect(placeOffset([line], { line: 0, index: 0, offset: 2 })).toBe(2);
        expect(placeOffset([line], { line: 0, index: 1, offset: 0 })).toBe(2);
        expect(placeOffset([line], { line: 0, index: 1, offset: 1 })).toBe(9);
        expect(placeOffset([line], { line: 0, index: 2, offset: 1 })).toBe(10);
        expect(placeOffset([line], { line: 0, index: 3, offset: 1 })).toBe(12);
        expect(placeOffset([line], { line: 0, index: 4, offset: 2 })).toBe(14);
    });

    it("puts a boundary at the earlier segment", () => {
        expect(placeOf([line], 2)).toEqual({ line: 0, index: 0, offset: 2 }); // just before the pill
        expect(placeOf([line], 9)).toEqual({ line: 0, index: 1, offset: 1 }); // just after it
        expect(placeOf([line], 11)).toEqual({ line: 0, index: 2, offset: 2 }); // end of "cd", before the break
        expect(placeOf([line], 12)).toEqual({ line: 0, index: 3, offset: 1 }); // after the break
    });

    it("snaps a place inside a pill's text to its far side", () => {
        expect(placeOf([line], 5)).toEqual({ line: 0, index: 1, offset: 1 });
    });

    it("round-trips every offset of the text", () => {
        for (let plain = 0; plain <= textOf.length; plain++) {
            const place = placeOf([line], plain);
            const back = placeOffset([line], place);
            // an offset inside the pill's text snaps to the pill's far side; every other offset comes back as it was
            if (plain > 2 && plain < 9) {
                expect(back).toBe(9);
            } else {
                expect(back).toBe(plain);
            }
        }
    });

    it("clamps what is out of range", () => {
        expect(placeOf([line], -3)).toEqual({ line: 0, index: 0, offset: 0 });
        expect(placeOf([line], 99)).toEqual({ line: 0, index: 4, offset: 2 });
        expect(placeOffset([line], { line: 0, index: 9, offset: 0 })).toBe(14);
        expect(placeOffset([line], { line: 5, index: 0, offset: 0 })).toBe(14);
    });

    it("handles an empty message, a leading pill and a trailing one", () => {
        expect(placeOf([[]], 0)).toEqual({ line: 0, index: 0, offset: 0 });
        expect(placeOf([], 3)).toEqual({ line: 0, index: 0, offset: 0 });
        expect(placeOffset([[]], { line: 0, index: 0, offset: 0 })).toBe(0);
        const lead: EditorLine = [pill("a/b.ts"), text(" x")];
        expect(placeOf([lead], 0)).toEqual({ line: 0, index: 0, offset: 0 });
        expect(placeOf([lead], 7)).toEqual({ line: 0, index: 0, offset: 1 });
        const trail: EditorLine = [text("x "), pill("a/b.ts")];
        expect(placeOf([trail], 9)).toEqual({ line: 0, index: 1, offset: 1 });
    });

    it("counts the join between lines as one character, and finds an empty line", () => {
        const lines: EditorLine[] = [[text("ab")], [], [pill("c/d.ts"), text("e")]];
        expect(linesText(lines)).toBe("ab\n\n@c/d.tse");
        const cases: [number, EditorPlace][] = [
            [0, { line: 0, index: 0, offset: 0 }],
            [2, { line: 0, index: 0, offset: 2 }],
            [3, { line: 1, index: 0, offset: 0 }], // the empty line
            [4, { line: 2, index: 0, offset: 0 }], // before the pill that opens line 3
            [11, { line: 2, index: 0, offset: 1 }], // just after that pill
            [12, { line: 2, index: 1, offset: 1 }],
        ];
        for (const [plain, place] of cases) {
            expect(placeOf(lines, plain)).toEqual(place);
            expect(placeOffset(lines, place)).toBe(plain);
        }
        expect(placeOf(lines, 99)).toEqual({ line: 2, index: 1, offset: 1 });
    });
});

describe("adjacentPill", () => {
    // "ab" [pill] "cd" [pill] [pill] ⏎ [pill]
    const line: EditorLine = [
        text("ab"),
        pill("a/1.ts"),
        text("cd"),
        pill("b/2.ts"),
        pill("c/3.ts"),
        BR,
        pill("d/4.ts"),
    ];

    it("finds the pill a Backspace would take: the one just behind the caret", () => {
        expect(adjacentPill(line, 1, 1, true)).toBe(1); // after a pill
        expect(adjacentPill(line, 2, 0, true)).toBe(1); // at the start of the text that follows it
        expect(adjacentPill(line, 0, 2, true)).toBeNull(); // before a pill: nothing behind but text
        expect(adjacentPill(line, 2, 1, true)).toBeNull(); // inside text
        expect(adjacentPill(line, 4, 0, true)).toBe(3); // between two pills
        expect(adjacentPill(line, 4, 1, true)).toBe(4);
    });

    it("finds the pill a Delete would take: the one just ahead of the caret", () => {
        expect(adjacentPill(line, 0, 2, false)).toBe(1); // end of text, pill next
        expect(adjacentPill(line, 1, 0, false)).toBe(1); // before a pill
        expect(adjacentPill(line, 1, 1, false)).toBeNull(); // after a pill, text next
        expect(adjacentPill(line, 2, 2, false)).toBe(3);
        expect(adjacentPill(line, 3, 1, false)).toBe(4);
        expect(adjacentPill(line, 0, 1, false)).toBeNull(); // inside text
    });

    it("does not reach over a line break", () => {
        expect(adjacentPill(line, 6, 0, true)).toBeNull(); // the pill opening line two: only the break behind
        expect(adjacentPill(line, 4, 1, false)).toBeNull(); // the break ahead of the pill that closes line one
        expect(adjacentPill(line, 5, 1, false)).toBe(6); // after the break, the pill is ahead
    });

    it("is null in an empty line or past the segments", () => {
        expect(adjacentPill([], 0, 0, true)).toBeNull();
        expect(adjacentPill([], 0, 0, false)).toBeNull();
        expect(adjacentPill(line, 99, 0, true)).toBeNull();
    });
});
