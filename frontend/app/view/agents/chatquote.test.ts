// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { splitPastes, withPaste } from "./chatpastes";
import { quoteLines, withChatQuote, withQuote } from "./chatquote";

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
