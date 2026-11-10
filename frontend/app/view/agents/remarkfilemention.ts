// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// An `@path` in a markdown message becomes a `filemention` node, which react-markdown draws as a file pill
// (chatfilepill.tsx). The words that count as a mention are filementiontokens.ts's, the rule the message box shares, so a
// pill in the box and the pill in your sent bubble agree. Only text is split: code never holds a text node, and a link
// keeps its text as written (a pill is itself a link, and one cannot sit inside another).

import type { Parent, PhrasingContent, Root, Text } from "mdast";
import type { Plugin } from "unified";
import { SKIP, visit } from "unist-util-visit";
import { mentionTokens } from "./filementiontokens";

// subtrees the plugin leaves alone; a mention it has made is one of them, so it is never split a second time
const SKIPPED = new Set(["link", "linkReference", "inlineCode", "code", "filemention"]);

function text(value: string): Text {
    return { type: "text", value };
}

/** Pure: `value` as text and `filemention` nodes, null when it holds no mention. */
export function splitMentions(value: string): PhrasingContent[] | null {
    const tokens = mentionTokens(value);
    if (tokens.length === 0) {
        return null;
    }
    const out: PhrasingContent[] = [];
    let at = 0;
    for (const token of tokens) {
        if (token.start > at) {
            out.push(text(value.slice(at, token.start)));
        }
        out.push({
            type: "filemention",
            children: [text(value.slice(token.start, token.end))],
            data: { hName: "filemention", hProperties: { path: token.path } },
        } as unknown as PhrasingContent);
        at = token.end;
    }
    if (at < value.length) {
        out.push(text(value.slice(at)));
    }
    return out;
}

const remarkFileMention: Plugin<[], Root> = function () {
    return (tree: Root) => {
        visit(tree, (node, index, parent) => {
            if (SKIPPED.has(node.type)) {
                return SKIP;
            }
            if (node.type !== "text" || parent == null || index == null) {
                return;
            }
            const parts = splitMentions(node.value);
            if (parts == null) {
                return;
            }
            (parent as Parent).children.splice(index, 1, ...(parts as Parent["children"]));
            // on past what was just put in
            return [SKIP, index + parts.length];
        });
    };
};

export default remarkFileMention;
