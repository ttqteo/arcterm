// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The DOM half of the review dialog's quoted notes (docreviewnotes.ts is the model): reading a selection as
// offsets into the document's text, painting the quoted passages, the note field under a selection, and the
// rail's list of notes.

import { cn } from "@/util/util";
import { ChevronDown, X } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, type KeyboardEvent, type RefObject } from "react";
import { isPaintable, normalizePassage, type DocNote } from "./docreviewnotes";

export type PendingPassage = Pick<DocNote, "start" | "end" | "text">;

const HIGHLIGHT_QUOTED = "doc-review-quoted";
const HIGHLIGHT_PENDING = "doc-review-pending";
const FIELD_GAP = 6;
const NOTE_PLACEHOLDER = "What should change here";

// a range's string is its text nodes' data, so this counts the same characters as root.textContent
function offsetOf(root: Node, node: Node, offset: number): number {
    const before = document.createRange();
    before.setStart(root, 0);
    before.setEnd(node, offset);
    return before.toString().length;
}

function rangeOf(root: Node, start: number, end: number): Range | null {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const range = document.createRange();
    let pos = 0;
    let started = false;
    for (let node = walker.nextNode(); node != null; node = walker.nextNode()) {
        const len = node.nodeValue?.length ?? 0;
        if (!started && start < pos + len) {
            range.setStart(node, start - pos);
            started = true;
        }
        if (started && end <= pos + len) {
            range.setEnd(node, end - pos);
            return range;
        }
        pos += len;
    }
    return null;
}

// null unless the selection holds text and both its ends are inside root
export function readSelection(root: HTMLElement | null): PendingPassage | null {
    const sel = window.getSelection();
    if (root == null || sel == null || sel.isCollapsed || sel.rangeCount === 0) {
        return null;
    }
    const range = sel.getRangeAt(0);
    const text = normalizePassage(sel.toString());
    if (text === "" || !root.contains(range.startContainer) || !root.contains(range.endContainer)) {
        return null;
    }
    return {
        start: offsetOf(root, range.startContainer, range.startOffset),
        end: offsetOf(root, range.endContainer, range.endOffset),
        text,
    };
}

const highlights = () => (typeof CSS !== "undefined" ? CSS.highlights : undefined);

// Painted through the CSS Custom Highlight API, so the rendered markdown is never rewrapped. textKey is what
// the document was rendered from: a new one means new text nodes, and ranges to rebuild.
export function useDocHighlights(
    docRef: RefObject<HTMLElement | null>,
    notes: DocNote[],
    pending: PendingPassage | null,
    textKey: string
) {
    useEffect(() => {
        const registry = highlights();
        const root = docRef.current;
        if (registry == null || root == null) {
            return;
        }
        const docText = root.textContent ?? "";
        const rangesOf = (passages: PendingPassage[]) => passages.flatMap((p) => rangeOf(root, p.start, p.end) ?? []);
        registry.set(HIGHLIGHT_QUOTED, new Highlight(...rangesOf(notes.filter((n) => isPaintable(n, docText)))));
        registry.set(HIGHLIGHT_PENDING, new Highlight(...rangesOf(pending ? [pending] : [])));
        return () => {
            registry.delete(HIGHLIGHT_QUOTED);
            registry.delete(HIGHLIGHT_PENDING);
        };
    }, [notes, pending, textKey]);
}

const plainKey = (e: KeyboardEvent, key: string) => e.key === key && !e.ctrlKey && !e.metaKey;

// Sits in the document's scroller so it scrolls with its passage. The scroller must be position: relative.
export function NoteField(p: {
    scrollRef: RefObject<HTMLElement | null>;
    docRef: RefObject<HTMLElement | null>;
    pending: PendingPassage;
    draft: string;
    onDraft: (v: string) => void;
    onAdd: () => void;
    onCancel: () => void;
}) {
    const fieldRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    // placed by hand before paint: under the passage, or above it when the pane has no room left below
    useLayoutEffect(() => {
        const field = fieldRef.current;
        const scroller = p.scrollRef.current;
        const range = p.docRef.current ? rangeOf(p.docRef.current, p.pending.start, p.pending.end) : null;
        if (field == null || scroller == null || range == null) {
            return;
        }
        const box = scroller.getBoundingClientRect();
        // the dialog scales while it opens, and rects are measured scaled
        const scale = box.width / scroller.offsetWidth || 1;
        const rect = range.getBoundingClientRect();
        const top = (rect.top - box.top) / scale + scroller.scrollTop;
        const bottom = (rect.bottom - box.top) / scale + scroller.scrollTop;
        const left = (rect.left - box.left) / scale + scroller.scrollLeft;
        const below = bottom + FIELD_GAP;
        const above = top - FIELD_GAP - field.offsetHeight;
        const fitsBelow = below + field.offsetHeight <= scroller.scrollTop + scroller.clientHeight;
        field.style.top = `${fitsBelow || above < scroller.scrollTop ? below : above}px`;
        field.style.left = `${Math.max(0, Math.min(left, scroller.clientWidth - field.offsetWidth))}px`;
        inputRef.current?.focus({ preventScroll: true });
    }, [p.pending]);

    // stopped so the dialog's window listener neither hides the dialog nor submits; ctrl+enter passes through
    const onKeyDown = (e: KeyboardEvent) => {
        if (plainKey(e, "Enter")) {
            e.preventDefault();
            e.stopPropagation();
            p.onAdd();
        } else if (e.key === "Escape") {
            e.stopPropagation();
            p.onCancel();
        }
    };

    return (
        <div
            ref={fieldRef}
            data-doc-note-field
            onMouseUp={(e) => e.stopPropagation()}
            className="absolute z-[2] flex w-[340px] flex-col gap-2 rounded-[8px] border border-edge-strong bg-surface-raised p-2 shadow-popover-sm"
        >
            <input
                ref={inputRef}
                type="text"
                value={p.draft}
                onChange={(e) => p.onDraft(e.target.value)}
                onKeyDown={onKeyDown}
                aria-label="Note on the selected passage"
                placeholder={NOTE_PLACEHOLDER}
                className="w-full rounded-[6px] border border-accent bg-background px-2 py-1.5 text-[13px] leading-[1.5] text-primary outline-none placeholder:text-muted"
            />
            <div className="flex items-center justify-end gap-2">
                <button
                    type="button"
                    onClick={p.onCancel}
                    className="inline-flex cursor-pointer items-center gap-1.5 rounded-[6px] border border-edge-mid bg-surface-raised px-[9px] py-1 text-[12px] font-semibold leading-[1.3] text-secondary hover:border-edge-strong hover:bg-surface-hover"
                >
                    Cancel
                    <span className="rounded-[4px] border border-edge-strong px-[5px] font-mono text-[10.5px] font-normal text-muted">
                        Esc
                    </span>
                </button>
                <button
                    type="button"
                    onClick={p.onAdd}
                    className="inline-flex cursor-pointer items-center gap-1.5 rounded-[6px] bg-accent px-[9px] py-[5px] text-[12px] font-semibold leading-[1.3] text-background hover:bg-accenthover"
                >
                    Add note
                    <span className="rounded-[4px] bg-background/20 px-[5px] font-mono text-[10.5px] font-normal">
                        Enter
                    </span>
                </button>
            </div>
        </div>
    );
}

