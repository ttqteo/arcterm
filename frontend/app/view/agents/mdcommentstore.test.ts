// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { globalStore } from "@/app/store/jotaiStore";
import { beforeEach, describe, expect, it } from "vitest";
import type { AgentVM } from "./agentsviewmodel";
import {
    addComment,
    cancelBox,
    deleteComment,
    editComment,
    mdCommentAtom,
    mdCommentsAtom,
    openBox,
    recordSend,
    sendBlock,
    setBoxRange,
    setBoxText,
} from "./mdcommentstore";

const A = "agent-1";
const AT = {
    file: "/repo/docs/guide.md",
    root: "/repo",
    startLine: 9,
    endLine: 9,
    quoteKind: "selection" as const,
    quote: ["the one the link names"],
};
const state = () => globalStore.get(mdCommentAtom(A));
const agent = (o: Partial<AgentVM> = {}) =>
    ({ id: A, name: "writer", state: "working", blockId: "blk", ...o }) as AgentVM;
const add = (note: string, at: Partial<typeof AT> = {}) => {
    openBox(A, { ...AT, ...at });
    setBoxText(A, note);
    return addComment(A);
};

beforeEach(() => {
    globalStore.set(mdCommentsAtom, {});
});

describe("the box", () => {
    it("adds the box's comment with the next seq and closes the box", () => {
        expect(openBox(A, AT)).toBe("opened");
        setBoxText(A, "  Name the link's target.  ");
        expect(addComment(A)).toMatchObject({ seq: 1, note: "Name the link's target.", startLine: 9, file: AT.file });
        expect(state().box).toBeUndefined();
        expect(state().seq).toBe(2);
    });

    it("keeps a box that holds text", () => {
        openBox(A, AT);
        setBoxText(A, "half a thought");
        expect(openBox(A, { ...AT, startLine: 1, endLine: 1 })).toBe("kept");
        expect(state().box).toMatchObject({ startLine: 9, text: "half a thought" });
    });

    it("moves an empty box", () => {
        openBox(A, AT);
        expect(openBox(A, { ...AT, startLine: 1, endLine: 1 })).toBe("opened");
        expect(state().box?.startLine).toBe(1);
    });

    it("adds nothing from an empty box", () => {
        openBox(A, AT);
        expect(addComment(A)).toBeNull();
        expect(state().comments).toEqual([]);
    });

    it("extends a range and keeps the text", () => {
        openBox(A, { ...AT, startLine: 13, endLine: 13, quoteKind: "source", anchor: { start: 13, end: 13 } });
        setBoxText(A, "cost");
        setBoxRange(A, 13, 15, ["a", "b", "c"]);
        expect(state().box).toMatchObject({ startLine: 13, endLine: 15, quote: ["a", "b", "c"], text: "cost" });
    });

    it("cancels", () => {
        openBox(A, AT);
        cancelBox(A);
        expect(state().box).toBeUndefined();
    });
});

describe("editing", () => {
    it("replaces the comment in place and keeps its seq", () => {
        const c = add("first");
        expect(editComment(A, c.id)).toBe("opened");
        expect(state().box).toMatchObject({ text: "first", editingId: c.id });
        setBoxText(A, "second");
        addComment(A);
        expect(state().comments).toHaveLength(1);
        expect(state().comments[0]).toMatchObject({ id: c.id, seq: 1, note: "second" });
        expect(state().seq).toBe(2);
    });

    it("deletes", () => {
        const c = add("gone");
        deleteComment(A, c.id);
        expect(state().comments).toEqual([]);
    });

    it("keeps drafts apart per agent", () => {
        add("mine");
        expect(globalStore.get(mdCommentAtom("agent-2")).comments).toEqual([]);
    });
});

describe("sending", () => {
    it("a send clears the comments; a copy and a failure keep them", () => {
        add("one");
        recordSend(A, { ok: true, kind: "copied" });
        expect(state().comments).toHaveLength(1);
        recordSend(A, { ok: false, agent: "writer", error: "gone" });
        expect(state().comments).toHaveLength(1);
        recordSend(A, { ok: true, kind: "sent", agent: "writer", count: 1 });
        expect(state().comments).toEqual([]);
        expect(state().lastSend).toEqual({ ok: true, kind: "sent", agent: "writer", count: 1 });
    });

    it("a new comment clears the last send's line", () => {
        add("one");
        recordSend(A, { ok: true, kind: "copied" });
        add("two", { startLine: 4, endLine: 4 });
        expect(state().lastSend).toBeUndefined();
    });

    it("blocks while the agent asks, while a box holds text, and without a terminal", () => {
        add("one");
        expect(sendBlock(state(), agent())).toBeNull();
        expect(sendBlock(state(), agent({ state: "asking" }))).toEqual({ kind: "asking", agent: "writer" });
        expect(sendBlock(state(), agent({ blockId: "" }))).toEqual({ kind: "noterm", agent: "writer" });
        expect(sendBlock(state(), null)).toEqual({ kind: "noterm", agent: "" });
        openBox(A, AT);
        setBoxText(A, "half");
        expect(sendBlock(state(), agent())).toEqual({ kind: "draft" });
    });
});
