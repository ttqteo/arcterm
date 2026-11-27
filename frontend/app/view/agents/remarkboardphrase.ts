// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Marks the words of a message that may point at a shape of the board beside the Chat (boards/boardpointers.ts) as
// `boardphrase` nodes, which react-markdown draws through BoardPhrase (boards/boardphrase.tsx): a link where the board
// beside has shapes that match, the words as written otherwise. The marking knows no board: a quoted phrase and a date
// in text, and a bold phrase or a table cell when it is short (a long one is read through for the quotes in it). Code,
// links and the other pills are left alone.

import type { Parent, PhrasingContent, Root, RootContent } from "mdast";
import type { Plugin } from "unified";
import { SKIP, visit } from "unist-util-visit";
import { splitPhrases } from "../boards/boardpointers";

const SKIPPED = new Set(["link", "linkReference", "inlineCode", "code", "filemention", "refmention", "boardphrase"]);

// a bold phrase or a cell longer than this is prose, read through for its quotes and dates instead
const WHOLE_MAX = 60;

function plain(node: RootContent | Root): string {
    let s = "";
    visit(node, (n) => {
        if (n.type === "text" || n.type === "inlineCode") {
            s += (n as { value: string }).value;
        }
    });
    return s;
}

function phraseNode(phrase: string, children: PhrasingContent[]): PhrasingContent {
    return {
        type: "boardphrase",
        children,
        data: { hName: "boardphrase", hProperties: { phrase } },
    } as unknown as PhrasingContent;
}

const remarkBoardPhrase: Plugin<[], Root> = function () {
    return (tree: Root) => {
        visit(tree, (node, index, parent) => {
            if (SKIPPED.has(node.type)) {
                return SKIP;
            }
            if (node.type === "strong" || node.type === "tableCell") {
                const text = plain(node).trim();
                if (text !== "" && text.length <= WHOLE_MAX) {
                    const p = node as Parent;
                    p.children = [phraseNode(text, p.children as PhrasingContent[])] as Parent["children"];
                    return SKIP;
                }
                return;
            }
            if (node.type !== "text" || parent == null || index == null) {
                return;
            }
            const parts = splitPhrases(node.value);
            if (parts == null) {
                return;
            }
            const nodes = parts.map((p) =>
                "phrase" in p
                    ? phraseNode(p.phrase, [{ type: "text", value: p.phrase }])
                    : ({ type: "text", value: p.text } as PhrasingContent)
            );
            (parent as Parent).children.splice(index, 1, ...(nodes as Parent["children"]));
            return [SKIP, index + nodes.length];
        });
    };
};

export default remarkBoardPhrase;