const PASSAGE = "rounded-[4px] bg-accentbg text-[12px] leading-[1.5]";

function RemoveButton({ onRemove }: { onRemove: () => void }) {
    return (
        <button
            type="button"
            onClick={onRemove}
            aria-label="Remove this note"
            className="flex-none cursor-pointer rounded-[5px] p-1 leading-none text-muted hover:text-secondary"
        >
            <X size={13} aria-hidden />
        </button>
    );
}

// The rail's notes, under the decisions. locked (the answer left) leaves the rows readable and nothing else.
export function NotesSection(p: {
    notes: DocNote[];
    openId: string | null;
    collapsed: boolean;
    locked: boolean;
    onCollapse: (collapsed: boolean) => void;
    onOpen: (id: string | null) => void;
    onText: (id: string, note: string) => void;
    onRemove: (id: string) => void;
}) {
    if (p.notes.length === 0) {
        return null;
    }
    const closeOnKey = (e: KeyboardEvent) => {
        if (plainKey(e, "Enter") || e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            p.onOpen(null);
        }
    };
    return (
        <div data-doc-notes className="flex-none border-t border-edge-mid">
            <button
                type="button"
                data-doc-notes-toggle
                aria-expanded={!p.collapsed}
                onClick={() => p.onCollapse(!p.collapsed)}
                className="flex w-full cursor-pointer items-center gap-2 px-5 pb-[9px] pt-[11px] text-left text-muted"
            >
                <span className="flex-1 font-mono text-[10.5px] font-bold uppercase tracking-[0.1em]">
                    Your notes · {p.notes.length}
                </span>
                <ChevronDown size={13} aria-hidden className={cn(p.collapsed && "-rotate-90")} />
            </button>
            {p.collapsed ? null : (
                <div className="sc max-h-[300px] overflow-y-auto px-5 pb-2">
                    {p.notes.map((n) =>
                        n.id === p.openId && !p.locked ? (
                            <div
                                key={n.id}
                                data-doc-note-row={n.id}
                                data-open="true"
                                className="mb-1.5 flex flex-col gap-1.5 rounded-[7px] border border-accent bg-background p-2"
                            >
                                <div className="flex items-start gap-2">
                                    <div className={cn(PASSAGE, "min-w-0 flex-1 px-[5px] py-0.5 text-secondary")}>
                                        {n.text}
                                    </div>
                                    <RemoveButton onRemove={() => p.onRemove(n.id)} />
                                </div>
                                <input
                                    type="text"
                                    autoFocus
                                    value={n.note}
                                    onChange={(e) => p.onText(n.id, e.target.value)}
                                    onKeyDown={closeOnKey}
                                    aria-label="What should change in this passage"
                                    placeholder={NOTE_PLACEHOLDER}
                                    className="w-full rounded-[6px] border border-edge-mid bg-surface-raised px-2 py-[5px] text-[12.5px] leading-[1.5] text-primary outline-none placeholder:text-muted"
                                />
                            </div>
                        ) : (
                            <div
                                key={n.id}
                                data-doc-note-row={n.id}
                                className="mb-1.5 flex items-center gap-2 rounded-[7px] border border-edge-mid bg-background py-[7px] pl-2 pr-1.5"
                            >
                                <button
                                    type="button"
                                    disabled={p.locked}
                                    onClick={() => p.onOpen(n.id)}
                                    aria-label="Edit this note"
                                    className="flex min-w-0 flex-1 cursor-pointer flex-col gap-[3px] text-left disabled:cursor-default"
                                >
                                    <span
                                        className={cn(PASSAGE, "max-w-full self-start truncate px-[5px] text-ink-mid")}
                                    >
                                        {n.text}
                                    </span>
                                    <span
                                        className={cn(
                                            "max-w-full truncate text-[12.5px] leading-[1.5]",
                                            n.note.trim() ? "text-primary" : "text-muted"
                                        )}
                                    >
                                        {n.note.trim() || "No note yet"}
                                    </span>
                                </button>
                                {p.locked ? null : <RemoveButton onRemove={() => p.onRemove(n.id)} />}
                            </div>
                        )
                    )}
                </div>
            )}
        </div>
    );
}
