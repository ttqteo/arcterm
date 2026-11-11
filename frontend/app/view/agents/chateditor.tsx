// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The chat message box: a small Lexical editor that draws a file you @-mentioned as a pill (chateditorpill.tsx). It is a
// VIEW of plain text, not a second source of truth: `value` is the message as the agent receives it (a pill written
// `@<path>`, `@"<path>"` when the path holds a space), every edit is read back into that text and a caret offset and
// handed to `onChange`, and a `value` that is not what the editor last said (a picker's pick, a recalled message, an
// insert, a send) rebuilds the editor from it, a mention that is complete becoming a pill. So the slash menu, the `@`
// picker, recall and the send path go on working on a string and offsets, and the handle this editor gives its parent
// (`EditorLike`) answers like the part of a `<textarea>` they use. The arithmetic (text <-> lines, caret <-> offset) is
// chateditornodes.ts / chateditormodel.ts; this file is the Lexical wiring around it.
//
// `onChange` fires when the text, the caret or whether the selection is on a pill (`EditorLike.onPill`) changed, so a click
// that only moves the caret, or selects a pill, calls it with the same text.
// While an IME composition (Telex, Pinyin…) is on, nothing is reported and nothing is rebuilt: the text arrives when the
// composition ends. A `value` that comes from outside meanwhile is held and drawn when the composition ends (in place of
// the text typed), so the editor never says its own text over it.
// Two things are drawn over the text without being in it, in one overlay that mirrors it (`ghost`, `bash`): the grey ghost text
// after the last character, and the accent `!` of a bash command.

