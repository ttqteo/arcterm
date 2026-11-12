// frontend/app/view/agents/diffcommentlayer.ts
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// The comment layer over the Diff pane's Monaco diff editor: the + in the glyph margin, `m` on a
// selection, and the draft, pending and split-hint cards as view zones under their lines. The cards
// themselves are React (diffcommentcard.tsx), portalled into the zone nodes this layer publishes.
//
// Two Monaco traps are closed here. A zone node stops key and mouse events from bubbling, or Monaco
// would run its own commands on what is typed into a card and pull focus back into the editor on a
// click. And `m` inside the editor is an editor action, because the surface's dispatcher lets every key
// through while Monaco has focus; with focus on the surface, Task 4's binding calls commentOnSelection.

import { globalStore } from "@/app/store/jotaiStore";
import { atom, type PrimitiveAtom } from "jotai";
import type * as MonacoTypes from "monaco-editor";
import { commentableSide, removedOnlyHunks, selectedLines } from "./diffcommentmodel";
import {
    activeCommentSourceAtom,
    commentDraftAtom,
    commentsOnPair,
    commentStoreAtom,
    quoteLines,
    samePair,
    type CommentSide,
} from "./diffcomments";
import { diffPairAtom } from "./diffcontentstore";

type Monaco = typeof MonacoTypes;
type CodeEditor = MonacoTypes.editor.IStandaloneCodeEditor;

export interface CommentZone {
    key: string;
    // the portal target, inside the node Monaco positions
    node: HTMLElement;
    kind: "card" | "draft" | "hint";
    side: CommentSide;
    commentId?: string;
}

// whether the pane is drawing two editors, published by the pane: split also needs the pane's width
export const commentSplitAtom = atom(false) as PrimitiveAtom<boolean>;

export const commentZonesAtom = atom<CommentZone[]>([]) as PrimitiveAtom<CommentZone[]>;

// Monaco gives a zone with no ordinal 10000, which is what the diff editor's own removed-line zones get:
// a card sits right under its line, above a removed block hung on the same line, and the hint below it.
const CARD_ORDINAL = 9999;
const HINT_ORDINAL = 10001;

// the zone's height until the ResizeObserver reports the card's own
const GUESS_PX: Record<CommentZone["kind"], number> = { card: 80, draft: 150, hint: 26 };

// Monaco listens for these on the editor's DOM, in the bubble phase
const STOPPED_EVENTS = ["keydown", "keyup", "keypress", "mousedown", "pointerdown"];

interface Layer {
    commentOn(side: CommentSide): boolean;
}

let mounted: Layer | null = null;

// `m` with focus on the surface: the right editor's selection, or its cursor line. false = no editor
// mounted, or no source published, so the binding can let the key pass.
export function commentOnSelection(): boolean {
    return mounted?.commentOn("modified") ?? false;
}

function openDraft(side: CommentSide, start: number, end: number): boolean {
    const pair = globalStore.get(diffPairAtom);
    if (
        pair == null ||
        globalStore.get(activeCommentSourceAtom) == null ||
        !commentableSide(side, globalStore.get(commentSplitAtom))
    ) {
        return false;
    }
    globalStore.set(commentDraftAtom, {
        path: pair.path,
        side,
        start,
        end,
        quote: quoteLines(pair[side], start, end),
        refs: pair.refs,
        note: "",
    });
    return true;
}

interface ZoneSpec {
    kind: CommentZone["kind"];
    side: CommentSide;
    afterLine: number;
    commentId?: string;
}

interface PlacedZone {
    zone: CommentZone;
    id: string;
    delegate: MonacoTypes.editor.IViewZone;
    ro: ResizeObserver;
}

// what should be drawn on the open pair right now, by zone key
function wantedZones(diff: MonacoTypes.editor.IStandaloneDiffEditor): Map<string, ZoneSpec> {
    const want = new Map<string, ZoneSpec>();
    const pair = globalStore.get(diffPairAtom);
    const source = globalStore.get(activeCommentSourceAtom);
    if (pair == null) {
        return want;
    }
    const split = globalStore.get(commentSplitAtom);
    const draft = globalStore.get(commentDraftAtom);
    const comments =
        source == null ? [] : commentsOnPair(globalStore.get(commentStoreAtom)[source.key], pair.path, pair.refs);
    for (const c of comments) {
        if (commentableSide(c.side, split)) {
            want.set(`card:${c.id}`, { kind: "card", side: c.side, afterLine: c.end, commentId: c.id });
        }
    }
    // an edit opens in its card's own zone
    const editingDrawn = draft?.editingId != null && want.has(`card:${draft.editingId}`);
    if (
        draft != null &&
        source != null &&
        !editingDrawn &&
        draft.path === pair.path &&
        samePair(draft.refs, pair.refs) &&
        commentableSide(draft.side, split)
    ) {
        want.set("draft", { kind: "draft", side: draft.side, afterLine: draft.end });
    }
    if (!split) {
        for (const line of removedOnlyHunks(diff.getLineChanges() ?? [], pair.modified === "")) {
            want.set(`hint:${line}`, { kind: "hint", side: "modified", afterLine: line });
        }
    }
    return want;
}

