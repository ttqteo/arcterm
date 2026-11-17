// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import type { Html, Paragraph, Root, Text } from "mdast";
import type { Plugin } from "unified";
import { visit } from "unist-util-visit";

// HTML elements that take no closing tag
const VOID = new Set([
    "area",
    "base",
    "br",
    "col",
    "embed",
    "hr",
    "img",
    "input",
    "link",
    "meta",
    "source",
    "track",
    "wbr",
]);

// one tag: its slash for a closing tag, its name, its trailing slash for a self-closing one
const TAG = /<(\/?)([A-Za-z][A-Za-z0-9-]*)(?:\s[^<>]*?)?(\/?)>/g;
// the nodes that hold inline content: an html node inside one is inline HTML
const PHRASING_PARENTS = new Set(["paragraph", "heading", "emphasis", "strong", "delete", "link", "tableCell"]);
// an html node that is a single opening tag and nothing else
const LONE_OPEN = /^<([A-Za-z][A-Za-z0-9-]*)(?:\s[^<>]*?)?>$/;

// A placeholder in angle brackets ("<a complete Node CommonJS script>", "<name>") reads to CommonMark as raw HTML, and
// rehype-raw then opens an element that never closes: everything after it turns into a link, or vanishes into an
// element the sanitizer drops. An opening tag no later tag closes was not written as HTML, so this turns it back into
// the text it was. Tags pair in document order, by name; a void element and a self-closing tag need no partner.
const remarkLoneTags: Plugin<[], Root> = function () {
    return (tree: Root) => {
        const nodes: Html[] = [];
        // a node on a line of its own (CommonMark's HTML block) sits among blocks, where text needs a paragraph
        const block = new Set<Html>();
        visit(tree, "html", (node: Html, _index, parent) => {
            nodes.push(node);
            if (parent != null && !PHRASING_PARENTS.has(parent.type)) {
                block.add(node);
            }
        });
        // the nodes still open, by tag name, innermost last
        const open = new Map<string, Html[]>();
        const lone = new Set<Html>();
        for (const node of nodes) {
            for (const m of node.value.matchAll(TAG)) {
                const [, closing, rawName, selfClosing] = m;
                const name = rawName.toLowerCase();
                if (VOID.has(name) || selfClosing === "/") {
                    continue;
                }
                const stack = open.get(name) ?? [];
                if (closing === "/") {
                    const opener = stack.pop();
                    if (opener != null) {
                        lone.delete(opener);
                    }
                    continue;
                }
                stack.push(node);
                open.set(name, stack);
                if (LONE_OPEN.test(node.value.trim())) {
                    lone.add(node);
                }
            }
        }
        for (const node of lone) {
            if (block.has(node)) {
                // turned in place, so the node keeps its position for the source-line marks
                const para = node as unknown as Paragraph;
                const text: Text = { type: "text", value: node.value, position: node.position };
                para.type = "paragraph";
                para.children = [text];
                delete (para as unknown as Partial<Html>).value;
            } else {
                (node as unknown as Text).type = "text";
            }
        }
    };
};

export default remarkLoneTags;
