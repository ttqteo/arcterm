// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The chat message box: a small Lexical editor that draws a file you @-mentioned as a pill (chateditorpill.tsx) and an
// `agent:<id>`, `run:<id>`, `council:<id>`, `session:<id>` or `effort:<id>` reference as a badge (chateditorrefpill.tsx).
// It is a VIEW of plain text, not a second source of truth: `value` is the message as the agent receives it (a pill
// written `@<path>`, `@"<path>"` when the path holds a space, a badge as the token was written), every edit is read back
// into that text and a caret offset and handed to `onChange`, and a `value` that is not what the editor last said (a
// picker's pick, a recalled message, an insert, a send) rebuilds the editor from it, a mention or a reference that is
// complete becoming a pill or a badge. One typed or pasted by hand becomes one too, in place, once it is finished (a space
// after it, or for a reference punctuation too: a file's `.` may be its extension starting; `$settleTypedText`): the
// text does not change, so nothing is reported and no rebuild follows. ← or → into a pill opens it back into its text to
// edit (`$openPill`); it is a pill again once the caret leaves it.
// So the slash menu, the `@` picker, recall and the send path go on working on a string and offsets, and the handle this
// editor gives its parent (`EditorLike`) answers like the part of a `<textarea>` they use. The arithmetic (text <-> lines,
// caret <-> offset) is chateditornodes.ts / chateditormodel.ts; this file is the Lexical wiring around it.
//
// `onChange` fires when the text, the caret or whether the selection is on a pill (`EditorLike.onPill`) changed, so a click
// that only moves the caret, or selects a pill, calls it with the same text.
// While an IME composition (Telex, Pinyin…) is on, nothing is reported and nothing is rebuilt: the text arrives when the
// composition ends. A `value` that comes from outside meanwhile is held and drawn when the composition ends (in place of
// the text typed), so the editor never says its own text over it.
// The grey ghost text after the last character (`ghost`) is drawn over the text without being in it, in an overlay that
// mirrors it and scrolls as the editor does (GhostScroll). A bash command's leading `!` (`bash`) is in `value` but not in the editor: it is drawn as an accent marker
// beside it, a gap before the command, as Claude Code's own box does (chateditormodel.ts `bangSkip`); every text and offset
// the editor takes or gives is mapped across it, and Backspace at the command's start takes the `!` away, leaving bash mode.
// Markdown is not drawn while it is typed (a ``` block, a `code` span, a `>` quote show as their characters); the bubble
// draws it once the message is sent. A paste of several lines that reads as code or a log goes in fenced
// (chatmarks.ts codePaste); one undo takes the fence away and leaves the raw paste.

import { isMacOS } from "@/util/platformutil";
import { cn } from "@/util/util";
import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin";
import { PlainTextPlugin } from "@lexical/react/LexicalPlainTextPlugin";
import {
    $addUpdateTag,
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
    HISTORY_MERGE_TAG,
    HISTORY_PUSH_TAG,
    KEY_BACKSPACE_COMMAND,
    KEY_DELETE_COMMAND,
    KEY_DOWN_COMMAND,
    PASTE_COMMAND,
    TextNode,
    type ElementNode,
    type LexicalEditor,
    type LexicalNode,
    type PointType,
} from "lexical";
import {
    forwardRef,
    Fragment,
    useImperativeHandle,
    useLayoutEffect,
    useMemo,
    useRef,
    useState,
    type RefObject,
} from "react";
import {
    atomRunsIn,
    bangSkip,
    caretAmongRuns,
    fromShown,
    gapToDrop,
    openedCaret,
    segmentLength,
    segmentsOf,
    shownText,
    type Segment,
} from "./chateditormodel";
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
import { $createRefMentionNode, $isRefMentionNode, RefMentionNode } from "./chateditorrefpill";
import { codePaste } from "./chatmarks";
import { foldsPaste } from "./chatpastes";
import { gapAfterMention, gapBeforeMention } from "./filementiontokens";
import { shellLine } from "./shellhighlight";

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
    /** a long paste (chatpastes.ts foldsPaste) comes here instead of into the text, to fold into a chip; left out, every
     *  paste goes in. Never in a bash command. */
    onLongPaste?(pasted: string): void;
    /** the editor lost the focus: `relatedTarget` is where it went (null for a click on something that takes none, or the
     *  window losing the focus) */
    onBlur?(e: FocusEvent): void;
    /** the empty box's line: text, or text with keycaps in it */
    placeholder: React.ReactNode;
    readOnly?: boolean;
    /** the type (size, colour) of the box, inherited by its text and its placeholder */
    className?: string;
    minHeight: number;
    maxHeight: number;
    /** extra attributes for the editable element (`data-…`) */
    dataAttrs?: Record<string, string>;
    /** the text is a bash command (it starts with `!`, Chat's bash mode): its leading `!` is left out of the editor and
     *  drawn beside it as an accent, semibold marker, a gap before the command; and it never makes a file pill (the shell
     *  knows no `@` mention, and the ghost text mirrors the plain text), so a `@path` in it stays text */
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