function stopPropagation(e: Event): void {
    e.stopPropagation();
}

// lucide's plus, drawn rather than typed: a text + sits on the font's baseline, low and off-center
const PLUS_ICON =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" aria-hidden="true"><path d="M12 6v12M6 12h12"/></svg>';

// the + on the hovered line of one editor; a glyph-margin widget so it carries its own DOM and click
function plusWidget(monaco: Monaco, editor: CodeEditor, side: CommentSide) {
    const node = document.createElement("div");
    node.className = "diff-comment-plus";
    node.dataset.diffCommentPlus = side;
    node.setAttribute("role", "button");
    node.title = "Comment on this line (m)";
    node.innerHTML = PLUS_ICON;
    let line = 0;
    let shown = false;
    const widget: MonacoTypes.editor.IGlyphMarginWidget = {
        getId: () => `arc.diff-comment-plus.${side}`,
        getDomNode: () => node,
        getPosition: () => ({
            lane: monaco.editor.GlyphMarginLane.Center,
            zIndex: 10,
            range: { startLineNumber: line, startColumn: 1, endLineNumber: line, endColumn: 1 },
        }),
    };
    const hide = () => {
        if (shown) {
            editor.removeGlyphMarginWidget(widget);
            shown = false;
        }
    };
    // preventDefault too: Monaco would select the line and focus itself
    node.addEventListener("mousedown", (e) => {
        e.stopPropagation();
        e.preventDefault();
    });
    node.addEventListener("pointerdown", stopPropagation);
    node.addEventListener("click", (e) => {
        e.stopPropagation();
        if (openDraft(side, line, line)) {
            hide();
        }
    });
    return {
        show(n: number) {
            if (shown && n === line) {
                return;
            }
            line = n;
            node.setAttribute("aria-label", `Comment on line ${n}`);
            if (shown) {
                editor.layoutGlyphMarginWidget(widget);
            } else {
                editor.addGlyphMarginWidget(widget);
                shown = true;
            }
        },
        hide,
        node,
    };
}

