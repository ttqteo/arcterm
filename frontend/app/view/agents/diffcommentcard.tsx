// frontend/app/view/agents/diffcommentcard.tsx
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// The cards the comment layer (diffcommentlayer.ts) hangs under diff lines: the draft, a pending
// comment, and the unified view's hint to switch to split. Portalled into the layer's view-zone nodes,
// which stop key and mouse events from bubbling into Monaco. That also keeps them from React's root
// listener, so the textarea's keys are native listeners, not onKeyDown.

import { globalStore } from "@/app/store/jotaiStore";
import { formatChordString } from "@/util/keysym";
import { cn } from "@/util/util";
import { useAtomValue } from "jotai";
import { MessageSquare, Pencil, Trash2 } from "lucide-react";
import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { commentZonesAtom, type CommentZone } from "./diffcommentlayer";
import { draftTitle, rangeLabel } from "./diffcommentmodel";
import {
    activeCommentSourceAtom,
    addComment,
    commentDraftAtom,
    commentStoreAtom,
    deleteComment,
    type CommentDraft,
    type PendingComment,
} from "./diffcomments";
import { splitAvailableAtom, splitHintText } from "./diffoptions";

const cardBox = "max-w-[640px] rounded-[8px] border bg-surface-raised font-sans";
const cardHeader = "flex h-[32px] items-center gap-[8px] border-b border-edge-faint";
const footBtn = "flex h-[28px] items-center gap-[6px] rounded-[8px] px-[10px] text-[11.5px]";
const iconBtn = "flex h-[26px] w-[26px] items-center justify-center rounded-[6px] text-muted hover:text-ink-hi";

// Adding or cancelling hands the keys back to the surface, so Shift+Enter and the rest work next.
function closeDraft(): void {
    (document.activeElement as HTMLElement | null)?.blur();
    globalStore.set(commentDraftAtom, null);
}

function saveDraft(): void {
    const draft = globalStore.get(commentDraftAtom);
    const source = globalStore.get(activeCommentSourceAtom);
    if (draft == null || source == null || draft.note.trim() === "") {
        return;
    }
    addComment(source, draft);
    closeDraft();
}

function CommentEditor({ draft }: { draft: CommentDraft }) {
    const ref = useRef<HTMLTextAreaElement>(null);
    const editing = draft.editingId != null;

    useEffect(() => {
        const el = ref.current;
        if (el == null) {
            return;
        }
        // preventScroll: a native scroll inside Monaco's own scrollable would shift its lines off its layout
        el.focus({ preventScroll: true });
        el.setSelectionRange(el.value.length, el.value.length);
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                saveDraft();
            } else if (e.key === "Escape") {
                e.preventDefault();
                closeDraft();
            }
        };
        el.addEventListener("keydown", onKey);
        return () => el.removeEventListener("keydown", onKey);
    }, []);

    const title = draftTitle(draft.side, draft.start, draft.end);
    return (
        <div data-diff-comment-draft className={cn(cardBox, "border-accent")}>
            <div className={cn(cardHeader, "px-[12px]")}>
                <MessageSquare size={13} className="flex-none text-accent-soft" />
                <label htmlFor="diff-comment-draft" className="text-[11.5px] font-semibold text-secondary">
                    {title}
                </label>
            </div>
            <div className="px-[12px] pt-[10px]">
                <textarea
                    id="diff-comment-draft"
                    ref={ref}
                    rows={3}
                    value={draft.note}
                    onChange={(e) => globalStore.set(commentDraftAtom, { ...draft, note: e.target.value })}
                    className="block w-full resize-none rounded-[6px] border border-edge-mid bg-surface px-[10px] py-[8px] text-[13px] leading-[1.5] text-ink-hi outline-2 outline-accent/35 focus:outline"
                />
            </div>
            <div className="flex items-center gap-[8px] px-[12px] py-[10px]">
                <span className="text-[11.5px] text-muted">Held until you send the review</span>
                <span className="flex-1" />
                <button
                    onClick={closeDraft}
                    className={cn(
                        footBtn,
                        "border border-edge-mid bg-surface-raised font-semibold text-ink-mid hover:text-ink-hi"
                    )}
                >
                    Cancel <kbd className="font-mono text-[10.5px] text-ink-faint">Esc</kbd>
                </button>
                <button
                    onClick={saveDraft}
                    disabled={draft.note.trim() === ""}
                    className={cn(footBtn, "bg-accent font-bold text-background disabled:opacity-50")}
                >
                    {editing ? "Save" : "Add comment"}{" "}
                    <kbd className="font-mono text-[10.5px] font-normal">{formatChordString("Mod:Enter")}</kbd>
                </button>
            </div>
        </div>
    );
}