/** a file pill or a reference badge: the two things the caret steps over whole */
function $isPillNode(node: LexicalNode | null | undefined): node is FileMentionNode | RefMentionNode {
    return $isFileMentionNode(node) || $isRefMentionNode(node);
}

function segmentOfNode(node: LexicalNode): Segment {
    if ($isFileMentionNode(node)) {
        return { kind: "pill", path: node.getPath() };
    }
    if ($isRefMentionNode(node)) {
        return { kind: "ref", ref: node.getRefKind(), id: node.getId(), raw: node.getRaw() };
    }
    return { kind: "text", text: $isLineBreakNode(node) ? "\n" : node.getTextContent() };
}

/** Text typed right against a pill would join its mention (`@a/b.json` + `đọc` is a mention of `a/b.jsonđọc`, a file
 *  that does not exist; filementiontokens.ts gapAfterMention): the text node takes a space on the pill's side, the caret
 *  staying where it was in the text. A reference badge takes the same gap (`agent:7cd99627` + `a` reads as the id
 *  `7cd99627a`): a reference ends and starts at the same punctuation and spaces a file mention does. */
function $gapAroundPills(node: TextNode): void {
    const text = node.getTextContent();
    const front = $isPillNode(node.getPreviousSibling()) && gapAfterMention(text);
    const back = $isPillNode(node.getNextSibling()) && gapBeforeMention(text);
    if (!front && !back) {
        return;
    }
    const key = node.getKey();
    const selection = $getSelection();
    const points = $isRangeSelection(selection)
        ? [selection.anchor, selection.focus].filter((p) => p.type === "text" && p.key === key)
        : [];
    const offsets = points.map((p) => p.offset);
    node.setTextContent(`${front ? " " : ""}${text}${back ? " " : ""}`);
    if (front) {
        points.forEach((p, i) => p.set(key, offsets[i] + 1, "text"));
    }
}

/** A file mention or a reference typed or pasted into a text node is a pill or a badge once it is finished (`atomRunsIn`:
 *  the caret past it and a space, or a reference's punctuation): the node is split at the ends of each one and its middle part replaced by the node
 *  it stands for. The box's text does not change (a badge's text is its `raw`, a pill's `mentionText`), so the update
 *  listener reports nothing and no outside rebuild follows. `splitText` carries a caret in the node to the part it falls
 *  in and a caret at a token's end (still typing) never splits it, but `replace` moves a caret on the part it replaces to
 *  the new node's far side: a caret at 0 with a token starting there would end up after its badge, so the caret is put
 *  back at its offset in the text (`caretAmongRuns`) once the swaps are done. */
