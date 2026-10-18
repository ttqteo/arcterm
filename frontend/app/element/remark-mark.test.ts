// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import type { Root, RootContent } from "mdast";
import { toHast } from "mdast-util-to-hast";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";
import { describe, expect, it } from "vitest";
import remarkMark from "./remark-mark";

// the tree as text: a mark is "[...]", inline markup keeps its markers
function flat(node: Root | RootContent): string {
    switch (node.type as string) {
        case "text":
            return (node as { value: string }).value;
        case "inlineCode":
            return "`" + (node as { value: string }).value + "`";
        case "code":
            return "```" + (node as { value: string }).value + "```";
        case "strong":
            return "**" + (node as { children: RootContent[] }).children.map(flat).join("") + "**";
        case "mark":
            return "[" + (node as { children: RootContent[] }).children.map(flat).join("") + "]";
        case "root":
            return (node as Root).children.map(flat).join(" / ");
        default:
            return "children" in node ? (node.children as RootContent[]).map(flat).join("") : "";
    }
}

function parse(md: string): Root {
    const processor = unified().use(remarkParse).use(remarkGfm).use(remarkMark);
    return processor.runSync(processor.parse(md)) as Root;
}

const marked = (md: string) => flat(parse(md));

describe("remarkMark", () => {
    it("wraps ==text== in a mark and drops the marks", () => {
        expect(marked("Hình thức: ==10 phút trình bày==, sau đó hỏi đáp.")).toBe(
            "Hình thức: [10 phút trình bày], sau đó hỏi đáp."
        );
    });

    it("finds several marks on a line", () => {
        expect(marked("==a== and ==b c==")).toBe("[a] and [b c]");
    });

    it("leaves == with a space after the opener or before the closer as written", () => {
        expect(marked("a == b and c == d")).toBe("a == b and c == d");
        expect(marked("==a ==")).toBe("==a ==");
    });

    it("keeps an unclosed == as written", () => {
        expect(marked("x==y and more")).toBe("x==y and more");
    });

    it("holds inline markup inside a mark", () => {
        expect(marked("==Bộ phân loại là **LightGBM**== cố định")).toBe("[Bộ phân loại là **LightGBM**] cố định");
        expect(marked("==**bold**== after")).toBe("[**bold**] after");
    });

    it("draws a mark inside bold", () => {
        expect(marked("**==x==**")).toBe("**[x]**");
    });

    it("never marks code", () => {
        expect(marked("`==a==` and")).toBe("`==a==` and");
        expect(marked("```\n==a==\n```")).toBe("```==a==```");
    });

    it("marks list items, headings and table cells", () => {
        expect(marked("1. ==a== b")).toBe("[a] b");
        expect(marked("## ==Head==")).toBe("[Head]");
        expect(marked("| a |\n|---|\n| ==b== |")).toBe("ab".replace("b", "[b]"));
    });

    it("compiles a mark to a <mark> element", () => {
        const hast = toHast(parse("say ==this==")) as unknown as { children: any[] };
        const p = hast.children[0];
        expect(p.children.map((c: any) => c.tagName ?? c.value)).toEqual(["say ", "mark"]);
        expect(p.children[1].children[0].value).toBe("this");
    });
});