function PendingCard({ comment, sourceKey }: { comment: PendingComment; sourceKey: string }) {
    const edit = () =>
        globalStore.set(commentDraftAtom, {
            path: comment.path,
            side: comment.side,
            start: comment.start,
            end: comment.end,
            quote: comment.quote,
            refs: comment.refs,
            editingId: comment.id,
            note: comment.note,
        });
    const remove = () => {
        if (globalStore.get(commentDraftAtom)?.editingId === comment.id) {
            globalStore.set(commentDraftAtom, null);
        }
        deleteComment(sourceKey, comment.id);
    };
    return (
        <div
            data-diff-comment-card={comment.id}
            data-comment-state="pending"
            className={cn(cardBox, "border-edge-mid")}
        >
            <div className={cn(cardHeader, "pl-[12px] pr-[8px]")}>
                <MessageSquare size={13} className="flex-none text-accent-soft" />
                <span data-diff-comment-label className="text-[11.5px] font-semibold text-secondary">
                    {rangeLabel(comment.side, comment.start, comment.end)}
                </span>
                <span className="text-[11.5px] text-muted">pending</span>
                <span className="flex-1" />
                <button
                    onClick={edit}
                    title="Edit comment"
                    aria-label="Edit comment"
                    data-diff-comment-edit
                    className={iconBtn}
                >
                    <Pencil size={13} />
                </button>
                <button
                    onClick={remove}
                    title="Delete comment"
                    aria-label="Delete comment"
                    data-diff-comment-delete
                    className={iconBtn}
                >
                    <Trash2 size={13} />
                </button>
            </div>
            <div
                data-diff-comment-note
                className="select-text whitespace-pre-wrap px-[12px] pb-[11px] pt-[9px] text-[13px] leading-[1.5] text-ink-hi"
            >
                {comment.note}
            </div>
        </div>
    );
}

function SplitHint() {
    // a pane too narrow for split names what makes room instead of a key that would do nothing
    const available = useAtomValue(splitAvailableAtom);
    return (
        <div data-diff-split-hint className="flex h-[26px] items-center gap-[6px] font-sans text-[11.5px] text-muted">
            <MessageSquare size={12} className="flex-none" />
            {splitHintText(available)}
        </div>
    );
}

// a new draft in the same zone remounts the editor, which focuses it
function draftKey(d: CommentDraft): string {
    return `${d.path}:${d.side}:${d.start}:${d.end}:${d.editingId ?? ""}`;
}

function ZoneBody({
    zone,
    comments,
    sourceKey,
    draft,
}: {
    zone: CommentZone;
    comments: PendingComment[];
    sourceKey: string | null;
    draft: CommentDraft | null;
}) {
    if (zone.kind === "hint") {
        return <SplitHint />;
    }
    if (zone.kind === "draft") {
        return draft == null ? null : <CommentEditor key={draftKey(draft)} draft={draft} />;
    }
    const comment = comments.find((c) => c.id === zone.commentId);
    if (comment == null || sourceKey == null) {
        return null;
    }
    if (draft?.editingId === comment.id) {
        return <CommentEditor key={draftKey(draft)} draft={draft} />;
    }
    return <PendingCard comment={comment} sourceKey={sourceKey} />;
}

// Rendered beside the diff editor; draws nothing of its own, only into the zones the layer publishes.
export function DiffCommentZones() {
    const zones = useAtomValue(commentZonesAtom);
    const source = useAtomValue(activeCommentSourceAtom);
    const store = useAtomValue(commentStoreAtom);
    const draft = useAtomValue(commentDraftAtom);
    const comments = source == null ? [] : (store[source.key]?.comments ?? []);
    return (
        <>
            {zones.map((zone) =>
                createPortal(
                    <div className={cn("cursor-default pr-[24px]", zone.kind !== "hint" && "pb-[10px] pt-[6px]")}>
                        <ZoneBody zone={zone} comments={comments} sourceKey={source?.key ?? null} draft={draft} />
                    </div>,
                    zone.node,
                    zone.key
                )
            )}
        </>
    );
}
