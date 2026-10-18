// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { markSpans } from "./markdownmarks";

// each span as the text it marks
function marked(text: string): string[] {
    const lines = text.split("\n");
    return markSpans(text).map(({ line, open, close }) => lines[line - 1]!.slice(open - 1 + 2, close - 1));
}

describe("markSpans", () => {
    it("finds a mark's columns", () => {
        expect(markSpans("ab ==cd== e")).toEqual([{ line: 1, open: 4, close: 8 }]);
    });

    it("finds several marks, on several lines", () => {
        expect(marked("==a== and ==b c==\nplain\n1. ==d==")).toEqual(["a", "b c", "d"]);
    });

    it("leaves == with a space inside it, and an unclosed one", () => {
        expect(marked("a == b and c == d")).toEqual([]);
        expect(marked("==a ==")).toEqual([]);
        expect(marked("x==y")).toEqual([]);
    });

    it("holds inline code and markup, and never marks inside code", () => {
        expect(marked("==use `x` and **y**== now")).toEqual(["use `x` and **y**"]);
        expect(marked("`==a==` and")).toEqual([]);
        expect(marked("```\n==a==\n```\n==b==")).toEqual(["b"]);
    });

    it("keeps a mark to one line", () => {
        expect(marked("==one\ntwo==")).toEqual([]);
    });
});
