// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import type { Root, RootContent } from "mdast";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";
import { describe, expect, it } from "vitest";
import remarkQuoteBreaks from "./remark-quote-breaks";

// the tree as text: a hard break is "|", a quote is "> [...]", inline markup keeps its markers
function flat(node: Root | RootContent): string {
    switch (node.type) {
        case "text":
            return node.value;
        case "break":
            return "|";
        case "inlineCode":
            return "`" + node.value + "`";
        case "code":
            return "```" + node.value + "```";
        case "strong":
            return "**" + node.children.map(flat).join("") + "**";
        case "blockquote":
            return "> [" + node.children.map(flat).join(" / ") + "]";
        case "root":
            return node.children.map(flat).join(" / ");
        default:
            return "children" in node ? node.children.map(flat).join("") : "";
    }
}

function parse(md: string): string {
    const processor = unified().use(remarkParse).use(remarkGfm).use(remarkQuoteBreaks);
    return flat(processor.runSync(processor.parse(md)) as Root);
}

describe("remarkQuoteBreaks", () => {
    it("keeps each source line of a quote on its own line", () => {
        expect(parse("> [15:06] A: one\n> [15:07] B: two\n> [15:08] A: three\n")).toBe(
            "> [[15:06] A: one|[15:07] B: two|[15:08] A: three]"
        );
    });

    it("breaks lines around inline markup inside a quote", () => {
        expect(parse("> **Phan Duy:** uhm\n> next `code` line\n")).toBe("> [**Phan Duy:** uhm|next `code` line]");
    });

    it("leaves soft breaks outside quotes as CommonMark joins them", () => {
        expect(parse("one line\nsame paragraph\n")).toBe("one line\nsame paragraph");
    });

    it("leaves a code block inside a quote alone", () => {
        expect(parse("> ```\n> a\n> b\n> ```\n")).toBe("> [```a\nb```]");
    });
});