function $atomsInTypedText(node: TextNode): void {
    const selection = $getSelection();
    const caret =
        $isRangeSelection(selection) && selection.focus.type === "text" && selection.focus.key === node.getKey()
            ? selection.focus.offset
            : undefined;
    const runs = atomRunsIn(node.getTextContent(), caret);
    if (runs.length === 0) {
        return;
    }
    const kept =
        $isRangeSelection(selection) && selection.isCollapsed() && caret != null ? caretAmongRuns(runs, caret) : null;
    // which part is which token, read before anything is replaced or given a gap (both change a part's size)
    let at = 0;
    const swaps = node.splitText(...runs.flatMap((r) => [r.start, r.end])).map((part) => {
        const end = at + part.getTextContentSize();
        const run = runs.find((r) => r.start === at && r.end === end);
        at = end;
        return { part, run };
    });
    const atoms: LexicalNode[] = [];
    // the text part after run `n - 1` (0: before the first run), which is where a caret in the text between runs stays
    const gaps: TextNode[] = [];
    for (const { part, run } of swaps) {
        if (run != null) {
            atoms.push(
                part.replace(
                    run.seg.kind === "ref"
                        ? $createRefMentionNode(run.seg.ref, run.seg.id, run.seg.raw)
                        : $createFileMentionNode(run.seg.path)
                )
            );
        } else {
            gaps[atoms.length] = part;
        }
    }
    // after the swaps the current selection is not the object read above (a headless check found them different): read it again
    const now = $getSelection();
    if (kept != null && $isRangeSelection(now)) {
        const atom = "before" in kept ? atoms[kept.before] : undefined;
        const text = "gap" in kept ? gaps[kept.gap] : undefined;
        for (const point of [now.anchor, now.focus]) {
            if (atom != null) {
                // no text before the badge: the caret sits on the paragraph at its index, a decorator holds none
                point.set(atom.getParentOrThrow().getKey(), atom.getIndexWithinParent(), "element");
            } else if (text != null && "gap" in kept) {
                point.set(text.getKey(), Math.min(kept.offset, text.getTextContentSize()), "text");
            }
        }
    }
    // the text now standing against a new pill or badge needs the gap rule too (`@"a b.md"x` leaves `x` against its pill)
    for (const atom of atoms) {
        for (const side of [atom.getPreviousSibling(), atom.getNextSibling()]) {
            if ($isTextNode(side)) {
                $gapAroundPills(side);
            }
        }
    }
}

/** What the box does with a text node that was typed, pasted or left by an edit: the gap against a pill first (a token
 *  pasted right after a pill gets its space before it is looked at, or `agent:aaaaaaaa` + `run:…` would join), then the
 *  tokens in it that are finished become pills and badges. A bash command draws no pill or badge (`bash`: the shell knows
 *  no `@` mention), so only the gap rule applies there, and it has no pill to be against. The new nodes' text neighbours are
 *  dirty (`splitText` marks them), so the transform looks at them again and the gap rule covers them too. */
