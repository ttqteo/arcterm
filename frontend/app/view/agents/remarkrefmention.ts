// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// An `agent:<id>`, `tab:<id>`, `run:<id>` or `council:<id>` in a markdown message becomes a `refmention` node, which
// react-markdown draws as a badge (RefBadge, chatrefbadge.tsx). The words that count as a reference are refbadge.ts's, the
// rule the message box shares, so a badge in the box and the badge in your sent bubble agree. The node's text is the
// token as written, `@` and case kept, so the message reads the same with or without the plugin. Only text is split: code
// never holds a text node, and a link keeps its text as written (a badge is itself a button, and one cannot sit inside a
// link).

import type { Parent, PhrasingContent, Root, Text } from "mdast";
import type { Plugin } from "unified";
import { SKIP, visit } from "unist-util-visit";
import { refSpans } from "./refbadge";

// subtrees the plugin leaves alone; a reference it has made is one of them, so it is never split a second time. A
// `filemention` is a pill whose text is a path, which no reference can sit in
const SKIPPED = new Set(["link", "linkReference", "inlineCode", "code", "filemention", "refmention"]);

function text(value: string): Text {
    return { type: "text", value };
}

/** Pure: `value` as text and `refmention` nodes, null when it holds no reference. */
export function splitRefs(value: string): PhrasingContent[] | null {
    const spans = refSpans(value);
    if (spans.length === 0) {
        return null;
    }
    const out: PhrasingContent[] = [];
    let at = 0;
    for (const span of spans) {
        if (span.start > at) {
            out.push(text(value.slice(at, span.start)));
        }
        out.push({
            type: "refmention",
            children: [text(span.raw)],
            data: { hName: "refmention", hProperties: { kind: span.kind, id: span.id, raw: span.raw } },
        } as unknown as PhrasingContent);
        at = span.end;
    }
    if (at < value.length) {
        out.push(text(value.slice(at)));
    }
    return out;
}

const remarkRefMention: Plugin<[], Root> = function () {
    return (tree: Root) => {
        visit(tree, (node, index, parent) => {
            if (SKIPPED.has(node.type)) {
                return SKIP;
            }
            if (node.type !== "text" || parent == null || index == null) {
                return;
            }
            const parts = splitRefs(node.value);
            if (parts == null) {
                return;
            }
            (parent as Parent).children.splice(index, 1, ...(parts as Parent["children"]));
            // on past what was just put in
            return [SKIP, index + parts.length];
        });
    };
};

export default remarkRefMention;