import { cn } from "@/util/util";
import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin";
import { PlainTextPlugin } from "@lexical/react/LexicalPlainTextPlugin";
import {
    $createLineBreakNode,
    $createNodeSelection,
    $createParagraphNode,
    $createRangeSelection,
    $createTextNode,
    $getRoot,
    $getSelection,
    $isElementNode,
    $isLineBreakNode,
    $isNodeSelection,
    $isRangeSelection,
    $isTextNode,
    $setSelection,
    CLEAR_HISTORY_COMMAND,
    COMMAND_PRIORITY_HIGH,
    COMPOSITION_END_COMMAND,
    KEY_BACKSPACE_COMMAND,
    KEY_DELETE_COMMAND,
    KEY_DOWN_COMMAND,
    PASTE_COMMAND,
    type ElementNode,
    type LexicalEditor,
    type LexicalNode,
    type PointType,
} from "lexical";
import { forwardRef, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from "react";
import { segmentLength, segmentsOf, type Segment } from "./chateditormodel";
import {
    adjacentPill,
    buildLine,
    isBreak,
    linesText,
    placeOf,
    placeOffset,
    type EditorLine,
    type EditorPlace,
} from "./chateditornodes";
import { $createFileMentionNode, $isFileMentionNode, FileMentionNode } from "./chateditorpill";

/** The part of an `HTMLTextAreaElement` the box's callers (the slash menu, the `@` picker, recall, insert) use, so a
 *  textarea (the New launcher's Task box) passes as one and floating-ui can anchor a picker to it as a virtual element. */
export interface EditorLike {
    readonly value: string;
    readonly selectionStart: number;
    readonly selectionEnd: number;
    readonly readOnly: boolean;
    /** the selection is on a pill: one is selected, or the caret sits right after one. A mention that is a pill is complete,
     *  never a path being typed, so the `@` picker stays shut on it (the box's text ends in the pill's `@path` there, which
     *  reads as a mention being typed). A textarea has no pills and leaves it out. */
    readonly onPill?: boolean;
    /** the element floating-ui follows when the handle anchors a list as a virtual element (a textarea is its own) */
    readonly contextElement?: Element;
    focus(options?: FocusOptions): void;
    blur(): void;
    setSelectionRange(start: number, end: number): void;
    getBoundingClientRect(): DOMRect;
}

/** The fields of a keyboard event the box's key handlers read; a React keyboard event satisfies it. */
export interface KeyLike {
    readonly key: string;
    readonly shiftKey: boolean;
    readonly altKey: boolean;
    readonly ctrlKey: boolean;
    readonly metaKey: boolean;
    readonly defaultPrevented: boolean;
    readonly nativeEvent: { readonly isComposing: boolean };
    readonly currentTarget: EditorLike;
    preventDefault(): void;
    stopPropagation(): void;
}

export interface ChatEditorProps {
    /** the message as the agent receives it */
    value: string;
    /** where a `value` that comes from outside (a pick, an insert) puts the caret, applied when its `text` is the
     *  `value` being drawn. A mention the caret is in or at the end of stays text (it is still being typed: a folder
     *  pick, `@../src/`, goes on walking), where without it every complete mention becomes a pill and the caret lands at
     *  the end of the text. */
    outsideCaret?: { text: string; caret: number } | null;
    /** the text and the caret (an offset in it) after an edit, a caret move or a pill selected or let go, not while a
     *  composition is on */
    onChange(text: string, caret: number): void;
    /** every key goes here first; a handler that calls `preventDefault` keeps the editor from acting on it */
    onKeyDown?(e: KeyLike): void;
    /** a paste whose clipboard holds files comes here; true = taken (the editor then pastes nothing) */
    onPasteFiles?(e: ClipboardEvent): boolean;
    placeholder: string;
    readOnly?: boolean;
    /** the type (size, colour) of the box, inherited by its text and its placeholder */
    className?: string;
    minHeight: number;
    maxHeight: number;
    /** extra attributes for the editable element (`data-…`) */
    dataAttrs?: Record<string, string>;
    /** the text is a bash command (it starts with `!`, Chat's bash mode): its leading `!` is drawn in the accent colour
     *  and semibold, over the editor's own, in the overlay `ghost` is drawn in */
    bash?: boolean;
    /** grey text drawn right after the last character, not part of the message (bash mode's suggestion from Claude Code's
     *  history); empty draws nothing */
    ghost?: string;
}

// ---- reading the editor's content as lines (all `$` functions run inside editor.read / editor.update) ----

interface Doc {
    lines: EditorLine[];
    /** the Lexical child behind each segment of each line */
    nodes: LexicalNode[][];
    paragraphs: ElementNode[];
}

const END: EditorPlace = { line: Number.MAX_SAFE_INTEGER, index: Number.MAX_SAFE_INTEGER, offset: 0 };

function segmentOfNode(node: LexicalNode): Segment {
    if ($isFileMentionNode(node)) {
        return { kind: "pill", path: node.getPath() };
    }
    return { kind: "text", text: $isLineBreakNode(node) ? "\n" : node.getTextContent() };
}

function $readDoc(): Doc {
    const doc: Doc = { lines: [], nodes: [], paragraphs: [] };
    for (const child of $getRoot().getChildren()) {
        if ($isElementNode(child)) {
            const kids = child.getChildren();
            doc.paragraphs.push(child);
            doc.nodes.push(kids);
            doc.lines.push(kids.map(segmentOfNode));
        }
    }
    return doc;
}

/** the place in the lines of one end of a selection */
function $placeOfPoint(point: PointType, doc: Doc): EditorPlace {
    if (point.type === "text") {
        for (let line = 0; line < doc.nodes.length; line++) {
            const index = doc.nodes[line].findIndex((n) => n.getKey() === point.key);
            if (index >= 0) {
                return { line, index, offset: point.offset };
            }
        }
        return END;
    }
    const line = doc.paragraphs.findIndex((p) => p.getKey() === point.key);
    if (line < 0) {
        // a point on the root itself: between paragraphs
        return point.offset < doc.lines.length ? { line: point.offset, index: 0, offset: 0 } : END;
    }
    const kids = doc.nodes[line];
    if (point.offset < kids.length) {
        return { line, index: point.offset, offset: 0 };
    }
    if (kids.length > 0) {
        const index = kids.length - 1;
        return { line, index, offset: segmentLength(doc.lines[line][index]) };
    }
    return { line, index: 0, offset: 0 };
}

/** the selection as offsets in the box's text, or null when there is none */
function $selectionOffsets(doc: Doc): { start: number; end: number } | null {
    const selection = $getSelection();
    if ($isRangeSelection(selection)) {
        const a = placeOffset(doc.lines, $placeOfPoint(selection.anchor, doc));
        const b = placeOffset(doc.lines, $placeOfPoint(selection.focus, doc));
        return { start: Math.min(a, b), end: Math.max(a, b) };
    }
    if ($isNodeSelection(selection)) {
        let start = Number.POSITIVE_INFINITY;
        let end = -1;
        doc.nodes.forEach((kids, line) =>
            kids.forEach((node, index) => {
                if (selection.has(node.getKey())) {
                    start = Math.min(start, placeOffset(doc.lines, { line, index, offset: 0 }));
                    end = Math.max(end, placeOffset(doc.lines, { line, index, offset: 1 }));
                }
            })
        );
        return end < 0 ? null : { start, end };
    }
    return null;
}

/** put one end of a selection at a place; a Lexical decorator holds no caret, so beside a pill or a line break the point
 *  goes to the text next to it, or to the paragraph at that child when there is none */
function $setPoint(point: PointType, doc: Doc, place: EditorPlace): void {
    const paragraph = doc.paragraphs[place.line];
    if (paragraph == null) {
        point.set("root", 0, "element");
        return;
    }
    const kids = doc.nodes[place.line];
    const node = kids[place.index];
    if (node == null) {
        point.set(paragraph.getKey(), kids.length, "element");
        return;
    }
    if ($isTextNode(node)) {
        point.set(node.getKey(), Math.min(Math.max(place.offset, 0), node.getTextContentSize()), "text");
        return;
    }
    const after = place.offset > 0;
    const beside = kids[place.index + (after ? 1 : -1)];
    if ($isTextNode(beside)) {
        point.set(beside.getKey(), after ? 0 : beside.getTextContentSize(), "text");
        return;
    }
    point.set(paragraph.getKey(), place.index + (after ? 1 : 0), "element");
}

/** whether the selection is on a pill: a pill selected (Backspace or ← beside it), or a collapsed caret right after one */
function $selectionOnPill(doc: Doc): boolean {
    const selection = $getSelection();
    if ($isNodeSelection(selection)) {
        return selection.getNodes().some($isFileMentionNode);
    }
    if (!$isRangeSelection(selection) || !selection.isCollapsed()) {
        return false;
    }
    const place = $placeOfPoint(selection.focus, doc);
    return adjacentPill(doc.lines[place.line] ?? [], place.index, place.offset, true) != null;
}

function $selectOffsets(doc: Doc, anchor: number, focus: number): void {
    const selection = $createRangeSelection();
    $setPoint(selection.anchor, doc, placeOf(doc.lines, anchor));
    $setPoint(selection.focus, doc, placeOf(doc.lines, focus));
    $setSelection(selection);
}

/** replace the whole content by a message's segments: one paragraph, a line break between lines (an empty message is
 *  still one empty paragraph). With a `caret` (an offset in the text) the selection lands there, as a textarea's does at
 *  the end when its value is set; with null there is none. */
function $rebuild(segments: Segment[], caret: number | null): void {
    const root = $getRoot();
    root.clear();
    const paragraph = $createParagraphNode();
    for (const seg of buildLine(segments)) {
        if (seg.kind === "pill") {
            paragraph.append($createFileMentionNode(seg.path));
        } else if (isBreak(seg)) {
            paragraph.append($createLineBreakNode());
        } else {
            paragraph.append($createTextNode(seg.text));
        }
    }
    root.append(paragraph);
    if (caret != null) {
        $selectOffsets($readDoc(), caret, caret);
    } else {
        $setSelection(null);
    }
}

function isFocused(editor: LexicalEditor): boolean {
    const root = editor.getRootElement();
    return root != null && root === document.activeElement;
}

// ---- keys ----

function keyLike(e: KeyboardEvent, target: EditorLike): KeyLike {
    return {
        key: e.key,
        shiftKey: e.shiftKey,
        altKey: e.altKey,
        ctrlKey: e.ctrlKey,
        metaKey: e.metaKey,
        get defaultPrevented() {
            return e.defaultPrevented;
        },
        nativeEvent: e,
        currentTarget: target,
        preventDefault: () => e.preventDefault(),
        stopPropagation: () => e.stopPropagation(),
    };
}

/** Backspace (or Delete) beside a pill selects it, the next one deletes it whole; with a pill selected it deletes at
 *  once. True when the key was taken. */
function $deletePill(event: KeyboardEvent, backward: boolean): boolean {
    const selection = $getSelection();
    const doc = $readDoc();
    if ($isNodeSelection(selection)) {
        const pills = selection.getNodes().filter($isFileMentionNode);
        const at = $selectionOffsets(doc);
        if (pills.length === 0 || at == null) {
            return false;
        }
        event.preventDefault();
        pills.forEach((p) => p.remove());
        $selectOffsets($readDoc(), at.start, at.start);
        return true;
    }
    if (!$isRangeSelection(selection) || !selection.isCollapsed()) {
        return false;
    }
    const place = $placeOfPoint(selection.focus, doc);
    const found = adjacentPill(doc.lines[place.line] ?? [], place.index, place.offset, backward);
    if (found == null) {
        return false;
    }
    event.preventDefault();
    const next = $createNodeSelection();
    next.add(doc.nodes[place.line][found].getKey());
    $setSelection(next);
    return true;
}

/** With a pill selected, ← and → leave it (to before / after it) and a typed character replaces the selection by a
 *  caret after it, so the character is typed there instead of being dropped. */
function $leaveSelectedPill(e: KeyboardEvent): boolean {
    const selection = $getSelection();
    if (!$isNodeSelection(selection)) {
        return false;
    }
    const nodes = selection.getNodes();
    if (nodes.length === 0) {
        return false;
    }
    if (e.key === "ArrowLeft") {
        e.preventDefault();
        nodes[0].selectPrevious();
        return true;
    }
    if (e.key === "ArrowRight") {
        e.preventDefault();
        nodes[nodes.length - 1].selectNext();
        return true;
    }
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        nodes[nodes.length - 1].selectNext();
    }
    return false;
}