function $settleTypedText(node: TextNode, bash: boolean): void {
    $gapAroundPills(node);
    if (!bash && node.isAttached()) {
        $atomsInTypedText(node);
    }
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

/** whether the selection is on a pill (a file pill or a reference badge): one selected (Backspace beside it, or a click),
 *  or a collapsed caret right after one */
function $selectionOnPill(doc: Doc): boolean {
    const selection = $getSelection();
    if ($isNodeSelection(selection)) {
        return selection.getNodes().some($isPillNode);
    }
    if (!$isRangeSelection(selection) || !selection.isCollapsed()) {
        return false;
    }
    const place = $placeOfPoint(selection.focus, doc);
    return adjacentPill(doc.lines[place.line] ?? [], place.index, place.offset, true) != null;
}

/** whether the selection is a caret at the very start of the text (nothing selected) */
function $caretAtStart(): boolean {
    const selection = $getSelection();
    if (!$isRangeSelection(selection) || !selection.isCollapsed()) {
        return false;
    }
    return $selectionOffsets($readDoc())?.end === 0;
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
        } else if (seg.kind === "ref") {
            paragraph.append($createRefMentionNode(seg.ref, seg.id, seg.raw));
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

/** a text node's new text, or no node at all when it is empty (an empty text node left in a line would sit under the
 *  caret until Lexical's normalisation removes it) */
function $setTextOrRemove(node: TextNode, text: string): void {
    if (text === "") {
        node.remove();
    } else {
        node.setTextContent(text);
    }
}

/** Backspace (or Delete) beside a pill selects it, the next one deletes it whole; with a pill selected it deletes at
 *  once, and one of the two spaces the text typed around it left goes with it (`gapToDrop`). True when the key was
 *  taken. */
function $deletePill(event: KeyboardEvent, backward: boolean): boolean {
    const selection = $getSelection();
    const doc = $readDoc();
    if ($isNodeSelection(selection)) {
        const pills = selection.getNodes().filter($isPillNode);
        const at = $selectionOffsets(doc);
        if (pills.length === 0 || at == null) {
            return false;
        }
        event.preventDefault();
        // the text typed around a pill leaves a space on each side of it: one goes with the pill (`gapToDrop`), so
        // `đọc @a/b.ts tiếp` reads `đọc tiếp`, not `đọc  tiếp`. A dropped space before the first pill moves the caret back one.
        let caret = at.start;
        pills
            .slice()
            .sort((a, b) => (a.isBefore(b) ? -1 : 1))
            .forEach((p, i) => {
                const prev = p.getPreviousSibling();
                const next = p.getNextSibling();
                const before = $isTextNode(prev) ? prev.getTextContent() : "";
                const after = $isTextNode(next) ? next.getTextContent() : "";
                const gap = gapToDrop(before, after);
                // a pill right beside this one needs that space (the gap rule would put it back), so none is dropped there
                const drop =
                    (gap === "before" && $isPillNode(next)) || (gap === "after" && $isPillNode(prev)) ? null : gap;
                p.remove();
                if (drop === "after" && $isTextNode(next)) {
                    $setTextOrRemove(next, after.slice(1));
                } else if (drop === "before" && $isTextNode(prev)) {
                    $setTextOrRemove(prev, before.slice(0, -1));
                    caret -= i === 0 ? 1 : 0;
                }
            });
        $selectOffsets($readDoc(), caret, caret);
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

/** ← with the caret right after a pill or a badge, or → right before one, opens it into its text (`@path`, a reference as
 *  written) to be edited: the caret lands in that text (`openedCaret`), where a mention stays text. Once the caret leaves
 *  it, it is a pill again (the Bridge's `opened`, `$unsettledText`). Shift or a modifier keeps the editor's own move. True
 *  when the key was taken. */
function $openPill(e: KeyboardEvent): boolean {
    if ((e.key !== "ArrowLeft" && e.key !== "ArrowRight") || e.shiftKey || e.altKey || e.ctrlKey || e.metaKey) {
        return false;
    }
    const selection = $getSelection();
    if (!$isRangeSelection(selection) || !selection.isCollapsed()) {
        return false;
    }
    const backward = e.key === "ArrowLeft";
    const doc = $readDoc();
    const place = $placeOfPoint(selection.focus, doc);
    const found = adjacentPill(doc.lines[place.line] ?? [], place.index, place.offset, backward);
    if (found == null) {
        return false;
    }
    e.preventDefault();
    const start = placeOffset(doc.lines, { line: place.line, index: found, offset: 0 });
    const end = placeOffset(doc.lines, { line: place.line, index: found, offset: 1 });
    const pill = doc.nodes[place.line][found];
    pill.replace($createTextNode(pill.getTextContent()));
    const caret = openedCaret(start, end, backward);
    $selectOffsets($readDoc(), caret, caret);
    return true;
}

/** whether a text node holds a finished mention or reference the caret is not in (an opened pill the caret has left).
 *  Only with a caret, not mid-drag. */
function $unsettledText(): boolean {
    const selection = $getSelection();
    if ($isRangeSelection(selection) && !selection.isCollapsed()) {
        return false;
    }
    const focus = $isRangeSelection(selection) ? selection.focus : null;
    return $getRoot()
        .getChildren()
        .some(
            (p) =>
                $isElementNode(p) &&
                p
                    .getChildren()
                    .filter($isTextNode)
                    .some(
                        (n) =>
                            atomRunsIn(
                                n.getTextContent(),
                                focus?.type === "text" && focus.key === n.getKey() ? focus.offset : undefined
                            ).length > 0
                    )
        );
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

/** A paste of code or a log goes in fenced (chatmarks.ts codePaste), in two undo steps: the raw paste, as the editor's
 *  own paste puts it in, then the fence around it, so one undo leaves the raw paste. Runs in the paste command's update;
 *  the fence goes in an update of its own once it has committed. True when the paste was taken; a bash command is never
 *  fenced (the shell would get the backticks). */
function $pasteCode(editor: LexicalEditor, event: ClipboardEvent, bash: boolean): boolean {
    const pasted = event.clipboardData?.getData("text/plain") ?? "";
    const selection = $getSelection();
    if (bash || pasted === "" || !$isRangeSelection(selection)) {
        return false;
    }
    const doc = $readDoc();
    const at = $selectionOffsets(doc);
    const paste = at == null ? null : codePaste(linesText(doc.lines), at.start, at.end, pasted);
    if (at == null || paste == null) {
        return false;
    }
    event.preventDefault();
    $addUpdateTag(HISTORY_PUSH_TAG);
    selection.insertRawText(paste.raw);
    // a task, not a microtask: Lexical commits the paste's update in a microtask it queues after this one, and an update
    // made before that commit joins it, one undo step with the paste
    setTimeout(() =>
        editor.update(
            () => {
                $selectOffsets($readDoc(), at.start, at.start + paste.raw.length);
                const raw = $getSelection();
                if ($isRangeSelection(raw)) {
                    raw.insertRawText(paste.fenced);
                }
            },
            { tag: HISTORY_PUSH_TAG }
        )
    );
    return true;
}

/** A long paste goes to `fold` (a chip over the text) instead of into the text. Runs in the paste command's update; true
 *  when the paste was taken. */
function $foldPaste(event: ClipboardEvent, fold: (pasted: string) => void): boolean {
    const pasted = event.clipboardData?.getData("text/plain") ?? "";
    if (pasted === "" || !$isRangeSelection($getSelection())) {
        return false;
    }
    const doc = $readDoc();
    const at = $selectionOffsets(doc);
    if (at == null || !foldsPaste(linesText(doc.lines), at.start, pasted)) {
        return false;
    }
    event.preventDefault();
    fold(pasted);
    return true;
}

const NO_RECT = typeof DOMRect === "undefined" ? ({} as DOMRect) : new DOMRect();

// ---- the editor ----

interface Said {
    text: string;
    caret: number;
    skip: number;
}

interface BridgeProps {
    props: React.MutableRefObject<ChatEditorProps>;
    /** what the editor last said to its parent (the whole text and caret, a bash `!` included), and how many leading
     *  characters of it the editor leaves out (`skip`, the bash `!`) */
    said: React.MutableRefObject<Said>;
}

/** the plugin that connects the Lexical editor to the box's props, its handle and its keys */
const Bridge = forwardRef<EditorLike, BridgeProps>(function Bridge({ props, said }, ref) {
    const [editor] = useLexicalComposerContext();
    const wasFocused = useRef(false);
    /** a pill was opened into its text with ← / → and is not a pill again yet */
    const opened = useRef(false);

    const handle = useMemo<EditorLike>(() => {
        // in the whole text's offsets: past the `!` the editor leaves out
        const offsets = () => {
            const at = editor.read(() => $selectionOffsets($readDoc()));
            const skip = said.current.skip;
            return at == null
                ? { start: said.current.text.length, end: said.current.text.length }
                : { start: at.start + skip, end: at.end + skip };
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
                const skip = said.current.skip;
                editor.update(() => $selectOffsets($readDoc(), Math.max(0, start - skip), Math.max(0, end - skip)), {
                    discrete: true,
                });
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

    // a space between a pill and text typed against it, and a finished `@path` or reference typed or pasted becoming a
    // pill or a badge ($settleTypedText). Not while composing: changing the text under an IME drops the syllable being
    // typed, so the text nodes are looked at again once the composition ends (a token finished through a Telex or Pinyin
    // composition becomes its badge then, not on the next key)
    useLayoutEffect(() => {
        const offTransform = editor.registerNodeTransform(TextNode, (node) => {
            if (!editor.isComposing()) {
                $settleTypedText(node, props.current.bash ?? false);
            }
        });
        const offComposed = editor.registerCommand(
            COMPOSITION_END_COMMAND,
            () => {
                queueMicrotask(() =>
                    editor.update(() => {
                        const bash = props.current.bash ?? false;
                        for (const paragraph of $getRoot().getChildren()) {
                            if ($isElementNode(paragraph)) {
                                // a snapshot: a node a token was cut out of is gone, its parts are looked at by the transform
                                for (const node of paragraph.getChildren().filter($isTextNode)) {
                                    if (node.isAttached()) {
                                        $settleTypedText(node, bash);
                                    }
                                }
                            }
                        }
                    })
                );
                return false;
            },
            COMMAND_PRIORITY_HIGH
        );
        // a caret move changes no text node, so the transform does not see a pill opened with ← / → that the caret has
        // left: it is settled here, in the undo step the move belongs to. Only while one is open (`opened`), so a mention
        // being typed and walked away from stays text, as it did
        const offLeft = editor.registerUpdateListener(({ editorState, tags }) => {
            if (!opened.current) {
                return;
            }
            if (tags.has("external") || props.current.bash) {
                opened.current = false;
                return;
            }
            if (editor.isComposing() || !editorState.read($unsettledText)) {
                return;
            }
            opened.current = false;
            editor.update(
                () => {
                    for (const paragraph of $getRoot().getChildren()) {
                        if ($isElementNode(paragraph)) {
                            for (const node of paragraph.getChildren().filter($isTextNode)) {
                                if (node.isAttached()) {
                                    $settleTypedText(node, false);
                                }
                            }
                        }
                    }
                },
                { tag: HISTORY_MERGE_TAG }
            );
        });
        return () => {
            offTransform();
            offComposed();
            offLeft();
        };
    }, [editor, props]);

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
                const skip = said.current.skip;
                const next = editorState.read(() => {
                    const doc = $readDoc();
                    const shown = linesText(doc.lines);
                    const out = fromShown(shown, $selectionOffsets(doc)?.end ?? shown.length, skip);
                    return { ...out, pill: $selectionOnPill(doc) };
                });
                if (
                    next.text === said.current.text &&
                    next.caret === said.current.caret &&
                    next.pill === onPill.current
                ) {
                    return;
                }
                said.current = { text: next.text, caret: next.caret, skip };
                onPill.current = next.pill;
                props.current.onChange(next.text, next.caret);
            }),
        [editor, props, said]
    );

    // a value that is not what the editor last said comes from outside: draw it (never in the middle of a composition,
    // which would drop the syllable being typed: it is held, and drawn when the composition ends). So is the editor's own
    // text when the `!` it leaves out changed: a typed or pasted `!` first made it a bash command, and the editor now
    // shows only what follows it, the caret where it was
    const { value, bash = false } = props.current;
    useLayoutEffect(() => {
        const skip = bangSkip(value, bash);
        if (value === said.current.text && skip === said.current.skip) {
            held.current = false;
            return;
        }
        if (editor.isComposing()) {
            held.current = true;
            return;
        }
        held.current = false;
        const ask = props.current.outsideCaret;
        const caret =
            ask != null && ask.text === value
                ? Math.min(Math.max(ask.caret, 0), value.length)
                : value === said.current.text
                  ? said.current.caret
                  : null;
        const focused = isFocused(editor);
        said.current = { text: value, caret: caret ?? value.length, skip };
        const shown = shownText(value, skip);
        const at = caret == null ? null : Math.max(0, caret - skip);
        // a bash command draws no pills: `@path` stays text, which the ghost text's mirror of the text lines up with
        editor.update(
            () => $rebuild(segmentsOf(shown, at ?? undefined, { pills: !bash }), at ?? (focused ? shown.length : null)),
            {
                tag: "external",
                discrete: true,
            }
        );
        onPill.current = editor.read(() => $selectionOnPill($readDoc()));
        // like a textarea whose value is set from outside, what came before is not undoable
        editor.dispatchCommand(CLEAR_HISTORY_COMMAND, undefined);
    }, [editor, value, bash, composed, props, said]);

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
                if (!props.current.bash && $openPill(event)) {
                    opened.current = true;
                    return true;
                }
                return $leaveSelectedPill(event);
            },
            COMMAND_PRIORITY_HIGH
        );
        const offBackspace = editor.registerCommand(
            KEY_BACKSPACE_COMMAND,
            (event: KeyboardEvent) => {
                // at the start of a bash command, Backspace takes the `!` drawn beside the editor away (as it took the
                // character before the caret when the `!` was in it), and the box leaves bash mode
                if (said.current.skip > 0 && $caretAtStart()) {
                    event.preventDefault();
                    const shown = linesText($readDoc().lines);
                    said.current = { text: shown, caret: 0, skip: 0 };
                    props.current.onChange(shown, 0);
                    return true;
                }
                return $deletePill(event, true);
            },
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
                if (!("clipboardData" in event)) {
                    return false;
                }
                const files = props.current.onPasteFiles;
                if (files != null && clipboardHasFiles(event)) {
                    if (!files(event)) {
                        return false;
                    }
                    event.preventDefault();
                    return true;
                }
                const fold = props.current.onLongPaste;
                if (fold != null && !props.current.bash && $foldPaste(event, fold)) {
                    return true;
                }
                return $pasteCode(editor, event, props.current.bash ?? false);
            },
            COMMAND_PRIORITY_HIGH
        );
        return () => {
            offDown();
            offBackspace();
            offDelete();
            offPaste();
        };
    }, [editor, handle, props, said]);

    return null;
});

