// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import type { Element, Root } from "hast";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified } from "unified";
import { visit } from "unist-util-visit";
import { describe, expect, it } from "vitest";
import { rehypeSrcLines, withSrcLineAttributes } from "./rehype-srclines";

// the pipeline markdown.tsx runs, stamps first: "tag start-end" for every stamped element, in document order
function stamps(md: string, offset = 0, schema: object = withSrcLineAttributes(defaultSchema)): string[] {
    const processor = unified()
        .use(remarkParse)
        .use(remarkGfm)
        .use(remarkRehype, { allowDangerousHtml: true })
        .use(rehypeSrcLines, { offset })
        .use(rehypeRaw)
        .use(rehypeSanitize, schema);
    const tree = processor.runSync(processor.parse(md)) as Root;
    const out: string[] = [];
    // a block body: a visitor that returns a number makes visit() skip to that index
    visit(tree, "element", (node: Element) => {
        const p = node.properties ?? {};
        if (p.dataSrcStart != null) {
            out.push(`${node.tagName} ${p.dataSrcStart}-${p.dataSrcEnd}`);
        }
    });
    return out;
}

describe("rehypeSrcLines", () => {
    it("stamps headings and paragraphs with their lines", () => {
        expect(stamps("# Title\n\nOne para\nstill para\n\n## Sub\n")).toEqual(["h1 1-1", "p 3-4", "h2 6-6"]);
    });

    it("adds the offset of a frontmatter block lifted off the top", () => {
        expect(stamps("# Title\n\nOne para\nstill para\n\n## Sub\n", 4)).toEqual(["h1 5-5", "p 7-8", "h2 10-10"]);
    });

    it("stamps a tight list's items, which render no p", () => {
        expect(stamps("- a\n- b\n")).toEqual(["li 1-1", "li 2-2"]);
    });

    it("stamps a loose list's items and their paragraphs on the same lines", () => {
        expect(stamps("- a\n\n- b\n")).toEqual(["li 1-1", "p 1-1", "li 3-3", "p 3-3"]);
    });

    it("gives an item holding a nested list the nested lines too", () => {
        expect(stamps("- a\n  - b\n  - c\n- d\n")).toEqual(["li 1-3", "li 2-2", "li 3-3", "li 4-4"]);
    });

    it("stamps a table and its rows, not the separator", () => {
        expect(stamps("| x | y |\n|---|---|\n| 1 | 2 |\n| 3 | 4 |\n")).toEqual([
            "table 1-4",
            "tr 1-1",
            "tr 3-3",
            "tr 4-4",
        ]);
    });

    it("stamps a fenced code block on its pre, fences included", () => {
        expect(stamps("```js\nconst a = 1;\n```\n")).toEqual(["pre 1-3"]);
    });

    it("stamps an image inside its paragraph", () => {
        expect(stamps("See ![alt](img/a.png) here\n")).toEqual(["p 1-1", "img 1-1"]);
    });

    it("leaves raw HTML unstamped", () => {
        expect(stamps("<div>raw</div>\n\ntext\n")).toEqual(["p 3-3"]);
    });

    it("stamps a thematic break", () => {
        expect(stamps("a\n\n---\n\nb\n")).toEqual(["p 1-1", "hr 3-3", "p 5-5"]);
    });

    it("counts CRLF line endings as lines", () => {
        expect(stamps("one\r\n\r\ntwo\r\n")).toEqual(["p 1-1", "p 3-3"]);
    });

    it("is stripped by a schema that does not allow it", () => {
        expect(stamps("# Title\n", 0, defaultSchema)).toEqual([]);
    });
});
