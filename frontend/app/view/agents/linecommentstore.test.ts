// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { globalStore } from "@/app/store/jotaiStore";
import { beforeEach, describe, expect, it } from "vitest";
import type { AgentVM } from "./agentsviewmodel";
import {
    addComment,
    canSendKey,
    cancelBox,
    deleteComment,
    editComment,
    lineReviewAtom,
    lineReviewsAtom,
    openBox,
    recordSend,
    sendBlock,
    setBoxText,
    type LineReviewState,
} from "./linecommentstore";

const REPO = "/repo";
const OTHER = "/other";

const AT_42 = { file: "a.ts", side: "new" as const, startLine: 42, endLine: 42, source: "worktree" };
const AT_12_OLD = { file: "b.ts", side: "old" as const, startLine: 12, endLine: 14, source: "abc1234" };

function state(key = REPO): LineReviewState {
    return globalStore.get(lineReviewAtom(key));
}

function comment(key: string, at: Omit<typeof AT_42, "side"> & { side: "new" | "old" }, note: string) {
    openBox(key, at);
    setBoxText(key, note);
    return addComment(key, ["const x = foo();"]);
}

const agent = (over: Partial<AgentVM> = {}) =>
    ({ id: "a1", name: "paper-writer", state: "working", blockId: "blk", ...over }) as AgentVM;

beforeEach(() => {
    globalStore.set(lineReviewsAtom, {});
});

describe("the comment box", () => {
    it("opens empty, takes text, and adds a comment from it", () => {
        expect(openBox(REPO, AT_42)).toBe("opened");
        expect(state().box).toEqual({ ...AT_42, text: "" });
        setBoxText(REPO, "Why call foo twice?");
        expect(state().box?.text).toBe("Why call foo twice?");
        const c = addComment(REPO, ["const x = foo();"]);
        expect(c).toMatchObject({
            ...AT_42,
            quote: ["const x = foo();"],
            note: "Why call foo twice?",
        });
        expect(c?.id).toBeTruthy();
        expect(state().comments).toEqual([c]);
        expect(state().box).toBeUndefined();
    });

    it("adds nothing from a blank box, and keeps the box open", () => {
        openBox(REPO, AT_42);
        setBoxText(REPO, "  \n ");
        expect(addComment(REPO, ["x"])).toBeNull();
        expect(state().comments).toEqual([]);
        expect(state().box).toBeDefined();
    });

    it("adds nothing with no box", () => {
        expect(addComment(REPO, ["x"])).toBeNull();
        expect(state().comments).toEqual([]);
    });

    it("cancels: the box closes and nothing is added", () => {
        openBox(REPO, AT_42);
        setBoxText(REPO, "draft");
        cancelBox(REPO);
        expect(state().box).toBeUndefined();
        expect(state().comments).toEqual([]);
    });

    it("keeps a box that has text where it is when + is clicked elsewhere", () => {
        openBox(REPO, AT_42);
        setBoxText(REPO, "half a thought");
        expect(openBox(REPO, AT_12_OLD)).toBe("kept");
        expect(state().box).toEqual({ ...AT_42, text: "half a thought" });
    });

    it("moves an empty box", () => {
        openBox(REPO, AT_42);
        expect(openBox(REPO, AT_12_OLD)).toBe("opened");
        expect(state().box).toEqual({ ...AT_12_OLD, text: "" });
    });

    it("treats a whitespace-only box as empty", () => {
        openBox(REPO, AT_42);
        setBoxText(REPO, "   ");
        expect(openBox(REPO, AT_12_OLD)).toBe("opened");
    });
});

