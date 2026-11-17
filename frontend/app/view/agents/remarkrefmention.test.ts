// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import type { Root, RootContent } from "mdast";
import { toHast } from "mdast-util-to-hast";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";
import { describe, expect, it } from "vitest";
import remarkFileMention from "./remarkfilemention";
import remarkRefMention, { splitRefs } from "./remarkrefmention";

function parse(md: string): Root {
    const processor = unified().use(remarkParse).use(remarkGfm).use(remarkRefMention);
    return processor.runSync(processor.parse(md)) as Root;
}

// every refmention node in the tree, in order, wherever it sits
function refs(node: Root | RootContent): any[] {
    const out: any[] = [];
    if ((node.type as string) === "refmention") {
        out.push(node);
    }
    if ("children" in node) {
        for (const child of node.children as RootContent[]) {
            out.push(...refs(child));
        }
    }
    return out;
}

// the tree as text, each reference shown as {raw}
function flat(node: Root | RootContent): string {
    switch (node.type as string) {
        case "text":
            return (node as { value: string }).value;
        case "inlineCode":
            return "`" + (node as { value: string }).value + "`";
        case "code":
            return "```" + (node as { value: string }).value + "```";
        case "refmention":
            return "{" + (node as any).data.hProperties.raw + "}";
        default:
            return "children" in node ? (node.children as RootContent[]).map(flat).join("") : "";
    }
}

describe("splitRefs", () => {
    it("splits text into text and refmention nodes, keeping the token as the node's text", () => {
        const parts = splitRefs("có gồm agent:7cd99627 không?")!;
        expect(parts.map((p) => p.type)).toEqual(["text", "refmention", "text"]);
        expect((parts[1] as any).data.hProperties).toEqual({ kind: "agent", id: "7cd99627", raw: "agent:7cd99627" });
        expect((parts[1] as any).children[0].value).toBe("agent:7cd99627");
    });

    it("is null with no reference", () => {
        expect(splitRefs("no refs here")).toBeNull();
    });

    it("keeps the @ and the case as written in the text and in raw, and reads tab: as an agent", () => {
        const parts = splitRefs("ask @Tab:7CD99627 now")!;
        const ref = parts[1] as any;
        expect(ref.children[0].value).toBe("@Tab:7CD99627");
        expect(ref.data.hProperties).toEqual({ kind: "agent", id: "7cd99627", raw: "@Tab:7CD99627" });
    });

    it("joins back to the text it was given, whatever the references are", () => {
        const value = "see run:071a8e3b, then (council:0123abcd-4567) and agent:7cd99627.";
        const parts = splitRefs(value)!;
        const joined = parts
            .map((p) => ("children" in p ? (p.children[0] as { value: string }).value : (p as { value: string }).value))
            .join("");
        expect(joined).toBe(value);
        expect(parts.filter((p) => (p.type as string) === "refmention")).toHaveLength(3);
    });
});

describe("remarkRefMention", () => {
    it("turns agent:, run: and council: tokens into refmention nodes and leaves the rest as text", () => {
        const tree = parse("agent:7cd99627 run:071a8e3b council:0123abcd, session:7cd99627 effort:7cd99627");
        const found = refs(tree);
        expect(found.map((n) => n.data.hProperties.kind)).toEqual(["agent", "run", "council"]);
        expect(found.map((n) => n.data.hName)).toEqual(["refmention", "refmention", "refmention"]);
        expect(flat(tree)).toBe("{agent:7cd99627} {run:071a8e3b} {council:0123abcd}, session:7cd99627 effort:7cd99627");
    });

    it("finds references in list items, headings, table cells and bold", () => {
        expect(refs(parse("- agent:7cd99627\n- run:071a8e3b"))).toHaveLength(2);
        expect(refs(parse("## agent:7cd99627"))).toHaveLength(1);
        expect(refs(parse("| a |\n|---|\n| run:071a8e3b |"))).toHaveLength(1);
        expect(refs(parse("**agent:7cd99627**"))).toHaveLength(1);
        expect(refs(parse("*run:071a8e3b*"))).toHaveLength(1);
    });

    it("changes nothing inside inline code or a code block", () => {
        const tree = parse("`agent:7cd99627` and\n\n```\nrun:071a8e3b\n```");
        expect(refs(tree)).toHaveLength(0);
        expect(flat(tree)).toBe("`agent:7cd99627` and```run:071a8e3b```");
    });

    it("changes nothing inside a link", () => {
        const tree = parse(
            "[see agent:7cd99627](https://example.com/x) and [run:071a8e3b][ref]\n\n[ref]: https://example.com/y"
        );
        expect(refs(tree)).toHaveLength(0);
    });

    it("leaves a token with a short id, or not its own word, as text", () => {
        expect(refs(parse("agent:7cd run:071a8e3bzz xagent:7cd99627"))).toHaveLength(0);
    });

    it("runs beside the file-mention plugin: a path is a filemention, an @agent: token a refmention", () => {
        const processor = unified().use(remarkParse).use(remarkGfm).use(remarkFileMention).use(remarkRefMention);
        const tree = processor.runSync(
            processor.parse("open @src/app.ts for @agent:7cd99627 and run:071a8e3b")
        ) as Root;
        const kinds: string[] = [];
        const walk = (n: Root | RootContent) => {
            if (n.type === ("filemention" as string) || n.type === ("refmention" as string)) {
                kinds.push(n.type);
            }
            if ("children" in n) {
                (n.children as RootContent[]).forEach(walk);
            }
        };
        walk(tree);
        expect(kinds).toEqual(["filemention", "refmention", "refmention"]);
    });

    it("compiles to an element named refmention that carries kind, id and raw", () => {
        const hast = toHast(parse("see @agent:7CD99627")) as unknown as { children: any[] };
        const p = hast.children[0];
        const el = p.children.find((c: any) => c.tagName === "refmention");
        expect(el).toBeDefined();
        expect(el.properties).toEqual({ kind: "agent", id: "7cd99627", raw: "@agent:7CD99627" });
        expect(el.children[0].value).toBe("@agent:7CD99627");
    });
});
