// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { codePaste, inlineCodeSpans, lineMarks, looksLikeCode, markRuns, quoteBlocks } from "./chatmarks";

const STACK = [
    "    at ReleaseDetail (http://localhost:4310/src/components/releases/ReleaseDetail.tsx?t=1794992591545:38:41)",
    "    at div",
    "    at ReleasesApp (http://localhost:4310/src/components/releases/ReleasesApp.tsx:8:39)",
    "",
    "Consider adding an error boundary to your tree to customize error handling behavior.",
    "Visit https://reactjs.org/link/error-boundaries to learn more about error boundaries.",
    "react-dom.development.js:26962 Uncaught TypeError: Cannot read properties of undefined (reading 'filter')",
    "    at MergeChecks (MergeChecks.tsx:11:38)",
].join("\r\n");

describe("inlineCodeSpans", () => {
    it("pairs runs of the same length", () => {
        expect(inlineCodeSpans("run `npm test` then ``a ` b``")).toEqual([
            [4, 14],
            [20, 29],
        ]);
    });
    it("leaves a run with no partner as text", () => {
        expect(inlineCodeSpans("a ` b")).toEqual([]);
        expect(inlineCodeSpans("``a` b")).toEqual([]);
    });
});

describe("lineMarks", () => {
    it("draws quotes and inline code outside fences only", () => {
        const marks = lineMarks(["> see `x`", "```", "> `y`", "```", "plain `z`"]);
        expect(marks.map((m) => [m.fenced, m.quote, m.spans.length])).toEqual([
            [false, true, 1],
            [true, false, 0],
            [true, false, 0],
            [true, false, 0],
            [false, false, 1],
        ]);
    });
    it("draws only fences with inline off", () => {
        expect(lineMarks(["> `a`"], { inline: false })[0]).toEqual({ fenced: false, quote: false, spans: [] });
    });
});

describe("markRuns", () => {
    const [mark] = lineMarks(["> run `npm test` now"]);
    it("cuts a node at the span's ends", () => {
        expect(markRuns(mark, 0, 20).map((r) => [r.start, r.end, r.mark.inline])).toEqual([
            [0, 6, false],
            [6, 16, true],
            [16, 20, false],
        ]);
        expect(markRuns(mark, 0, 20).every((r) => r.mark.quote)).toBe(true);
    });
    it("is one run for a node inside the span", () => {
        expect(markRuns(mark, 8, 12)).toEqual([{ start: 8, end: 12, mark: { code: true, inline: true, quote: true } }]);
    });
    it("is one run for a fenced line", () => {
        const [fenced] = lineMarks(["```", "x"]);
        expect(markRuns(fenced, 0, 3)).toEqual([
            { start: 0, end: 3, mark: { code: true, inline: false, quote: false } },
        ]);
    });
});

describe("quoteBlocks", () => {
    it("joins consecutive quote lines", () => {
        expect(quoteBlocks(lineMarks(["> a", "> b", "c", ">d"]))).toEqual([
            [0, 1],
            [3, 3],
        ]);
    });
});

describe("looksLikeCode", () => {
    it("takes a stack trace", () => {
        expect(looksLikeCode(STACK)).toBe(true);
    });
    it("takes code", () => {
        expect(looksLikeCode("function f(a) {\n  return a + 1;\n}")).toBe(true);
        expect(looksLikeCode("2026-11-18 10:02:11 INFO start\n2026-11-18 10:02:12 ERROR boom")).toBe(true);
    });
    it("leaves prose, lists, quotes and one line", () => {
        expect(looksLikeCode("Mình đã thử lại.\nVẫn lỗi như cũ, bạn xem giúp.")).toBe(false);
        expect(looksLikeCode("- one\n- two\n- three")).toBe(false);
        expect(looksLikeCode("> quoted\n> more")).toBe(false);
        expect(looksLikeCode("const a = 1;")).toBe(false);
    });
    it("leaves a paste that is fenced already", () => {
        expect(looksLikeCode("```\nconst a = 1;\nconst b = 2;\n```")).toBe(false);
    });
});

describe("codePaste", () => {
    const code = "const a = 1;\r\nconst b = 2;\r\n\r\n";
    it("fences a paste at the start of an empty box", () => {
        expect(codePaste("", 0, 0, code)).toEqual({
            raw: "const a = 1;\nconst b = 2;\n\n",
            fenced: "```\nconst a = 1;\nconst b = 2;\n```",
        });
    });
    it("puts the fence on lines of its own", () => {
        expect(codePaste("look: ", 6, 6, code)?.fenced).toBe("\n```\nconst a = 1;\nconst b = 2;\n```");
        expect(codePaste("look: X then", 6, 7, code)?.fenced).toBe("\n```\nconst a = 1;\nconst b = 2;\n```\n");
    });
    it("is null for prose and inside a fence", () => {
        expect(codePaste("", 0, 0, "hello\nworld")).toBeNull();
        expect(codePaste("```\n", 4, 4, code)).toBeNull();
    });
});
