// frontend/app/view/code/codereviewstore.ts
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Review comments, module-scoped so they survive the surface unmounting, and persisted so they survive a
// restart the way drafts do. Keyed by the Code project's path rather than its name: a worktree browsed
// outside the registry has no name of its own, and two checkouts of one repository hold different files.

import { globalStore } from "@/app/store/jotaiStore";
import { modalsModel } from "@/app/store/modalmodel";
import type { AgentVM } from "@/app/view/agents/agentsviewmodel";
import { sendLineComments } from "@/app/view/agents/linereviewsend";
import { atom, type PrimitiveAtom } from "jotai";
import { debounce } from "throttle-debounce";
import {
    addComment,
    clearProject,
    parseStoredReviews,
    projectComments,
    reanchor,
    removeComment,
    reviewMarkdown,
    reviewMessage,
    selectionLines,
    storedReviewsJson,
    type ReviewComment,
    type Reviews,
} from "./codereview";
import { codeDraftsAtom, codeFileAtom, codeProjectAtom, codeViewModeAtom, draftKey } from "./codestore";
import { sourceEditorShowing } from "./codeviewmodestore";

export interface CommentDraft {
    path: string;
    startLine: number;
    endLine: number;
    anchor: string;
}

const REVIEWS_STORAGE_KEY = "code.reviews";
// a comment save must not wait on a write, and a burst of deletes needs only the last one
const REVIEWS_PERSIST_MS = 500;

function readStoredReviews(): Reviews {
    try {
        return parseStoredReviews(window.localStorage.getItem(REVIEWS_STORAGE_KEY));
    } catch {
        return new Map(); // no localStorage: a restricted webview, or vitest's node
    }
}

function writeStoredReviews(r: Reviews): void {
    try {
        window.localStorage.setItem(REVIEWS_STORAGE_KEY, storedReviewsJson(r));
    } catch (e) {
        console.warn("[code] review comments were not persisted", e);
    }
}

export const codeReviewsAtom = atom<Reviews>(readStoredReviews()) as PrimitiveAtom<Reviews>;
const persistReviewsSoon = debounce(REVIEWS_PERSIST_MS, () => writeStoredReviews(globalStore.get(codeReviewsAtom)));
globalStore.sub(codeReviewsAtom, persistReviewsSoon);
// a reload inside the debounce window would otherwise drop the last comment
if (typeof window !== "undefined") {
    window.addEventListener("pagehide", () => {
        persistReviewsSoon.cancel();
        writeStoredReviews(globalStore.get(codeReviewsAtom));
    });
}
export const codeCommentDraftAtom = atom<CommentDraft | null>(null) as PrimitiveAtom<CommentDraft | null>;
export const codeReviewSendOpenAtom = atom<boolean>(false) as PrimitiveAtom<boolean>;
// A comment asked for outside the source editor: the view switches to Source, and the viewer starts the
// comment once the editor has mounted and its caret can be read (consumePendingComment).
export const codeCommentPendingAtom = atom<boolean>(false) as PrimitiveAtom<boolean>;

// The viewer lends the store the editor's selection, or the caret as an empty one, the way codestore's
// caret readers work: the store never touches Monaco.
type EditorSelection = { startLine: number; endLine: number; endColumn: number };
let readSelection: () => EditorSelection | null = () => null;
export function setCommentSelectionReader(read: () => EditorSelection | null): void {
    readSelection = read;
}

export function reviewKey(): string | null {
    return globalStore.get(codeProjectAtom)?.path ?? null;
}

// The open file's lines as the buffer holds them, unsaved edits included; null without a text file.
export function openFileLines(): { path: string; lines: string[] } | null {
    const project = globalStore.get(codeProjectAtom);
    const file = globalStore.get(codeFileAtom);
    if (project == null || file.kind !== "text") {
        return null;
    }
    const text = globalStore.get(codeDraftsAtom).get(draftKey(project, file.path))?.text ?? file.text;
    return { path: file.path, lines: text.split(/\r?\n/) };
}

