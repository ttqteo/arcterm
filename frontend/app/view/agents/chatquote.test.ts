// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { joinQuotes, quoteLines, quoteWords, splitQuotes, withLeadQuote, withQuote } from "./chatquote";

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

describe("splitQuotes", () => {
    it("takes the quote a Reply put in an empty box", () => {
        expect(splitQuotes("> passage\n\n")).toEqual({ quotes: ["> passage"], body: "" });
    });

    it("takes several quotes and leaves the question", () => {
        expect(splitQuotes("> a\n> b\n\n> c\n\nwhy?")).toEqual({ quotes: ["> a\n> b", "> c"], body: "why?" });
    });

    it("keeps a quote line still being typed as text", () => {
        expect(splitQuotes("> typing")).toEqual({ quotes: [], body: "> typing" });
        expect(splitQuotes("> typing\n")).toEqual({ quotes: [], body: "> typing\n" });
    });

    it("leaves a quote under typed text in the body", () => {
        expect(splitQuotes("hello\n\n> a\n\n")).toEqual({ quotes: [], body: "hello\n\n> a\n\n" });
    });

    it("keeps a bare > line inside a quote", () => {
        expect(splitQuotes("> a\n>\n> b\n\nx")).toEqual({ quotes: ["> a\n>\n> b"], body: "x" });
    });

    it("round-trips through joinQuotes, blank lines in the body included", () => {
        for (const t of ["> a\n\n\nx", "> a\n\n", "> a\n\n> b", "plain", "", "> a\n\n> b\n"]) {
            const { quotes, body } = splitQuotes(t);
            expect(joinQuotes(quotes, body)).toBe(t);
        }
    });
});

describe("withLeadQuote", () => {
    it("puts a new quote after the quotes and before the question", () => {
        expect(withLeadQuote("> a\n\nwhy?", "b")).toBe("> a\n\n> b\n\nwhy?");
    });

    it("puts the quote above text typed before the Reply", () => {
        expect(withLeadQuote("why?", "b")).toBe("> b\n\nwhy?");
    });

    it("answers null for a selection with no text", () => {
        expect(withLeadQuote("x", " ")).toBeNull();
    });
});

describe("quoteWords", () => {
    it("drops the marks and blank lines, keeping one line per line", () => {
        expect(quoteWords("> a\n>\n> b\n> c")).toBe("a\nb\nc");
    });
});
