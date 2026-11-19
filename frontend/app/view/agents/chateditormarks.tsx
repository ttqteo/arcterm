// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The message box's markdown, drawn as you type it, as the bubble draws it once it is sent: the lines from an opening ```
// to its closing one (or to the end, while it is still open) are set in the mono face with a box behind them; outside a
// block, a `code` span is mono in a chip of its own, and a line that starts with `>` is a quote, slanted and dimmed with a
// bar beside it and its `>` not drawn. The text stays what you typed: each is a Lexical text format (fenced `code`, inline
// `code` + `highlight`, quote `italic`, its `>` `lowercase`; the editor's theme sets their look, MARK_THEME), which is no
// character of the message, and the boxes and
// bars are a layer behind the editor, placed where their first and last lines are on screen. Which line is what is
// chatmarks.ts lineMarks.

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
    type TextFormatType,
    type TextNode,
} from "lexical";
import { useLayoutEffect, useRef, useState } from "react";
import { fenceRanges } from "./chatfences";
import { lineMarks, markRuns, quoteBlocks, type Mark } from "./chatmarks";

/** the editor theme's classes for the formats the marks use (LexicalComposer's `theme.text`): a fenced line's and an
 *  inline span's mono face (`code`), an inline span's chip over it (`highlight`, only ever beside `code`, so the element is
 *  a `<code>`, never a `<mark>`), a quote's slant and dim (`italic`), and its `>` drawn as nothing (`lowercase`), as
 *  `.agent-md` draws them in the bubble */
export const MARK_THEME = {
    code: "font-mono text-[0.88em]",
    highlight: "rounded-[3px] bg-panel-hover text-code-inline",
    italic: "italic text-secondary",
    // a quote's `>` and its space: no width and no glyph, as the bubble draws the quote without them (the bar stands for
    // them); the format is otherwise unused in the box
    lowercase: "text-[0px]",
} satisfies Partial<Record<TextFormatType, string>>;

// how far the box reaches above its first line's text and below its last one's, inside the 1.9 leading's gap
const BOX_PAD = 3;

interface Box {
    top: number;
    height: number;
}

interface Fix {
    key: string;
    /** where the node is cut, as offsets in it (none: it is drawn as one) */
    cuts: number[];
    /** the mark of each part */
    marks: Mark[];
}

interface Read {
    /** the text nodes whose formats are not what their line says */
    fixes: Fix[];
    /** each fenced block's first and last text node, the box's ends */
    fences: [string, string][];
    /** each quote's first and last text node, the bar's ends */
    quotes: [string, string][];
}

interface Placed {
    node: TextNode;
    /** where the node starts in its line's text */
    start: number;
}

/** the box's lines and the text nodes on each (a pill and a line break are not text nodes, a pill's text counts in the
 *  line); a second paragraph, which the box never makes but a paste could, starts a line too */
function $lines(): { texts: string[]; nodes: Placed[][] } {
    const texts: string[] = [];
    const nodes: Placed[][] = [];
    let text = "";
    let on: Placed[] = [];
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
                if ($isTextNode(kid)) {
                    on.push({ node: kid, start: text.length });
                }
                text += kid.getTextContent();
            }
        });
    end();
    return { texts, nodes };
}

const FORMATS: [TextFormatType, keyof Mark][] = [
    ["code", "code"],
    ["highlight", "inline"],
    ["italic", "quote"],
    ["lowercase", "marker"],
];

function hasMark(node: TextNode, mark: Mark): boolean {
    return FORMATS.every(([format, field]) => node.hasFormat(format) === mark[field]);
}

function ends(nodes: Placed[][], first: number, last: number): [string, string] | null {
    const all = nodes.slice(first, last + 1).flat();
    return all.length === 0 ? null : [all[0].node.getKey(), all[all.length - 1].node.getKey()];
}

function readMarks(state: EditorState, bash: boolean): Read {
    return state.read(() => {
        const { texts, nodes } = $lines();
        const marks = lineMarks(texts, { inline: !bash });
        const fixes: Fix[] = [];
        nodes.forEach((on, line) =>
            on.forEach(({ node, start }) => {
                const runs = markRuns(marks[line], start, start + node.getTextContentSize());
                if (runs.length === 1 && hasMark(node, runs[0].mark)) {
                    return;
                }
                fixes.push({
                    key: node.getKey(),
                    cuts: runs.slice(1).map((r) => r.start - start),
                    marks: runs.map((r) => r.mark),
                });
            })
        );
        const fences = fenceRanges(texts)
            .map((r) => ends(nodes, r.open, r.close ?? texts.length - 1))
            .filter((e) => e != null);
        // a quote's bar is measured from its text, not its `>`: drawn at no size, that node has no height to measure
        const text = nodes.map((on, line) =>
            on.filter(({ node, start }) => start + node.getTextContentSize() > marks[line].marker)
        );
        const quotes = quoteBlocks(marks)
            .map(([a, b]) => ends(text, a, b) ?? ends(nodes, a, b))
            .filter((e) => e != null);
        return { fixes, fences, quotes };
    });
}