function clipboardHasFiles(e: ClipboardEvent): boolean {
    const data = e.clipboardData;
    if (data == null) {
        return false;
    }
    return data.files.length > 0 || Array.from(data.items ?? []).some((i) => i.kind === "file");
}

const NO_RECT = typeof DOMRect === "undefined" ? ({} as DOMRect) : new DOMRect();

// ---- the editor ----

interface BridgeProps {
    props: React.MutableRefObject<ChatEditorProps>;
    /** what the editor last said to its parent */
    said: React.MutableRefObject<{ text: string; caret: number }>;
}

/** the plugin that connects the Lexical editor to the box's props, its handle and its keys */
const Bridge = forwardRef<EditorLike, BridgeProps>(function Bridge({ props, said }, ref) {
    const [editor] = useLexicalComposerContext();
    const wasFocused = useRef(false);

    const handle = useMemo<EditorLike>(() => {
        const offsets = () =>
            editor.read(() => $selectionOffsets($readDoc())) ?? {
                start: said.current.text.length,
                end: said.current.text.length,
            };
        const self: EditorLike = {
            get value() {
                return said.current.text;
            },
            get selectionStart() {
                return offsets().start;
            },
            get selectionEnd() {
                return offsets().end;
            },
            get readOnly() {
                return !editor.isEditable();
            },
            get onPill() {
                return editor.read(() => $selectionOnPill($readDoc()));
            },
            get contextElement() {
                return editor.getRootElement() ?? undefined;
            },
            focus() {
                editor.update(
                    () => {
                        if ($getSelection() == null) {
                            const doc = $readDoc();
                            const end = linesText(doc.lines).length;
                            $selectOffsets(doc, end, end);
                        }
                    },
                    { discrete: true }
                );
                editor.focus();
            },
            blur() {
                editor.blur();
            },
            setSelectionRange(start, end) {
                editor.update(() => $selectOffsets($readDoc(), start, end), { discrete: true });
            },
            getBoundingClientRect() {
                return editor.getRootElement()?.getBoundingClientRect() ?? NO_RECT;
            },
        };
        return self;
    }, [editor, said]);
    useImperativeHandle(ref, () => handle, [handle]);

    // with a pill selected Lexical leaves the native caret at the start of the text; the root says so, and its style hides it
    useLayoutEffect(
        () =>
            editor.registerUpdateListener(({ editorState }) => {
                const on = editorState.read(() => $isNodeSelection($getSelection()));
                editor.getRootElement()?.toggleAttribute("data-pill-selected", on);
            }),
        [editor]
    );

    // an outside `value` that arrived in the middle of a composition waits (`held`) and is drawn when it ends, in place of
    // the text typed: otherwise the editor would say its own text next and write over the outside change
    const [composed, setComposed] = useState(0);
    const held = useRef(false);
    const release = useRef(() => {});
    release.current = () => {
        if (held.current && !editor.isComposing()) {
            held.current = false;
            setComposed((n) => n + 1);
        }
    };
    useLayoutEffect(
        () =>
            // after the event, so the editor has settled; the update listener below does the same on the update that
            // ends the composition, when there is one
            editor.registerCommand(
                COMPOSITION_END_COMMAND,
                () => {
                    queueMicrotask(() => release.current());
                    return false;
                },
                COMMAND_PRIORITY_HIGH
            ),
        [editor]
    );

    // what the user does in the editor goes out as text and a caret. Selecting a pill leaves both as they were (the caret is
    // the selection's end, the pill's end), so whether the selection is on a pill is told too: the `@` picker closes on it.
    const onPill = useRef(false);
    useLayoutEffect(
        () =>
            editor.registerUpdateListener(({ editorState, tags }) => {
                if (tags.has("external") || editor.isComposing()) {
                    return;
                }
                if (held.current) {
                    release.current();
                    return;
                }
                const next = editorState.read(() => {
                    const doc = $readDoc();
                    const text = linesText(doc.lines);
                    return { text, caret: $selectionOffsets(doc)?.end ?? text.length, pill: $selectionOnPill(doc) };
                });
                if (
                    next.text === said.current.text &&
                    next.caret === said.current.caret &&
                    next.pill === onPill.current
                ) {
                    return;
                }
                said.current = { text: next.text, caret: next.caret };
                onPill.current = next.pill;
                props.current.onChange(next.text, next.caret);
            }),
        [editor, props, said]
    );

    // a value that is not what the editor last said comes from outside: draw it (never in the middle of a composition,
    // which would drop the syllable being typed: it is held, and drawn when the composition ends)
    const { value } = props.current;
    useLayoutEffect(() => {
        if (value === said.current.text) {
            held.current = false;
            return;
        }
        if (editor.isComposing()) {
            held.current = true;
            return;
        }
        held.current = false;
        const ask = props.current.outsideCaret;
        const caret = ask != null && ask.text === value ? Math.min(Math.max(ask.caret, 0), value.length) : null;
        const focused = isFocused(editor);
        said.current = { text: value, caret: caret ?? value.length };
        editor.update(() => $rebuild(segmentsOf(value, caret ?? undefined), caret ?? (focused ? value.length : null)), {
            tag: "external",
            discrete: true,
        });
        onPill.current = editor.read(() => $selectionOnPill($readDoc()));
        // like a textarea whose value is set from outside, what came before is not undoable
        editor.dispatchCommand(CLEAR_HISTORY_COMMAND, undefined);
    }, [editor, value, composed, props, said]);

    // read-only keeps the box on screen but not editable; it gets the focus back when it was in it
    const { readOnly = false } = props.current;
    useLayoutEffect(() => {
        if (readOnly) {
            wasFocused.current = isFocused(editor);
            editor.setEditable(false);
            return;
        }
        editor.setEditable(true);
        if (wasFocused.current) {
            wasFocused.current = false;
            handle.focus();
        }
    }, [editor, readOnly, handle]);

    useLayoutEffect(() => {
        const offDown = editor.registerCommand(
            KEY_DOWN_COMMAND,
            (event: KeyboardEvent) => {
                props.current.onKeyDown?.(keyLike(event, handle));
                if (event.defaultPrevented) {
                    return true;
                }
                return $leaveSelectedPill(event);
            },
            COMMAND_PRIORITY_HIGH
        );
        const offBackspace = editor.registerCommand(
            KEY_BACKSPACE_COMMAND,
            (event: KeyboardEvent) => $deletePill(event, true),
            COMMAND_PRIORITY_HIGH
        );
        const offDelete = editor.registerCommand(
            KEY_DELETE_COMMAND,
            (event: KeyboardEvent) => $deletePill(event, false),
            COMMAND_PRIORITY_HIGH
        );
        const offPaste = editor.registerCommand(
            PASTE_COMMAND,
            (event) => {
                const files = props.current.onPasteFiles;
                if (files == null || !("clipboardData" in event) || !clipboardHasFiles(event)) {
                    return false;
                }
                if (!files(event)) {
                    return false;
                }
                event.preventDefault();
                return true;
            },
            COMMAND_PRIORITY_HIGH
        );
        return () => {
            offDown();
            offBackspace();
            offDelete();
            offPaste();
        };
    }, [editor, handle, props]);

    return null;
});