describe("editing and deleting", () => {
    it("opens the box on the comment's text, and adding replaces the comment", () => {
        const c = comment(REPO, AT_42, "first take")!;
        comment(REPO, AT_12_OLD, "other");
        editComment(REPO, c.id);
        expect(state().box).toEqual({ ...AT_42, text: "first take", editingId: c.id });
        setBoxText(REPO, "second take");
        const edited = addComment(REPO, ["const x = foo();"]);
        expect(edited?.id).toBe(c.id);
        expect(state().comments).toHaveLength(2);
        expect(state().comments.find((x) => x.id === c.id)?.note).toBe("second take");
        expect(state().box).toBeUndefined();
    });

    it("does not move a box that has text to edit another comment", () => {
        const c = comment(REPO, AT_42, "saved")!;
        openBox(REPO, AT_12_OLD);
        setBoxText(REPO, "typing");
        expect(editComment(REPO, c.id)).toBe("kept");
        expect(state().box).toEqual({ ...AT_12_OLD, text: "typing" });
    });

    it("deletes one comment", () => {
        const a = comment(REPO, AT_42, "one")!;
        const b = comment(REPO, AT_12_OLD, "two")!;
        deleteComment(REPO, a.id);
        expect(state().comments).toEqual([b]);
    });
});

describe("sending", () => {
    it("canSendKey: comments and no box with text", () => {
        expect(canSendKey(undefined)).toBe(false);
        expect(canSendKey(state())).toBe(false);
        comment(REPO, AT_42, "note");
        expect(canSendKey(state())).toBe(true);
        openBox(REPO, AT_12_OLD);
        expect(canSendKey(state())).toBe(true);
        setBoxText(REPO, "not added");
        expect(canSendKey(state())).toBe(false);
    });

    it("sendBlock: an asking agent, a box with text, neither", () => {
        comment(REPO, AT_42, "note");
        expect(sendBlock(state(), agent({ state: "asking" }))).toEqual({ kind: "asking", agent: "paper-writer" });
        expect(sendBlock(state(), agent())).toBeNull();
        expect(sendBlock(state(), null)).toBeNull();
        openBox(REPO, AT_12_OLD);
        setBoxText(REPO, "not added");
        expect(sendBlock(state(), agent())).toEqual({ kind: "draft" });
        expect(sendBlock(state(), null)).toEqual({ kind: "draft" });
    });

    it("a good send clears the comments and says where they went", () => {
        comment(REPO, AT_42, "note");
        recordSend(REPO, { ok: true, kind: "sent", agent: "paper-writer" });
        expect(state().comments).toEqual([]);
        expect(state().lastSend).toEqual({ ok: true, kind: "sent", agent: "paper-writer" });
    });

    it("a failed send keeps every comment and holds the agent's name", () => {
        comment(REPO, AT_42, "one");
        comment(REPO, AT_12_OLD, "two");
        recordSend(REPO, { ok: false, agent: "paper-writer", error: "boom" });
        expect(state().comments).toHaveLength(2);
        expect(state().lastSend).toEqual({ ok: false, agent: "paper-writer", error: "boom" });
    });

    it("a copy keeps the comments", () => {
        comment(REPO, AT_42, "one");
        recordSend(REPO, { ok: true, kind: "copied" });
        expect(state().comments).toHaveLength(1);
        expect(state().lastSend).toEqual({ ok: true, kind: "copied" });
    });

    it("adding a comment clears the result line", () => {
        comment(REPO, AT_42, "one");
        recordSend(REPO, { ok: true, kind: "sent", agent: "paper-writer" });
        comment(REPO, AT_12_OLD, "two");
        expect(state().lastSend).toBeUndefined();
    });
});

it("keeps two repositories apart", () => {
    comment(REPO, AT_42, "here");
    openBox(OTHER, AT_12_OLD);
    setBoxText(OTHER, "there");
    expect(state(REPO).comments).toHaveLength(1);
    expect(state(REPO).box).toBeUndefined();
    expect(state(OTHER).comments).toEqual([]);
    expect(state(OTHER).box?.text).toBe("there");
    recordSend(REPO, { ok: true, kind: "sent", agent: "x" });
    expect(state(OTHER).box?.text).toBe("there");
    expect(state(OTHER).lastSend).toBeUndefined();
});
