// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Stamps each block of rendered markdown with the file lines it came from (data-src-start / data-src-end), so a
// selection or a click in the view maps back to the source (docs/superpowers/specs/2026-10-06-md-comments-design.md).
// It works on the HTML tree, where a fenced code block's position is on its pre, and runs before rehype-raw: raw
// HTML, parsed later, has no stamp and cannot be commented on.

import type { Element, Root } from "hast";
import { visit } from "unist-util-visit";

const STAMPED = new Set(["p", "h1", "h2", "h3", "h4", "h5", "h6", "li", "pre", "hr", "table", "tr", "img"]);

// the hast property names rehype-sanitize must let through
export const SRC_LINE_PROPS = ["dataSrcStart", "dataSrcEnd"];

// offset: the file lines above the text that was parsed (a frontmatter block lifted off the top)
export function rehypeSrcLines(opts: { offset?: number } = {}) {
    const offset = opts.offset ?? 0;
    return (tree: Root) => {
        visit(tree, "element", (node: Element) => {
            const pos = node.position;
            if (pos == null || !STAMPED.has(node.tagName)) {
                return;
            }
            node.properties.dataSrcStart = pos.start.line + offset;
            node.properties.dataSrcEnd = pos.end.line + offset;
        });
    };
}

type SchemaAttributes = Record<string, unknown[]>;

// a sanitize schema that keeps the stamps on every element
export function withSrcLineAttributes<S extends object>(schema: S): S {
    const attrs: SchemaAttributes = (schema as { attributes?: SchemaAttributes }).attributes ?? {};
    return { ...schema, attributes: { ...attrs, "*": [...(attrs["*"] ?? []), ...SRC_LINE_PROPS] } } as S;
}