export function mountCommentLayer(diff: MonacoTypes.editor.IStandaloneDiffEditor, monaco: Monaco): () => void {
    const editors: Record<CommentSide, CodeEditor> = {
        modified: diff.getModifiedEditor(),
        original: diff.getOriginalEditor(),
    };
    const sides: CommentSide[] = ["modified", "original"];
    const placed = new Map<string, PlacedZone>();
    const ranges = {
        modified: editors.modified.createDecorationsCollection(),
        original: editors.original.createDecorationsCollection(),
    };
    const pluses = {
        modified: plusWidget(monaco, editors.modified, "modified"),
        original: plusWidget(monaco, editors.original, "original"),
    };

    // Monaco draws zone changes on its next frame; rendering now attaches a new card's node before it mounts
    // and wants focus, and keeps the cards under a removed or resized zone from sitting a frame out of place
    const changeZones = (side: CommentSide, change: (a: MonacoTypes.editor.IViewZoneChangeAccessor) => void) => {
        editors[side].changeViewZones(change);
        editors[side].render();
    };

    const removeZone = (p: PlacedZone) => {
        p.ro.disconnect();
        changeZones(p.zone.side, (a) => a.removeZone(p.id));
        placed.delete(p.zone.key);
    };

    const addZone = (key: string, spec: ZoneSpec) => {
        const outer = document.createElement("div");
        const inner = document.createElement("div");
        outer.appendChild(inner);
        STOPPED_EVENTS.forEach((ev) => outer.addEventListener(ev, stopPropagation));
        const delegate: MonacoTypes.editor.IViewZone = {
            afterLineNumber: spec.afterLine,
            heightInPx: GUESS_PX[spec.kind],
            domNode: outer,
            ordinal: spec.kind === "hint" ? HINT_ORDINAL : CARD_ORDINAL,
        };
        let id = "";
        changeZones(spec.side, (a) => {
            id = a.addZone(delegate);
        });
        const ro = new ResizeObserver(() => {
            const h = inner.offsetHeight;
            // 0 while Monaco hides the zone in a folded region; keep the last real height
            if (h > 0 && h !== delegate.heightInPx) {
                delegate.heightInPx = h;
                changeZones(spec.side, (a) => a.layoutZone(id));
            }
        });
        ro.observe(inner);
        const zone: CommentZone = { key, node: inner, kind: spec.kind, side: spec.side, commentId: spec.commentId };
        placed.set(key, { zone, id, delegate, ro });
    };

    const drawRanges = () => {
        const pair = globalStore.get(diffPairAtom);
        const source = globalStore.get(activeCommentSourceAtom);
        const draft = globalStore.get(commentDraftAtom);
        const split = globalStore.get(commentSplitAtom);
        const marked: Record<CommentSide, MonacoTypes.editor.IModelDeltaDecoration[]> = { modified: [], original: [] };
        const mark = (side: CommentSide, start: number, end: number) => {
            if (commentableSide(side, split)) {
                marked[side].push({
                    range: new monaco.Range(start, 1, end, 1),
                    options: { isWholeLine: true, className: "diff-comment-range" },
                });
            }
        };
        if (pair != null && source != null) {
            commentsOnPair(globalStore.get(commentStoreAtom)[source.key], pair.path, pair.refs).forEach((c) =>
                mark(c.side, c.start, c.end)
            );
            if (draft != null && draft.path === pair.path && samePair(draft.refs, pair.refs)) {
                mark(draft.side, draft.start, draft.end);
            }
        }
        sides.forEach((s) => ranges[s].set(marked[s]));
    };

    const reconcile = () => {
        const want = wantedZones(diff);
        let changed = false;
        for (const p of [...placed.values()]) {
            const w = want.get(p.zone.key);
            if (w == null || w.side !== p.zone.side) {
                removeZone(p);
                changed = true;
            }
        }
        for (const [key, spec] of want) {
            const p = placed.get(key);
            if (p == null) {
                addZone(key, spec);
                changed = true;
            } else if (p.delegate.afterLineNumber !== spec.afterLine) {
                // moved by a re-find: the same node, so a focused card keeps its focus
                p.delegate.afterLineNumber = spec.afterLine;
                changeZones(spec.side, (a) => a.layoutZone(p.id));
            }
        }
        if (changed && mounted === layer) {
            globalStore.set(
                commentZonesAtom,
                [...placed.values()].map((p) => p.zone)
            );
        }
        drawRanges();
    };

    const layer: Layer = {
        commentOn(side) {
            const editor = editors[side];
            const sel = editor.getSelection();
            if (sel == null) {
                return false;
            }
            const { start, end } = selectedLines(sel);
            if (!openDraft(side, start, end)) {
                return false;
            }
            editor.revealLineInCenterIfOutsideViewport(end);
            return true;
        },
    };
    mounted = layer;

    const hoverable = new Set<MonacoTypes.editor.MouseTargetType>([
        monaco.editor.MouseTargetType.CONTENT_TEXT,
        monaco.editor.MouseTargetType.CONTENT_EMPTY,
        monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN,
        monaco.editor.MouseTargetType.GUTTER_LINE_NUMBERS,
        monaco.editor.MouseTargetType.GUTTER_LINE_DECORATIONS,
    ]);
    const disposables: MonacoTypes.IDisposable[] = [diff.onDidUpdateDiff(reconcile)];
    for (const side of sides) {
        const editor = editors[side];
        const plus = pluses[side];
        disposables.push(
            editor.onMouseMove((e) => {
                if (plus.node.contains(e.target.element)) {
                    return;
                }
                const line = e.target.position?.lineNumber;
                const can =
                    globalStore.get(activeCommentSourceAtom) != null &&
                    commentableSide(side, globalStore.get(commentSplitAtom));
                if (line != null && can && hoverable.has(e.target.type)) {
                    plus.show(line);
                } else {
                    plus.hide();
                }
            }),
            editor.onMouseLeave(() => plus.hide()),
            editor.addAction({
                id: "arc.diff.comment",
                label: "Comment on the selected lines",
                keybindings: [monaco.KeyCode.KeyM],
                precondition: "editorTextFocus",
                run: () => {
                    layer.commentOn(side);
                },
            })
        );
    }
    const unsubs = [diffPairAtom, commentStoreAtom, commentDraftAtom, activeCommentSourceAtom, commentSplitAtom].map(
        (a) => globalStore.sub(a, reconcile)
    );
    reconcile();
    globalStore.set(
        commentZonesAtom,
        [...placed.values()].map((p) => p.zone)
    );

    return () => {
        unsubs.forEach((u) => u());
        disposables.forEach((d) => d.dispose());
        sides.forEach((s) => {
            pluses[s].hide();
            ranges[s].clear();
        });
        [...placed.values()].forEach(removeZone);
        // by identity, as diffnav.ts does: a teardown that lands after the next editor mounted must not
        // unregister it
        if (mounted === layer) {
            mounted = null;
            globalStore.set(commentZonesAtom, []);
        }
    };
}