function $apply(fix: Fix): void {
    const node = $getNodeByKey(fix.key);
    if (!$isTextNode(node)) {
        return;
    }
    const parts = fix.cuts.length > 0 ? node.splitText(...fix.cuts) : [node];
    parts.forEach((part, i) => {
        const mark = fix.marks[i];
        if (mark == null) {
            return;
        }
        for (const [format, field] of FORMATS) {
            if (part.hasFormat(format) !== mark[field]) {
                part.toggleFormat(format);
            }
        }
    });
}

function sameBoxes(a: Box[], b: Box[]): boolean {
    return a.length === b.length && a.every((box, i) => box.top === b[i].top && box.height === b[i].height);
}

/** the plugin: sets the lines' formats and draws the fenced blocks' boxes and the quotes' bars, in a layer under the
 *  editor's text. A bash command (`bash`) gets its fences only: a mirror under the editor draws its text, and a slanted
 *  or chipped run would no longer lie over it. */
export function TypedMarks({ bash }: { bash: boolean }) {
    const [editor] = useLexicalComposerContext();
    const layer = useRef<HTMLDivElement>(null);
    const placed = useRef<{ fences: [string, string][]; quotes: [string, string][] }>({ fences: [], quotes: [] });
    const [boxes, setBoxes] = useState<Box[]>([]);
    const [bars, setBars] = useState<Box[]>([]);
    const bashRef = useRef(bash);
    bashRef.current = bash;

    const measure = useRef(() => {});
    measure.current = () => {
        const el = layer.current;
        if (el == null) {
            return;
        }
        const base = el.getBoundingClientRect().top;
        const place = (pairs: [string, string][]): Box[] => {
            const out: Box[] = [];
            for (const [a, b] of pairs) {
                const first = editor.getElementByKey(a);
                const last = editor.getElementByKey(b);
                if (first == null || last == null) {
                    continue;
                }
                const top = Math.round(first.getBoundingClientRect().top - base - BOX_PAD);
                const bottom = Math.round(last.getBoundingClientRect().bottom - base + BOX_PAD);
                out.push({ top, height: bottom - top });
            }
            return out;
        };
        const nextBoxes = place(placed.current.fences);
        const nextBars = place(placed.current.quotes);
        setBoxes((prev) => (sameBoxes(prev, nextBoxes) ? prev : nextBoxes));
        setBars((prev) => (sameBoxes(prev, nextBars) ? prev : nextBars));
    };

    const check = useRef((_state?: EditorState) => {});
    check.current = (state: EditorState = editor.getEditorState()) => {
        const read = readMarks(state, bashRef.current);
        placed.current = { fences: read.fences, quotes: read.quotes };
        // not under an IME: changing the node being composed drops the syllable; the check after the composition
        // ends sets it
        if (read.fixes.length > 0 && !editor.isComposing()) {
            editor.update(
                () => {
                    for (const fix of read.fixes) {
                        $apply(fix);
                    }
                },
                // one undo step with the edit that made it, and no scroll to the caret
                { tag: [HISTORY_MERGE_TAG, SKIP_SCROLL_INTO_VIEW_TAG] }
            );
        }
        measure.current();
    };

    useLayoutEffect(() => {
        const offUpdate = editor.registerUpdateListener(({ editorState }) => check.current(editorState));
        const offComposed = editor.registerCommand(
            COMPOSITION_END_COMMAND,
            () => {
                queueMicrotask(() => check.current());
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
        check.current();
        return () => {
            offUpdate();
            offComposed();
            offRoot();
            resize.disconnect();
        };
    }, [editor]);

    // entering or leaving bash mode changes what is drawn without an edit
    useLayoutEffect(() => check.current(), [bash]);

    // reaches past the text on both sides, so the code does not touch the box's edges and a quote's bar sits in the
    // gutter left of its `>`; clipped to the editor's height, so a block scrolled out of the editor is not drawn. No
    // aria-hidden, though it is decoration: it holds no text, and the CDP scenarios read the placeholder as the editor's
    // first `aria-hidden` sibling
    return (
        <div
            ref={layer}
            data-chat-code-layer=""
            className="pointer-events-none absolute inset-y-0 -right-2 -left-2 overflow-hidden"
        >
            {boxes.map((box, i) => (
                <div
                    key={`box${i}`}
                    data-chat-code-box=""
                    className="absolute inset-x-0 rounded-[6px] border border-border bg-surface-code"
                    style={{ top: box.top, height: box.height }}
                />
            ))}
            {bars.map((bar, i) => (
                <div
                    key={`bar${i}`}
                    data-chat-quote-bar=""
                    className="absolute left-[2px] w-[3px] rounded-full bg-edge-strong"
                    style={{ top: bar.top + BOX_PAD, height: bar.height - 2 * BOX_PAD }}
                />
            ))}
        </div>
    );
}
