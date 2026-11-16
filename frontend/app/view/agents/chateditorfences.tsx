// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The message box's fenced code, drawn as you type it: the lines from an opening ``` to its closing one (or to the end,
// while it is still open) are set in the mono face, and a box is drawn behind them, as the bubble draws the block once
// it is sent. The text stays what you typed: the lines are given Lexical's `code` format (the editor's theme sets its
// face, chateditor.tsx), which is no character of the message, and the box is a layer behind the editor, placed where the
// block's first and last lines are on screen. Where the blocks are is chatfences.ts fenceRanges.

import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
    $getNodeByKey,
    $getRoot,
    $isElementNode,
    $isLineBreakNode,
    $isTextNode,
    COMMAND_PRIORITY_HIGH,
    COMPOSITION_END_COMMAND,
    HISTORY_MERGE_TAG,
    SKIP_SCROLL_INTO_VIEW_TAG,
    type EditorState,
    type TextNode,
} from "lexical";
import { useLayoutEffect, useRef, useState } from "react";
import { fenceRanges } from "./chatfences";

/** the theme class of a fenced line's text (LexicalComposer's `theme.text.code`) */
export const FENCED_TEXT_CLASS = "font-mono text-[0.88em]";

// how far the box reaches above its first line's text and below its last one's, inside the 1.9 leading's gap
const BOX_PAD = 3;

interface Box {
    top: number;
    height: number;
}

interface Read {
    /** the text nodes whose `code` format is not what their line says */
    wrong: string[];
    /** each block's first and last text node, the box's ends */
    ends: [string, string][];
}

/** the box's lines and the text nodes on each (a pill and a line break are not text nodes); a second paragraph, which
 *  the box never makes but a paste could, starts a line too */
function $lines(): { texts: string[]; nodes: TextNode[][] } {
    const texts: string[] = [];
    const nodes: TextNode[][] = [];
    let text = "";
    let on: TextNode[] = [];
    const end = () => {
        texts.push(text);
        nodes.push(on);
        text = "";
        on = [];
    };
    $getRoot()
        .getChildren()
        .forEach((paragraph, i) => {
            if (!$isElementNode(paragraph)) {
                return;
            }
            if (i > 0) {
                end();
            }
            for (const kid of paragraph.getChildren()) {
                if ($isLineBreakNode(kid)) {
                    end();
                    continue;
                }
                text += kid.getTextContent();
                if ($isTextNode(kid)) {
                    on.push(kid);
                }
            }
        });
    end();
    return { texts, nodes };
}

function readFences(state: EditorState): Read {
    return state.read(() => {
        const { texts, nodes } = $lines();
        const fenced = new Set<number>();
        const ends: [string, string][] = [];
        for (const range of fenceRanges(texts)) {
            const last = range.close ?? texts.length - 1;
            const inBlock: TextNode[] = [];
            for (let line = range.open; line <= last; line++) {
                fenced.add(line);
                inBlock.push(...nodes[line]);
            }
            if (inBlock.length > 0) {
                ends.push([inBlock[0].getKey(), inBlock[inBlock.length - 1].getKey()]);
            }
        }
        const wrong: string[] = [];
        nodes.forEach((on, line) =>
            on.forEach((node) => {
                if (node.hasFormat("code") !== fenced.has(line)) {
                    wrong.push(node.getKey());
                }
            })
        );
        return { wrong, ends };
    });
}

function sameBoxes(a: Box[], b: Box[]): boolean {
    return a.length === b.length && a.every((box, i) => box.top === b[i].top && box.height === b[i].height);
}

/** the plugin: sets the fenced lines' format and draws their boxes, in a layer under the editor's text */
export function FencedCode() {
    const [editor] = useLexicalComposerContext();
    const layer = useRef<HTMLDivElement>(null);
    const ends = useRef<[string, string][]>([]);
    const [boxes, setBoxes] = useState<Box[]>([]);

    const measure = useRef(() => {});
    measure.current = () => {
        const el = layer.current;
        if (el == null) {
            return;
        }
        const base = el.getBoundingClientRect().top;
        const next: Box[] = [];
        for (const [a, b] of ends.current) {
            const first = editor.getElementByKey(a);
            const last = editor.getElementByKey(b);
            if (first == null || last == null) {
                continue;
            }
            const top = Math.round(first.getBoundingClientRect().top - base - BOX_PAD);
            const bottom = Math.round(last.getBoundingClientRect().bottom - base + BOX_PAD);
            next.push({ top, height: bottom - top });
        }
        setBoxes((prev) => (sameBoxes(prev, next) ? prev : next));
    };

    useLayoutEffect(() => {
        const check = (state: EditorState = editor.getEditorState()) => {
            const read = readFences(state);
            ends.current = read.ends;
            // not under an IME: changing the node being composed drops the syllable; the check after the composition
            // ends sets it
            if (read.wrong.length > 0 && !editor.isComposing()) {
                editor.update(
                    () => {
                        for (const key of read.wrong) {
                            const node = $getNodeByKey(key);
                            if ($isTextNode(node)) {
                                node.toggleFormat("code");
                            }
                        }
                    },
                    // one undo step with the edit that made it, and no scroll to the caret
                    { tag: [HISTORY_MERGE_TAG, SKIP_SCROLL_INTO_VIEW_TAG] }
                );
            }
            measure.current();
        };
        const offUpdate = editor.registerUpdateListener(({ editorState }) => check(editorState));
        const offComposed = editor.registerCommand(
            COMPOSITION_END_COMMAND,
            () => {
                queueMicrotask(() => check());
                return false;
            },
            COMMAND_PRIORITY_HIGH
        );
        // the editor scrolls past its max height, and a new width wraps its lines anew
        const onMove = () => measure.current();
        const resize = new ResizeObserver(onMove);
        const offRoot = editor.registerRootListener((root, prev) => {
            if (prev != null) {
                prev.removeEventListener("scroll", onMove);
                resize.unobserve(prev);
            }
            if (root != null) {
                root.addEventListener("scroll", onMove, { passive: true });
                resize.observe(root);
            }
        });
        check();
        return () => {
            offUpdate();
            offComposed();
            offRoot();
            resize.disconnect();
        };
    }, [editor]);

    // reaches past the text on both sides, so the code does not touch the box's edges; clipped to the editor's height,
    // so a block scrolled out of the editor is not drawn. No aria-hidden, though it is decoration: it holds no text, and
    // the CDP scenarios read the placeholder as the editor's first `aria-hidden` sibling
    return (
        <div
            ref={layer}
            data-chat-code-layer=""
            className="pointer-events-none absolute inset-y-0 -right-2 -left-2 overflow-hidden"
        >
            {boxes.map((box, i) => (
                <div
                    key={i}
                    data-chat-code-box=""
                    className="absolute inset-x-0 rounded-[6px] border border-border bg-surface-code"
                    style={{ top: box.top, height: box.height }}
                />
            ))}
        </div>
    );
}
