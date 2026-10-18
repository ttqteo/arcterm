// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import type { Parent, PhrasingContent, Root, Text } from "mdast";
import type { Plugin } from "unified";
import { visit } from "unist-util-visit";

// ==text== draws highlighted, as Obsidian draws it: a <mark> around the text, the marks dropped. A mark opens on ==
// followed by a non-space and closes on a non-space followed by ==, so `a == b` in prose is no mark; it may hold
// inline markup (`==**LightGBM** is fixed==`), and code never holds one, since code is not a text node. An unclosed
// == stays as written.

const MARK = "==";

// the phrasing containers a mark can sit in; a mark itself is left alone, so marks never nest
const CONTAINERS = new Set([
    "paragraph",
    "heading",
    "tableCell",
    "emphasis",
    "strong",
    "delete",
    "link",
    "linkReference",
]);

function text(value: string): Text {
    return { type: "text", value };
}

// the first == in `s` that opens a mark, -1 when none. `isNodeNext` when inline markup follows `s`, so a == at its
// end opens on it (`==**bold**==`)
function openOf(s: string, isNodeNext: boolean): number {
    for (let at = s.indexOf(MARK); at >= 0; at = s.indexOf(MARK, at + 1)) {
        const next = s.charAt(at + 2);
        if (next === "" ? isNodeNext : !/\s|=/.test(next)) {
            return at;
        }
    }
    return -1;
}

// the first == in `s` that closes a mark, -1 when none. `before` is the character ahead of `s` inside the mark,
// "" when the mark holds nothing yet
function closeOf(s: string, before: string): number {
    for (let at = s.indexOf(MARK); at >= 0; at = s.indexOf(MARK, at + 1)) {
        const prev = at > 0 ? s.charAt(at - 1) : before;
        if (prev !== "" && !/\s/.test(prev)) {
            return at;
        }
    }
    return -1;
}

// the last character a phrasing node shows, "x" for one that is not text (an inline code, an image)
function lastChar(node: PhrasingContent | undefined): string {
    if (node == null) {
        return "";
    }
    return node.type === "text" ? node.value.slice(-1) : "x";
}

export function markChildren(children: PhrasingContent[]): PhrasingContent[] {
    const out: PhrasingContent[] = [];
    let open = -1; // where in `out` the open mark's content starts
    children.forEach((child, i) => {
        if (child.type !== "text") {
            out.push(child);
            return;
        }
        const isNodeNext = children[i + 1] != null && children[i + 1]?.type !== "text";
        let rest = child.value;
        while (rest !== "") {
            if (open < 0) {
                const at = openOf(rest, isNodeNext);
                if (at < 0) {
                    out.push(text(rest));
                    break;
                }
                if (at > 0) {
                    out.push(text(rest.slice(0, at)));
                }
                open = out.length;
                rest = rest.slice(at + 2);
                continue;
            }
            const at = closeOf(rest, out.length > open ? lastChar(out.at(-1)) : "");
            if (at < 0) {
                out.push(text(rest));
                break;
            }
            if (at > 0) {
                out.push(text(rest.slice(0, at)));
            }
            const inner = out.splice(open);
            out.push({ type: "mark", children: inner, data: { hName: "mark" } } as unknown as PhrasingContent);
            open = -1;
            rest = rest.slice(at + 2);
        }
    });
    if (open >= 0) {
        out.splice(open, 0, text(MARK));
    }
    return out;
}

const remarkMark: Plugin<[], Root> = function () {
    return (tree: Root) => {
        visit(tree, (node) => {
            if (!CONTAINERS.has(node.type)) {
                return;
            }
            const parent = node as Parent;
            if (!parent.children.some((c) => c.type === "text" && c.value.includes(MARK))) {
                return;
            }
            parent.children = markChildren(parent.children as PhrasingContent[]) as typeof parent.children;
        });
    };
};

export default remarkMark;