/** Keeps the ghost layer scrolled where the editor is: the editor scrolls once its text passes its max height, and the layer
 *  (which mirrors the text, `overflow-hidden`) would otherwise stay at the top, with the ghost off the last line. Set when
 *  it mounts (a ghost that shows while the editor is already scrolled) and again when the text or the ghost changes, and on
 *  the editor's `scroll`. Setting `scrollTop` from code moves an `overflow-hidden` box. Past its max height the editor
 *  also gives its scrollbar a strip of its width, which the layer (no scrollbar) does not: the layer is padded on the right
 *  by that strip, so its text wraps at the editor's width and the ghost stays after the last character. */
function GhostScroll({ layer, text, ghost }: { layer: RefObject<HTMLDivElement | null>; text: string; ghost: string }) {
    const [editor] = useLexicalComposerContext();
    const sync = useRef(() => {});
    sync.current = () => {
        const root = editor.getRootElement();
        const el = layer.current;
        if (root == null || el == null) {
            return;
        }
        const bar = `${Math.max(0, root.offsetWidth - root.clientWidth)}px`;
        if (el.style.paddingRight !== bar) {
            el.style.paddingRight = bar;
        }
        if (el.scrollTop !== root.scrollTop) {
            el.scrollTop = root.scrollTop;
        }
    };
    // after the layer's own content is drawn, so the box has the height to scroll
    useLayoutEffect(() => sync.current(), [text, ghost]);
    useLayoutEffect(() => {
        const onScroll = () => sync.current();
        // called with the root now and again when it changes; the remover calls it with `null`
        return editor.registerRootListener((root, prev) => {
            prev?.removeEventListener("scroll", onScroll);
            root?.addEventListener("scroll", onScroll, { passive: true });
        });
    }, [editor]);
    return null;
}

