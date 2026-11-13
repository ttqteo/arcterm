// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { endsInBreak, inkEnd, lineCount } from "./selectiontrim";

describe("lineCount", () => {
    it("counts one line for boxes that share it, a bold run and a code span included", () => {
        // text 152–170, <strong> 152–170, <code> a little lower and shorter on the same line
        expect(
            lineCount([
                { top: 152, bottom: 170 },
                { top: 152, bottom: 170 },
                { top: 154.5, bottom: 168 },
            ])
        ).toBe(1);
    });

    it("counts each wrapped line once, in any order", () => {
        const line = (n: number) => ({ top: 152 + n * 25.4, bottom: 170 + n * 25.4 });
        expect(lineCount([line(0), line(2), line(1), line(0)])).toBe(3);
    });

    it("counts no line for no boxes, and skips the empty ones", () => {
        expect(lineCount([])).toBe(0);
        expect(lineCount([{ top: 200, bottom: 200 }])).toBe(0);
    });
});

describe("inkEnd", () => {
    it("is where the trailing whitespace begins", () => {
        expect(inkEnd("đề xuất.\n")).toBe(8);
        expect(inkEnd("a b \n")).toBe(3);
    });

    it("is the length for text that ends on a character, and 0 for whitespace alone", () => {
        expect(inkEnd("two\nlines")).toBe(9);
        expect(inkEnd("\n ")).toBe(0);
        expect(inkEnd("")).toBe(0);
    });
});

describe("endsInBreak", () => {
    it("is true for a line with the break a triple-click takes in", () => {
        expect(endsInBreak("Không có luật build đi.\n")).toBe(true);
        expect(endsInBreak("trailing space ")).toBe(true);
    });

    it("is false once the text ends on a character, or holds only whitespace", () => {
        expect(endsInBreak("Không có luật build đi.")).toBe(false);
        expect(endsInBreak("\n")).toBe(false);
        expect(endsInBreak("")).toBe(false);
    });
});
