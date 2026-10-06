// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The Agent panel's markdown comment drafts, per agent and across every file its panel opens: the comments, the one
// comment box, and what the last send or copy did (docs/superpowers/specs/2026-10-06-md-comments-design.md). Keyed by
// agent, unlike line review's per-repository drafts: the panel belongs to one agent and only sends to it. In memory
// only: drafts survive switching surfaces, not a restart.

import { globalStore } from "@/app/store/jotaiStore";
import { atom, type PrimitiveAtom, type WritableAtom } from "jotai";
import { atomFamily } from "jotai/utils";
import type { AgentVM } from "./agentsviewmodel";
import type { MdComment, QuoteKind } from "./mdcomments";

export interface MdBox {
    file: string;
    root: string | null;
    startLine: number;
    endLine: number;
    quoteKind: QuoteKind;
    quote: string[];
    image?: string;
    anchor?: { start: number; end: number }; // the block a "+" opened on: Shift+click extends the range from it
    text: string;
    editingId?: string; // the comment the box edits; adding replaces it
}

export type MdSendResult =
    | { ok: true; kind: "sent"; agent: string; count: number }
    | { ok: true; kind: "copied" }
    | { ok: false; agent: string; error: string };

export interface MdCommentState {
    comments: MdComment[];
    box?: MdBox;
    lastSend?: MdSendResult;
    seq: number; // the next comment's seq
}

export type MdSendBlock =
    | { kind: "asking"; agent: string }
    | { kind: "draft" }
    | { kind: "noterm"; agent: string }
    | null;

const EMPTY: MdCommentState = { comments: [], seq: 1 };

// casts because these pick jotai's read-only overload under the non-strict tsconfig
export const mdCommentsAtom = atom<Record<string, MdCommentState>>({}) as PrimitiveAtom<Record<string, MdCommentState>>;

export const mdCommentAtom = atomFamily(
    (agentId: string): WritableAtom<MdCommentState, [MdCommentState], void> =>
        atom(
            (get) => get(mdCommentsAtom)[agentId] ?? EMPTY,
            (get, set, next: MdCommentState) => set(mdCommentsAtom, { ...get(mdCommentsAtom), [agentId]: next })
        )
);

function get(agentId: string): MdCommentState {
    return globalStore.get(mdCommentsAtom)[agentId] ?? EMPTY;
}

function update(agentId: string, fn: (s: MdCommentState) => MdCommentState): void {
    globalStore.set(mdCommentAtom(agentId), fn(get(agentId)));
}

function hasText(box: MdBox | undefined): boolean {
    return box != null && box.text.trim() !== "";
}

function newId(): string {
    return typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `md${Date.now()}${Math.random()}`;
}

// One box at a time, and a typed note is never lost: a box that holds text stays (the view focuses it); an empty one
// moves.
export function openBox(agentId: string, box: Omit<MdBox, "text">): "opened" | "kept" {
    if (hasText(get(agentId).box)) {
        return "kept";
    }
    update(agentId, (s) => ({ ...s, box: { ...box, text: "" } }));
    return "opened";
}

// Shift+click on another block's +: the open box takes the wider range and its quote, and keeps its text
export function setBoxRange(agentId: string, startLine: number, endLine: number, quote: string[]): void {
    update(agentId, (s) => (s.box == null ? s : { ...s, box: { ...s.box, startLine, endLine, quote } }));
}

export function setBoxText(agentId: string, text: string): void {
    update(agentId, (s) => (s.box == null ? s : { ...s, box: { ...s.box, text } }));
}

export function cancelBox(agentId: string): void {
    update(agentId, (s) => (s.box == null ? s : { ...s, box: undefined }));
}

// Adds the box's comment, or replaces the one it edits (keeping its seq, so its number holds). A new comment clears
// the last send's result line.
export function addComment(agentId: string): MdComment | null {
    const s = get(agentId);
    const box = s.box;
    if (box == null || !hasText(box)) {
        return null;
    }
    const old = box.editingId != null ? s.comments.find((c) => c.id === box.editingId) : undefined;
    const comment: MdComment = {
        id: old?.id ?? newId(),
        seq: old?.seq ?? s.seq,
        file: box.file,
        root: box.root,
        startLine: box.startLine,
        endLine: box.endLine,
        quoteKind: box.quoteKind,
        quote: box.quote,
        ...(box.image != null ? { image: box.image } : {}),
        note: box.text.trim(),
    };
    update(agentId, (st) => ({
        comments: old != null ? st.comments.map((c) => (c.id === comment.id ? comment : c)) : [...st.comments, comment],
        seq: old != null ? st.seq : st.seq + 1,
    }));
    return comment;
}

// Opens the box on the comment's text; a box that holds other text stays, as with openBox.
export function editComment(agentId: string, id: string): "opened" | "kept" {
    const s = get(agentId);
    const c = s.comments.find((x) => x.id === id);
    if (c == null || hasText(s.box)) {
        return "kept";
    }
    const { file, root, startLine, endLine, quoteKind, quote, image, note } = c;
    update(agentId, (st) => ({
        ...st,
        box: {
            file,
            root,
            startLine,
            endLine,
            quoteKind,
            quote,
            ...(image != null ? { image } : {}),
            text: note,
            editingId: id,
        },
    }));
    return "opened";
}

export function deleteComment(agentId: string, id: string): void {
    update(agentId, (s) => ({ ...s, comments: s.comments.filter((c) => c.id !== id) }));
}

// Why Send is not offered: no terminal to paste into (an ended worker: the tray shows Copy alone), or, disabled with
// a reason, an open ask that would take the paste as its answer, or a note typed but not added.
export function sendBlock(state: MdCommentState, agent: AgentVM | null): MdSendBlock {
    if (agent == null || !agent.blockId) {
        return { kind: "noterm", agent: agent?.name ?? "" };
    }
    if (agent.state === "asking") {
        return { kind: "asking", agent: agent.name };
    }
    if (hasText(state.box)) {
        return { kind: "draft" };
    }
    return null;
}

// a send clears the comments; a copy or a failure keeps them for the next try
export function recordSend(agentId: string, result: MdSendResult): void {
    update(agentId, (s) => ({
        ...s,
        comments: result.ok && result.kind === "sent" ? [] : s.comments,
        lastSend: result,
    }));
}
