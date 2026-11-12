// frontend/app/view/code/codereviewstore.test.ts
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { globalStore } from "@/app/store/jotaiStore";
import type { AgentVM } from "@/app/view/agents/agentsviewmodel";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// the send pastes the review into the agent's terminal through the Diff line review's sender; here it is a stub
const sendText = vi.hoisted(() => vi.fn());
vi.mock("@/app/view/agents/linereviewsend", () => ({ sendLineComments: (...a: any[]) => sendText(...a) }));
vi.mock("@/app/store/wshclientapi", () => ({ RpcApi: {} }));
vi.mock("@/app/store/wshrpcutil", () => ({ TabRpcClient: {} }));

import { projectComments, reviewMarkdown, reviewMessage, type ReviewComment } from "./codereview";
import {
    cancelComment,
    codeCommentDraftAtom,
    codeCommentPendingAtom,
    codeReviewsAtom,
    consumePendingComment,
    deleteComment,
    saveComment,
    sendReview,
    setCommentSelectionReader,
    startComment,
} from "./codereviewstore";
import { codeFileAtom, codeProjectAtom, codeViewModeAtom } from "./codestore";

const project = { name: "alpha", path: "/repos/alpha" };
const text = ["one", "two", "three", "four"].join("\n");
const agent = { id: "a1", name: "claude", blockId: "blk-1" } as AgentVM;

function seed(comments: ReviewComment[]): void {
    globalStore.set(codeReviewsAtom, new Map([[project.path, comments]]));
}

const comment: ReviewComment = { id: "c1", path: "a.ts", startLine: 2, endLine: 2, anchor: "two", note: "why" };

let clipboard: { writeText: ReturnType<typeof vi.fn> };

beforeEach(() => {
    globalStore.set(codeProjectAtom, project);
    globalStore.set(codeFileAtom, { kind: "text", path: "a.ts", text, size: text.length, modtime: 1 });
    clipboard = { writeText: vi.fn().mockResolvedValue(undefined) };
    vi.stubGlobal("navigator", { clipboard });
});

afterEach(() => {
    sendText.mockReset();
    vi.unstubAllGlobals();
    globalStore.set(codeReviewsAtom, new Map());
    globalStore.set(codeCommentDraftAtom, null);
    globalStore.set(codeCommentPendingAtom, false);
    globalStore.set(codeViewModeAtom, "preview");
    setCommentSelectionReader(() => null);
});

describe("sendReview to an agent", () => {
    it("sends the whole review to the agent once, as one message, and clears the project", async () => {
        seed([comment]);
        sendText.mockResolvedValue({ ok: true });

        const res = await sendReview(agent, "alpha");

        expect(res).toEqual({ ok: true });
        expect(sendText).toHaveBeenCalledTimes(1);
        const [to, message] = sendText.mock.calls[0];
        expect(to).toBe(agent);
        expect(message).toBe(reviewMessage(reviewMarkdown("alpha", project.path, [comment])));
        // the file, the lines and the note are in the message itself
        expect(message).toContain("### a.ts:L2");
        expect(message).toContain("> two");
        expect(message).toContain("why");
        expect(projectComments(globalStore.get(codeReviewsAtom), project.path)).toEqual([]);
    });

    it("keeps the comments and says why when the agent's terminal takes nothing", async () => {
        seed([comment]);
        sendText.mockResolvedValue({ ok: false, error: "claude's terminal is not open" });

        const res = await sendReview(agent, "alpha");

        expect(res.ok).toBe(false);
        expect("message" in res && res.message).toBe("Could not send the review: claude's terminal is not open");
        expect(projectComments(globalStore.get(codeReviewsAtom), project.path)).toEqual([comment]);
    });

    it("keeps the comments when the send throws", async () => {
        seed([comment]);
        sendText.mockRejectedValue(new Error("route not found"));

        const res = await sendReview(agent, "alpha");

        expect("message" in res && res.message).toContain("route not found");
        expect(projectComments(globalStore.get(codeReviewsAtom), project.path)).toEqual([comment]);
    });

    it("re-anchors the open file's comments against the buffer before sending", async () => {
        seed([{ ...comment, startLine: 1, endLine: 1, anchor: "three" }]);
        sendText.mockResolvedValue({ ok: true });

        await sendReview(agent, "alpha");

        expect(sendText.mock.calls[0][1]).toContain("### a.ts:L3");
    });

    it("removes only what was sent: a comment added while the send was in flight stays", async () => {
        seed([comment]);
        const late: ReviewComment = { ...comment, id: "c2", startLine: 4, endLine: 4, anchor: "four", note: "late" };
        sendText.mockImplementation(async () => {
            globalStore.set(codeReviewsAtom, new Map([[project.path, [comment, late]]]));
            return { ok: true };
        });

        await sendReview(agent, "alpha");

        expect(projectComments(globalStore.get(codeReviewsAtom), project.path)).toEqual([late]);
    });

    it("has nothing to send without comments", async () => {
        const res = await sendReview(agent, "alpha");
        expect(res).toEqual({ ok: false, message: "There are no comments to send." });
        expect(sendText).not.toHaveBeenCalled();
    });
});

