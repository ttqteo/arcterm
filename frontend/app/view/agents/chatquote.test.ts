// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { splitPastes, withPaste } from "./chatpastes";
import { quoteBlock, quoteLines, quoteLocation, withChatQuote, withQuote } from "./chatquote";

describe("quoteLines", () => {
    it("prefixes each line", () => {
        expect(quoteLines("Oracle chưa được kiểm tay.\nMọi con số đều dựa vào nó.")).toBe(
            "> Oracle chưa được kiểm tay.\n> Mọi con số đều dựa vào nó."
        );
    });

    it("trims blank edges and keeps one blank quote line between paragraphs", () => {
        expect(quoteLines("\n\n  first  \n\n\n\nsecond\n\n")).toBe(">   first\n>\n> second");
    });

    it("normalises CRLF and non-breaking spaces", () => {
        expect(quoteLines("a\u00a0b\r\nc")).toBe("> a b\n> c");
    });

    it("answers empty for a selection with no text", () => {
        expect(quoteLines(" \n\t\n")).toBe("");
    });
});

describe("withQuote", () => {
    it("puts the quote in an empty box with a blank line for the question", () => {
        expect(withQuote("", "passage")).toBe("> passage\n\n");
    });

    it("adds under what is already typed", () => {
        expect(withQuote("why?\n", "passage")).toBe("why?\n\n> passage\n\n");
    });

    it("stacks a second quote under the first", () => {
        expect(withQuote(withQuote("", "one")!, "two")).toBe("> one\n\n> two\n\n");
    });

    it("takes nothing from an empty selection", () => {
        expect(withQuote("draft", "  ")).toBeNull();
    });
});

describe("withChatQuote", () => {
    it("puts quote, text, quote in the order they came", () => {
        const once = withChatQuote("", "a")!;
        const typed = once + "why?";
        expect(withChatQuote(typed, "b")).toBe("> a\n\nwhy?\n\n> b\n\n");
    });

    it("puts the quote before the folded pastes, after what is typed", () => {
        const full = withPaste("why?", "x\n".repeat(20));
        const next = withChatQuote(full, "b")!;
        const { body, pastes } = splitPastes(next);
        expect(body).toBe("why?\n\n> b\n\n");
        expect(pastes).toEqual(splitPastes(full).pastes);
    });

    it("answers null for a selection with no text", () => {
        expect(withChatQuote("x", " ")).toBeNull();
    });
});

describe("quote from a file", () => {
    const from = { path: "harnesspov/results/study/PREREG.md", startLine: 42, endLine: 44 };

    it("names one line as :N and a range as :N-M", () => {
        expect(quoteLocation({ path: "a.ts", startLine: 7, endLine: 7 })).toBe("a.ts:7");
        expect(quoteLocation(from)).toBe("harnesspov/results/study/PREREG.md:42-44");
    });

    it("puts the location line over the quote lines", () => {
        expect(quoteBlock("first\nsecond", from)).toBe("harnesspov/results/study/PREREG.md:42-44\n> first\n> second");
    });

    it("leaves the location out for a quote not from a file, and answers empty for no text", () => {
        expect(quoteBlock("x")).toBe("> x");
        expect(quoteBlock("  \n", from)).toBe("");
    });

    it("lands after the typed text and before the folded pastes, the caret line under it", () => {
        const full = withPaste("why?", "x\n".repeat(20));
        const { body, pastes } = splitPastes(withChatQuote(full, "b", { path: "a.md", startLine: 3, endLine: 3 })!);
        expect(body).toBe("why?\n\na.md:3\n> b\n\n");
        expect(pastes).toEqual(splitPastes(full).pastes);
    });

    it("stacks a second file quote under the first", () => {
        const once = withChatQuote("", "one", { path: "a.md", startLine: 1, endLine: 2 })!;
        expect(withChatQuote(once, "two", { path: "b.ts", startLine: 9, endLine: 9 })).toBe(
            "a.md:1-2\n> one\n\nb.ts:9\n> two\n\n"
        );
    });

    it("takes nothing from an empty selection", () => {
        expect(withChatQuote("x", " ", from)).toBeNull();
    });
});
