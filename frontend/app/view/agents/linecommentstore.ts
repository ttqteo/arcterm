// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Line review drafts: the comments on a repository's diff, the one comment box, and what the last send or copy did.
// Keyed by the Diff scope's cwd in one static atom, unlike docreviewstore.ts's atomFamily, because the send key's
// when() reads it through globalStore and PREDICATE_ATOMS (whenstate.ts) can only list static atoms. In memory only:
// drafts survive the Diff surface unmounting, not a restart.

import { globalStore } from "@/app/store/jotaiStore";
import { atom, type PrimitiveAtom, type WritableAtom } from "jotai";
import { atomFamily } from "jotai/utils";
import type { AgentVM } from "./agentsviewmodel";
import type { CommentSide, LineComment } from "./linecomments";

export interface CommentBox {
    file: string;
    side: CommentSide;
    startLine: number;
    endLine: number;
    source: string;
    text: string;
    editingId?: string; // the comment the box edits; adding replaces it
}

export type SendResult =
    | { ok: true; kind: "sent" | "copied"; agent?: string }
    | { ok: false; agent: string; error: string };

export interface LineReviewState {
    comments: LineComment[];
    box?: CommentBox;
    lastSend?: SendResult;
}

export type SendBlock = { kind: "asking"; agent: string } | { kind: "draft" } | null;

const EMPTY: LineReviewState = { comments: [] };

// casts because these pick jotai's read-only overload under the non-strict tsconfig
export const lineReviewsAtom = atom<Record<string, LineReviewState>>({}) as PrimitiveAtom<
    Record<string, LineReviewState>
>;

// the repoKey the Diff pane shows; "" when it shows none
export const activeReviewKeyAtom = atom("") as PrimitiveAtom<string>;

export const reviewModeAtom = atom<"file" | "review">("file") as PrimitiveAtom<"file" | "review">;

export const lineReviewAtom = atomFamily(
    (repoKey: string): WritableAtom<LineReviewState, [LineReviewState], void> =>
        atom(
            (get) => get(lineReviewsAtom)[repoKey] ?? EMPTY,
            (get, set, next: LineReviewState) => set(lineReviewsAtom, { ...get(lineReviewsAtom), [repoKey]: next })
        )
);

function get(repoKey: string): LineReviewState {
    return globalStore.get(lineReviewsAtom)[repoKey] ?? EMPTY;
}

function update(repoKey: string, fn: (s: LineReviewState) => LineReviewState): void {
    globalStore.set(lineReviewAtom(repoKey), fn(get(repoKey)));
}

function hasText(box: CommentBox | undefined): boolean {
    return box != null && box.text.trim() !== "";
}

function newId(): string {
    return typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `lc${Date.now()}${Math.random()}`;
}

// One box at a time, and a typed note is never lost or hidden: a box that holds text stays where it is (the view
// focuses it), an empty one moves.
export function openBox(repoKey: string, box: Omit<CommentBox, "text">): "opened" | "kept" {
    return placeBox(repoKey, { ...box, text: "" });
}

function placeBox(repoKey: string, box: CommentBox): "opened" | "kept" {
    if (hasText(get(repoKey).box)) {
        return "kept";
    }
    update(repoKey, (s) => ({ ...s, box }));
    return "opened";
}

export function setBoxText(repoKey: string, text: string): void {
    update(repoKey, (s) => (s.box == null ? s : { ...s, box: { ...s.box, text } }));
}

// Adds the box's comment, or replaces the one it edits; quote is the range's lines as the review shows them. A new
// comment clears the last send's result line.
export function addComment(repoKey: string, quote: string[]): LineComment | null {
    const { box, comments } = get(repoKey);
    if (box == null || !hasText(box)) {
        return null;
    }
    const editing = box.editingId != null && comments.some((c) => c.id === box.editingId);
    const comment: LineComment = {
        id: editing ? box.editingId : newId(),
        source: box.source,
        file: box.file,
        side: box.side,
        startLine: box.startLine,
        endLine: box.endLine,
        quote,
        note: box.text.trim(),
    };
    update(repoKey, (s) => ({
        comments: editing ? s.comments.map((c) => (c.id === comment.id ? comment : c)) : [...s.comments, comment],
    }));
    return comment;
}

// Opens the box on the comment's text; a box that holds other text stays, as with openBox.
export function editComment(repoKey: string, id: string): "opened" | "kept" {
    const c = get(repoKey).comments.find((x) => x.id === id);
    if (c == null) {
        return "kept";
    }
    const { file, side, startLine, endLine, source, note } = c;
    return placeBox(repoKey, { file, side, startLine, endLine, source, text: note, editingId: id });
}

export function deleteComment(repoKey: string, id: string): void {
    update(repoKey, (s) => ({ ...s, comments: s.comments.filter((c) => c.id !== id) }));
}

export function cancelBox(repoKey: string): void {
    update(repoKey, (s) => (s.box == null ? s : { ...s, box: undefined }));
}

// the send key's when(): comments to send, and no note typed but not added
export function canSendKey(state: LineReviewState | undefined): boolean {
    return state != null && state.comments.length > 0 && !hasText(state.box);
}

// why the tray's send button is disabled: an open ask would take the paste as its answer
export function sendBlock(state: LineReviewState, target: AgentVM | null): SendBlock {
    if (target?.state === "asking") {
        return { kind: "asking", agent: target.name };
    }
    if (hasText(state.box)) {
        return { kind: "draft" };
    }
    return null;
}

// a send clears the comments; a copy or a failure keeps them for the next try
export function recordSend(repoKey: string, result: SendResult): void {
    update(repoKey, (s) => ({
        ...s,
        comments: result.ok && result.kind === "sent" ? [] : s.comments,
        lastSend: result,
    }));
}
