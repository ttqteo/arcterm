// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import type { Element, RootContent as HastContent, Root as HastRoot } from "hast";
import rehypeRaw from "rehype-raw";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified } from "unified";
import { describe, expect, it } from "vitest";
import remarkLoneTags from "./remark-lone-tags";

// the rendered tree as Markdown's Preview builds it (raw HTML on), with or without the plugin
function render(md: string, lone = true): HastRoot {
    const proc = unified().use(remarkParse).use(remarkGfm);
    if (lone) {
        proc.use(remarkLoneTags);
    }
    proc.use(remarkRehype, { allowDangerousHtml: true }).use(rehypeRaw);
    return proc.runSync(proc.parse(md)) as HastRoot;
}

function tags(node: HastRoot | HastContent): string[] {
    const own = node.type === "element" ? [(node as Element).tagName] : [];
    return "children" in node ? [...own, ...node.children.flatMap(tags)] : own;
}

function text(node: HastRoot | HastContent): string {
    if (node.type === "text") {
        return node.value;
    }
    return "children" in node ? node.children.map(text).join("") : "";
}

// the line from a prompt template that turned the rest of its Preview into one link (2026-11-17)
const template = [
    "Output contract:",
    '  - to submit:  {"class":"<proto|cmdinj>","script":"<a complete Node CommonJS script>"}',
    "{tool_clause}The grader runs your script with `node`.",
    "",
    "Phrasing: keep it short.",
].join("\n");

describe("remarkLoneTags", () => {
    it("shows a placeholder that reads as an unclosed tag as its text", () => {
        expect(tags(render(template, false))).toContain("a");
        const tree = render(template);
        expect(tags(tree)).not.toContain("a");
        expect(text(tree)).toContain('"script":"<a complete Node CommonJS script>"}');
        expect(text(tree)).toContain("Phrasing: keep it short.");
    });
    it("keeps HTML that closes", () => {
        expect(tags(render('see <a href="x">here</a> and <kbd>Ctrl</kbd>'))).toEqual(
            expect.arrayContaining(["a", "kbd"])
        );
        expect(tags(render("<details>\n<summary>More</summary>\n\nbody\n\n</details>"))).toEqual(
            expect.arrayContaining(["details", "summary"])
        );
    });
    it("keeps void and self-closing tags", () => {
        expect(tags(render("one<br>two <img src=x> <span/>"))).toEqual(expect.arrayContaining(["br", "img"]));
    });
    it("pairs by order: the stray opener before a real link is the one shown as text", () => {
        const tree = render('<a stray> then <a href="x">real</a>');
        expect(text(tree)).toContain("<a stray>");
        expect(tags(tree).filter((t) => t === "a")).toHaveLength(1);
    });
    it("turns a lone tag on a line of its own into a paragraph", () => {
        const tree = render("before\n\n<name>\n\nafter");
        expect(text(tree)).toContain("<name>");
        expect(tags(tree)).toEqual(["p", "p", "p"]);
    });
});
