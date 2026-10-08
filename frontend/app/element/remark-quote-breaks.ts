// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import type { Blockquote, Break, Parent, PhrasingContent, Root, Text } from "mdast";
import type { Plugin } from "unified";
import { visit } from "unist-util-visit";

// A quote is usually verbatim text (a chat log, an email, a reviewer's words) whose line breaks are
// its content, but CommonMark joins a paragraph's lines into one. Inside a blockquote, turn each soft
// line break into a hard one, as remark-breaks does document-wide; prose outside quotes is often
// hard-wrapped at a column, so it keeps CommonMark's joining.
const remarkQuoteBreaks: Plugin<[], Root> = function () {
    return (tree: Root) => {
        visit(tree, "blockquote", (quote: Blockquote) => {
            visit(quote, "text", (node: Text, index: number | undefined, parent: Parent | undefined) => {
                if (parent == null || index == null || !/\r?\n/.test(node.value)) {
                    return;
                }
                const parts: PhrasingContent[] = [];
                node.value.split(/\r?\n/).forEach((line, i) => {
                    if (i > 0) {
                        parts.push({ type: "break" } as Break);
                    }
                    if (line !== "") {
                        parts.push({ type: "text", value: line });
                    }
                });
                parent.children.splice(index, 1, ...(parts as typeof parent.children));
                return index + parts.length;
            });
        });
    };
};

export default remarkQuoteBreaks;
