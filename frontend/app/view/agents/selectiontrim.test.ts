// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { endsInBreak, inkEnd } from "./selectiontrim";

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