export const ChatEditor = forwardRef<EditorLike, ChatEditorProps>(function ChatEditor(p, ref) {
    const props = useRef(p);
    props.current = p;
    const ghostLayer = useRef<HTMLDivElement>(null);
    const skip = bangSkip(p.value, p.bash === true);
    const said = useRef<Said>({ text: p.value, caret: p.value.length, skip });
    const ghost = p.ghost ?? "";
    const shown = shownText(p.value, skip);
    // the layer under the editor shows for the ghost text, and for a bash command, which it draws in colour
    const mirror = ghost !== "" || skip > 0;
    // read once, when the editor is made; later values reach it through the Bridge
    const [initialConfig] = useState(() => ({
        namespace: "arc-chat-editor",
        nodes: [FileMentionNode, RefMentionNode],
        editable: !p.readOnly,
        onError: (error: Error) => console.error("chat editor:", error),
        // the draft the box mounts with (a restored one, with its pills; a bash command has none)
        editorState: () => $rebuild(segmentsOf(shown, undefined, { pills: p.bash !== true }), null),
    }));
    return (
        <LexicalComposer initialConfig={initialConfig}>
            <div className={cn("flex min-w-0 items-start", p.className)}>
                {/* a bash command's `!`, beside the editor and a gap before the command (the editor holds what follows it) */}
                {skip > 0 ? (
                    <span
                        aria-hidden
                        data-chat-bang=""
                        className="mr-2 flex-none leading-[1.9] font-semibold text-accent select-none"
                    >
                        !
                    </span>
                ) : null}
                <div className="relative min-w-0 flex-1">
                    <PlainTextPlugin
                        contentEditable={
                            <ContentEditable
                                data-chat-input=""
                                {...p.dataAttrs}
                                role="textbox"
                                aria-multiline="true"
                                aria-label="Message"
                                // off on Windows, where WebView2's English checker would underline every Vietnamese
                                // word, as the app's other boxes do; on a Mac it stays on, since WebKit runs Text
                                // Replacement (sv → sinh viên) only where spellcheck is on, and the host turns the
                                // underlines off there instead (main.rs no_spelling_underlines)
                                spellCheck={isMacOS()}
                                onBlur={(e) => props.current.onBlur?.(e.nativeEvent)}
                                // relative z-[1]: the placeholder and the ghost layer are absolute, so they would paint
                                // over the caret (a positioned box paints above in-flow content); this keeps it on top
                                // a bash command's own text is see-through: the mirror under it draws it in the shell's colours
                                className={cn(
                                    // select-text: Chat's dock is select-none, and the box keeps its own text selectable
                                    "relative z-[1] block overflow-y-auto leading-[1.9] whitespace-pre-wrap outline-none select-text [overflow-wrap:anywhere] data-[pill-selected]:caret-transparent",
                                    skip > 0 &&
                                        // the system's selection colour, as Chat's replies draw theirs (tailwindsetup.css
                                        // .md-selection-band), light enough that the coloured text under it shows
                                        "text-transparent caret-primary selection:bg-[color-mix(in_srgb,Highlight_35%,transparent)] selection:text-transparent"
                                )}
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
                    {/* A mirror of the text laid under the editor, with the same type and wrapping, so what it draws lands
                    exactly where the editor's own text is: a bash command in the shell's colours (the editor's text is
                    see-through then), any other text invisible, and the ghost after the last character. */}
                    {mirror ? (
                        <div
                            ref={ghostLayer}
                            aria-hidden
                            data-chat-ghost-layer=""
                            className="pointer-events-none absolute inset-0 overflow-hidden leading-[1.9] whitespace-pre-wrap select-none [overflow-wrap:anywhere]"
                        >
                            {skip > 0 ? (
                                <span data-chat-bash-colors="">
                                    {shown.split("\n").map((ln, i) => (
                                        <Fragment key={i}>
                                            {i > 0 ? "\n" : null}
                                            {/* an empty line draws nothing: shellLine's stand-in space would push the ghost */}
                                            {ln === ""
                                                ? null
                                                : shellLine(ln).map((tk, k) => (
                                                      <span key={k} className={tk.cls}>
                                                          {tk.t}
                                                      </span>
                                                  ))}
                                        </Fragment>
                                    ))}
                                </span>
                            ) : (
                                <span className="invisible">{shown}</span>
                            )}
                            {ghost !== "" ? (
                                <span data-chat-ghost="" className="text-ink-faint">
                                    {ghost}
                                </span>
                            ) : null}
                        </div>
                    ) : null}
                    {/* after the layer, so its ref is set when this lays out */}
                    {mirror ? <GhostScroll layer={ghostLayer} text={shown} ghost={ghost} /> : null}
                    <HistoryPlugin />
                    <Bridge ref={ref} props={props} said={said} />
                </div>
            </div>
        </LexicalComposer>
    );
});