export function startComment(): void {
    const open = openFileLines();
    if (open == null) {
        return;
    }
    // a comment is on what the source editor has selected: elsewhere the view goes to Source first, and the comment
    // starts once its editor has mounted
    if (!sourceEditorShowing()) {
        globalStore.set(codeViewModeAtom, "source");
        globalStore.set(codeCommentPendingAtom, true);
        return;
    }
    const sel = readSelection();
    if (sel == null) {
        return;
    }
    const { startLine, endLine } = selectionLines(sel);
    globalStore.set(codeCommentDraftAtom, {
        path: open.path,
        startLine,
        endLine,
        anchor: open.lines[startLine - 1] ?? "",
    });
}

export function consumePendingComment(): void {
    if (!globalStore.get(codeCommentPendingAtom)) {
        return;
    }
    globalStore.set(codeCommentPendingAtom, false);
    startComment();
}

export function cancelComment(): void {
    globalStore.set(codeCommentDraftAtom, null);
}

export function saveComment(note: string): void {
    const draft = globalStore.get(codeCommentDraftAtom);
    const key = reviewKey();
    globalStore.set(codeCommentDraftAtom, null);
    const trimmed = note.trim();
    if (draft == null || key == null || trimmed === "") {
        return;
    }
    globalStore.set(codeReviewsAtom, (r) => addComment(r, key, { id: crypto.randomUUID(), ...draft, note: trimmed }));
}

// an agent may have shifted the open file since the comments were made; other files are sent as stored
function reanchored(comments: readonly ReviewComment[]): ReviewComment[] {
    const open = openFileLines();
    return comments.map((c) => (open != null && c.path === open.path ? { ...c, ...reanchor(c, open.lines) } : c));
}

// To an agent: the review is pasted into its terminal as one message (the Diff's line review sends the same way), and
// what was sent leaves the review. With no agent the markdown is copied, and the review stays: a copy is a look, not a
// handoff.
export async function sendReview(
    target: AgentVM | null,
    projectName: string
): Promise<{ ok: true } | { ok: false; message: string }> {
    const key = reviewKey();
    const comments = key == null ? [] : projectComments(globalStore.get(codeReviewsAtom), key);
    if (key == null || comments.length === 0) {
        return { ok: false, message: "There are no comments to send." };
    }
    const markdown = reviewMarkdown(projectName, key, reanchored(comments));
    try {
        if (target != null) {
            const sent = await sendLineComments(target, reviewMessage(markdown));
            if ("error" in sent) {
                throw new Error(sent.error);
            }
        } else {
            if (navigator.clipboard == null) {
                throw new Error("the clipboard is unavailable");
            }
            await navigator.clipboard.writeText(markdown);
        }
    } catch (e) {
        const reason = e instanceof Error ? e.message : String(e);
        return { ok: false, message: `${target != null ? "Could not send" : "Could not copy"} the review: ${reason}` };
    }
    if (target != null) {
        // only what was sent: a comment added while the send was in flight stays
        globalStore.set(codeReviewsAtom, (r) => comments.reduce((acc, c) => removeComment(acc, key, c.id), r));
    }
    return { ok: true };
}

export function deleteComment(id: string): void {
    const key = reviewKey();
    if (key != null) {
        globalStore.set(codeReviewsAtom, (r) => removeComment(r, key, id));
    }
}

export function confirmClearReview(): void {
    const project = globalStore.get(codeProjectAtom);
    const count = project == null ? 0 : projectComments(globalStore.get(codeReviewsAtom), project.path).length;
    if (project == null || count === 0) {
        return;
    }
    modalsModel.pushModal("ConfirmModal", {
        title: "Clear review",
        message: `Discard ${count === 1 ? "the 1 comment" : `all ${count} comments`} in ${project.name}? This cannot be undone.`,
        confirmLabel: "Clear",
        destructive: true,
        onConfirm: () => globalStore.set(codeReviewsAtom, (r) => clearProject(r, project.path)),
    });
}