export const ChatEditor = forwardRef<EditorLike, ChatEditorProps>(function ChatEditor(p, ref) {
    const props = useRef(p);
    props.current = p;
    const said = useRef({ text: p.value, caret: p.value.length });
    const ghost = p.ghost ?? "";
    const bang = p.bash === true && p.value.startsWith("!");
    // read once, when the editor is made; later values reach it through the Bridge
    const [initialConfig] = useState(() => ({
        namespace: "arc-chat-editor",
        nodes: [FileMentionNode],
        editable: !p.readOnly,
        onError: (error: Error) => console.error("chat editor:", error),
        // the draft the box mounts with (a restored one, with its pills)
        editorState: () => $rebuild(segmentsOf(p.value), null),
    }));
    return (
        <LexicalComposer initialConfig={initialConfig}>
            <div className={cn("relative min-w-0", p.className)}>
                <PlainTextPlugin
                    contentEditable={
                        <ContentEditable
                            data-chat-input=""
                            {...p.dataAttrs}
                            role="textbox"
                            aria-multiline="true"
                            aria-label="Message"
                            // the webview's English checker underlines every Vietnamese word, as the app's other boxes
                            spellCheck={false}
                            className="block overflow-y-auto leading-[1.9] whitespace-pre-wrap outline-none [overflow-wrap:anywhere] data-[pill-selected]:caret-transparent"
                            style={{ minHeight: p.minHeight, maxHeight: p.maxHeight }}
                        />
                    }
                    placeholder={
                        <div
                            aria-hidden
                            className="pointer-events-none absolute top-0 left-0 max-w-full truncate leading-[1.9] text-muted select-none"
                        >
                            {p.placeholder}
                        </div>
                    }
                    ErrorBoundary={LexicalErrorBoundary}
                />
                {/* A mirror of the text laid over the editor, with the same type and wrapping, so what it draws lands
                    exactly where the editor's own text is: the text itself invisible, the bash `!` drawn over the
                    editor's (its box filled with the well's colour so the editor's thinner one does not show at the
                    edges), the ghost after the last character. */}
                {bang || ghost !== "" ? (
                    <div
                        aria-hidden
                        data-chat-ghost-layer=""
                        className="pointer-events-none absolute inset-0 overflow-hidden leading-[1.9] whitespace-pre-wrap select-none [overflow-wrap:anywhere]"
                    >
                        {bang ? (
                            <span data-chat-bang="" className="bg-surface-code font-semibold text-accent">
                                !
                            </span>
                        ) : null}
                        <span className="invisible">{bang ? p.value.slice(1) : p.value}</span>
                        {ghost !== "" ? (
                            <span data-chat-ghost="" className="text-ink-faint">
                                {ghost}
                            </span>
                        ) : null}
                    </div>
                ) : null}
                <HistoryPlugin />
                <Bridge ref={ref} props={props} said={said} />
            </div>
        </LexicalComposer>
    );
});
