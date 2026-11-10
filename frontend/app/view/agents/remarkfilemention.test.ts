// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import type { Root, RootContent } from "mdast";
import { toHast } from "mdast-util-to-hast";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";
import { describe, expect, it } from "vitest";
import remarkFileMention from "./remarkfilemention";

function parse(md: string): Root {
    const processor = unified().use(remarkParse).use(remarkGfm).use(remarkFileMention);
    return processor.runSync(processor.parse(md)) as Root;
}

// every filemention node in the tree, in order, wherever it sits
function mentions(node: Root | RootContent): any[] {
    const out: any[] = [];
    if ((node.type as string) === "filemention") {
        out.push(node);
    }
    if ("children" in node) {
        for (const child of node.children as RootContent[]) {
            out.push(...mentions(child));
        }
    }
    return out;
}

// the tree as text, each mention shown as {path}
function flat(node: Root | RootContent): string {
    switch (node.type as string) {
        case "text":
            return (node as { value: string }).value;
        case "inlineCode":
            return "`" + (node as { value: string }).value + "`";
        case "code":
            return "```" + (node as { value: string }).value + "```";
        case "filemention":
            return "{" + (node as any).data.hProperties.path + "}";
        default:
            return "children" in node ? (node.children as RootContent[]).map(flat).join("") : "";
    }
}

describe("remarkFileMention", () => {
    it("turns an @path into a filemention node and leaves @alice as text", () => {
        const tree = parse("see @src/app.ts and @alice");
        const found = mentions(tree);
        expect(found).toHaveLength(1);
        expect(found[0].type).toBe("filemention");
        expect(found[0].data.hName).toBe("filemention");
        expect(found[0].data.hProperties.path).toBe("src/app.ts");
        expect(found[0].children).toEqual([{ type: "text", value: "@src/app.ts" }]);
        expect(flat(tree)).toBe("see {src/app.ts} and @alice");
    });

    it("keeps the text around a mention, and the @ token as written", () => {
        // trailing punctuation is not part of the path, so it stays text after the node
        expect(flat(parse("open @a/b.md, then @c.txt."))).toBe("open {a/b.md}, then {c.txt}.");
        expect(mentions(parse("@a/b.md"))[0].children[0].value).toBe("@a/b.md");
    });

    it("reads a quoted path with a space, and keeps the quotes in the text", () => {
        const found = mentions(parse('read @"C:/My Files/a b.md" now'));
        expect(found).toHaveLength(1);
        expect(found[0].data.hProperties.path).toBe("C:/My Files/a b.md");
        expect(found[0].children[0].value).toBe('@"C:/My Files/a b.md"');
    });

    it("finds mentions in list items, headings and table cells", () => {
        expect(mentions(parse("- @a/b.ts\n- @c/d.ts"))).toHaveLength(2);
        expect(mentions(parse("## @a/b.ts"))).toHaveLength(1);
        expect(mentions(parse("| a |\n|---|\n| @a/b.ts |"))).toHaveLength(1);
    });

    it("finds a mention inside bold or emphasis", () => {
        expect(mentions(parse("**@a/b.ts**"))).toHaveLength(1);
        expect(mentions(parse("*@a/b.ts*"))).toHaveLength(1);
    });

    it("leaves an email, a plain @name and a bare @ alone", () => {
        expect(mentions(parse("mail me@host.com or @alice or @ here"))).toHaveLength(0);
    });

    it("changes nothing inside inline code or a code block", () => {
        const tree = parse("`@src/app.ts` and\n\n```\n@src/app.ts\n```");
        expect(mentions(tree)).toHaveLength(0);
        expect(flat(tree)).toBe("`@src/app.ts` and```@src/app.ts```");
    });

    it("changes nothing inside a link", () => {
        const tree = parse(
            "[see @src/app.ts](https://example.com/x) and [@src/b.ts][ref]\n\n[ref]: https://example.com/y"
        );
        expect(mentions(tree)).toHaveLength(0);
    });

    it("compiles to an element named filemention that carries the path", () => {
        const hast = toHast(parse("see @src/app.ts")) as unknown as { children: any[] };
        const p = hast.children[0];
        const el = p.children.find((c: any) => c.tagName === "filemention");
        expect(el).toBeDefined();
        expect(el.properties.path).toBe("src/app.ts");
        expect(el.children[0].value).toBe("@src/app.ts");
    });
});