describe("sendReview with no agent", () => {
    it("copying the review keeps it", async () => {
        seed([comment]);

        const res = await sendReview(null, "alpha");

        expect(res).toEqual({ ok: true });
        expect(clipboard.writeText).toHaveBeenCalledWith(reviewMarkdown("alpha", project.path, [comment]));
        expect(sendText).not.toHaveBeenCalled();
        expect(projectComments(globalStore.get(codeReviewsAtom), project.path)).toEqual([comment]);
    });

    it("a failed copy keeps the review and reports it", async () => {
        seed([comment]);
        clipboard.writeText.mockRejectedValue(new Error("denied"));

        const res = await sendReview(null, "alpha");

        expect(res.ok).toBe(false);
        expect("message" in res && res.message).toBe("Could not copy the review: denied");
        expect(projectComments(globalStore.get(codeReviewsAtom), project.path)).toEqual([comment]);
    });
});

describe("deleteComment", () => {
    it("removes only the named comment of the open project", () => {
        seed([comment, { ...comment, id: "c2", startLine: 4, endLine: 4, anchor: "four" }]);
        deleteComment("c1");
        expect(projectComments(globalStore.get(codeReviewsAtom), project.path).map((c) => c.id)).toEqual(["c2"]);
    });
});

describe("comment drafts", () => {
    it("starts on the caret line when nothing is selected, anchored to the buffer's text", () => {
        setCommentSelectionReader(() => ({ startLine: 3, endLine: 3, endColumn: 2 }));
        startComment();
        expect(globalStore.get(codeCommentDraftAtom)).toEqual({
            path: "a.ts",
            startLine: 3,
            endLine: 3,
            anchor: "three",
        });
    });

    it("trims a selection that ends at column 1 of the next line", () => {
        setCommentSelectionReader(() => ({ startLine: 1, endLine: 3, endColumn: 1 }));
        startComment();
        expect(globalStore.get(codeCommentDraftAtom)).toMatchObject({ startLine: 1, endLine: 2, anchor: "one" });
    });

    it("does nothing without a text file open", () => {
        globalStore.set(codeFileAtom, { kind: "none" });
        setCommentSelectionReader(() => ({ startLine: 1, endLine: 1, endColumn: 1 }));
        startComment();
        expect(globalStore.get(codeCommentDraftAtom)).toBeNull();
    });

    it("saves a note as a comment and closes the draft", () => {
        setCommentSelectionReader(() => ({ startLine: 2, endLine: 2, endColumn: 1 }));
        startComment();
        saveComment("  rename this ");
        const saved = projectComments(globalStore.get(codeReviewsAtom), project.path);
        expect(saved).toHaveLength(1);
        expect(saved[0]).toMatchObject({ path: "a.ts", startLine: 2, endLine: 2, anchor: "two", note: "rename this" });
        expect(globalStore.get(codeCommentDraftAtom)).toBeNull();
    });

    it("adds nothing for a blank note", () => {
        setCommentSelectionReader(() => ({ startLine: 2, endLine: 2, endColumn: 1 }));
        startComment();
        saveComment("  ");
        expect(projectComments(globalStore.get(codeReviewsAtom), project.path)).toEqual([]);
        expect(globalStore.get(codeCommentDraftAtom)).toBeNull();
    });

    it("startComment outside Source switches to Source and leaves a pending comment", () => {
        globalStore.set(codeViewModeAtom, "diff");
        // the diff view has no source editor to read a caret from
        setCommentSelectionReader(() => null);
        startComment();
        expect(globalStore.get(codeViewModeAtom)).toBe("source");
        expect(globalStore.get(codeCommentPendingAtom)).toBe(true);
        expect(globalStore.get(codeCommentDraftAtom)).toBeNull();
    });

    it("consumePendingComment starts the comment once", () => {
        globalStore.set(codeFileAtom, { kind: "text", path: "README.md", text, size: text.length, modtime: 1 });
        globalStore.set(codeViewModeAtom, "preview");
        startComment();
        expect(globalStore.get(codeViewModeAtom)).toBe("source");

        // the editor has mounted: its caret is readable now
        setCommentSelectionReader(() => ({ startLine: 2, endLine: 2, endColumn: 1 }));
        consumePendingComment();
        expect(globalStore.get(codeCommentPendingAtom)).toBe(false);
        expect(globalStore.get(codeCommentDraftAtom)).toMatchObject({ path: "README.md", startLine: 2, anchor: "two" });

        cancelComment();
        consumePendingComment();
        expect(globalStore.get(codeCommentDraftAtom)).toBeNull();
    });

    it("a Go file on the default Preview is on Source already, so the comment starts at once", () => {
        globalStore.set(codeViewModeAtom, "preview");
        setCommentSelectionReader(() => ({ startLine: 4, endLine: 4, endColumn: 3 }));
        startComment();
        expect(globalStore.get(codeCommentPendingAtom)).toBe(false);
        expect(globalStore.get(codeCommentDraftAtom)).toMatchObject({ path: "a.ts", startLine: 4, anchor: "four" });
    });
});
