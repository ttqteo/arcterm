// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { globalStore } from "@/app/store/jotaiStore";
import { beforeEach, describe, expect, it } from "vitest";
import { buildCommentPrompt } from "./commentprompt";
import {
    resolveRecipient,
    sendBarText,
    sendBatch,
    type CommentSendIO,
    type Recipient,
    type RecipientFacts,
} from "./commentsend";
import {
    addComment,
    commentStoreAtom,
    sentNoteAtom,
    type BatchSource,
    type CommentBatch,
    type PendingComment,
} from "./diffcomments";
import type { DiffPairRefs } from "./diffcontent";

const REFS: DiffPairRefs = { original: { kind: "ref", ref: "HEAD" }, modified: { kind: "worktree" } };
const RUN_ID = "3f9a21c4-0000-4000-8000-000000000000";

const comment = (id: string): PendingComment => ({
    id,
    path: "src/a.go",
    side: "modified",
    start: 2,
    end: 2,
    quote: ["two"],
    refs: REFS,
    note: "why",
    at: 1,
});
const batchOf = (source: Partial<BatchSource> = {}, n = 2): CommentBatch => ({
    source: { key: "agent:a1", kind: "agent", label: "loom", cwd: "C:/work/loom-tree", agentId: "a1", ...source },
    at: 1,
    comments: Array.from({ length: n }, (_, i) => comment(`c${i}`)),
});

const LIVE_AGENT = { name: "loom", blockId: "blk-1", state: "idle" as const };
const facts = (over: Partial<RecipientFacts> = {}): RecipientFacts => ({ folderExists: true, ...over });
const run = (over: Partial<NonNullable<RecipientFacts["run"]>> = {}): NonNullable<RecipientFacts["run"]> => ({
    status: "done",
    projectpath: "C:/proj/waveterm",
    landpath: "C:/wt/run",
    land: { state: "landed" },
    ...over,
});

describe("resolveRecipient: agent source", () => {
    it("sends to a live agent with a terminal block", () => {
        expect(resolveRecipient(batchOf(), facts({ agent: LIVE_AGENT }))).toEqual({
            kind: "live",
            name: "loom",
            blockId: "blk-1",
            working: false,
        });
    });

    it("marks a working agent, whose prompt joins its turn", () => {
        const r = resolveRecipient(batchOf(), facts({ agent: { ...LIVE_AGENT, state: "working" } }));
        expect(r).toMatchObject({ kind: "live", working: true });
    });

    it("waits for an agent that is asking a question, whose prompt would answer it", () => {
        const r = resolveRecipient(batchOf(), facts({ agent: { ...LIVE_AGENT, state: "asking" } }));
        expect(r).toMatchObject({ kind: "wait", reason: "loom is asking a question — answer it first" });
    });

    it("keeps an idle agent live", () => {
        expect(resolveRecipient(batchOf(), facts({ agent: LIVE_AGENT }))).toMatchObject({ kind: "live" });
    });

    it("does not treat a plain terminal as live", () => {
        const r = resolveRecipient(batchOf(), facts({ agent: { ...LIVE_AGENT, kind: "terminal" } }));
        expect(r.kind).toBe("new");
    });

    it("does not treat an agent without a terminal block as live", () => {
        const r = resolveRecipient(batchOf(), facts({ agent: { name: "loom", state: "idle" } }));
        expect(r).toMatchObject({ kind: "new", cwd: "C:/work/loom-tree", ended: "loom" });
    });

    it("follows the run for an agent a run started, even when it is live", () => {
        const r = resolveRecipient(
            batchOf({ runId: RUN_ID }),
            facts({ agent: { ...LIVE_AGENT, runId: RUN_ID }, run: run() })
        );
        expect(r).toMatchObject({ kind: "new", cwd: "C:/proj/waveterm" });
    });

    it("follows the run for an ended agent whose batch remembers its run", () => {
        const r = resolveRecipient(batchOf({ runId: RUN_ID }), facts({ run: run() }));
        expect(r).toMatchObject({ kind: "new", cwd: "C:/proj/waveterm" });
    });

    it("starts a new agent in an ended agent's folder when it exists", () => {
        const r = resolveRecipient(batchOf({ project: "waveterm" }), facts());
        expect(r).toEqual({
            kind: "new",
            cwd: "C:/work/loom-tree",
            project: "waveterm",
            folder: "loom's folder",
            ended: "loom",
        });
    });

    it("names the project after the folder when the batch has none", () => {
        const r = resolveRecipient(batchOf(), facts());
        expect(r).toMatchObject({ kind: "new", project: "loom-tree" });
    });

    it("falls back to the project's registered path when the folder is gone", () => {
        const r = resolveRecipient(
            batchOf({ project: "waveterm" }),
            facts({ folderExists: false, projectPath: "C:/proj/waveterm" })
        );
        expect(r).toEqual({
            kind: "new",
            cwd: "C:/proj/waveterm",
            project: "waveterm",
            folder: "waveterm",
            ended: "loom",
        });
    });

    it("falls back to the stored project path when none is registered", () => {
        const r = resolveRecipient(
            batchOf({ project: "waveterm", projectPath: "C:/old/waveterm" }),
            facts({ folderExists: false })
        );
        expect(r).toMatchObject({ kind: "new", cwd: "C:/old/waveterm" });
    });

    it("waits with 'the folder is gone' when the folder and the project are both gone", () => {
        const r = resolveRecipient(batchOf(), facts({ folderExists: false }));
        expect(r).toEqual({ kind: "wait", reason: "the folder is gone" });
    });

    it("waits while the folder check is pending", () => {
        const r = resolveRecipient(batchOf(), facts({ folderExists: null }));
        expect(r).toEqual({ kind: "wait", reason: "checking the folder" });
    });

    it("treats a batch with no stored folder as gone", () => {
        const r = resolveRecipient(batchOf({ cwd: "" }), facts({ folderExists: null }));
        expect(r).toEqual({ kind: "wait", reason: "the folder is gone" });
    });
});

describe("resolveRecipient: run source", () => {
    const runBatch = () =>
        batchOf({
            key: `run:${RUN_ID}`,
            kind: "run",
            label: "run 3f9a21c4",
            runId: RUN_ID,
            agentId: undefined,
            cwd: "",
        });

    it("starts a new agent in the project's path once the run landed", () => {
        expect(resolveRecipient(runBatch(), facts({ run: run() }))).toEqual({
            kind: "new",
            cwd: "C:/proj/waveterm",
            project: "waveterm",
            folder: "waveterm",
        });
    });

    it("treats a done run with no landing tree as landed", () => {
        const r = resolveRecipient(runBatch(), facts({ run: run({ landpath: "", land: undefined }) }));
        expect(r.kind).toBe("new");
    });

    it("waits on a run held before land, with its reason", () => {
        const r = resolveRecipient(runBatch(), facts({ run: run({ land: { state: "held", reason: "tests fail" } }) }));
        expect(r).toEqual({ kind: "wait", reason: "run 3f9a21c4 is held before land: tests fail" });
    });

    it("waits on a cancelled run that has a landing tree", () => {
        const r = resolveRecipient(runBatch(), facts({ run: run({ status: "cancelled", land: undefined }) }));
        expect(r).toEqual({ kind: "wait", reason: "run 3f9a21c4 ended without landing" });
    });

    it("waits on a running run", () => {
        const r = resolveRecipient(runBatch(), facts({ run: run({ status: "running", land: undefined }) }));
        expect(r).toEqual({ kind: "wait", reason: "run 3f9a21c4 hasn't landed; send once it does" });
    });

    it("waits while the run is not loaded", () => {
        expect(resolveRecipient(runBatch(), facts())).toEqual({ kind: "wait", reason: "checking run 3f9a21c4" });
    });

    it("waits when a landed run has no project path", () => {
        const r = resolveRecipient(runBatch(), facts({ run: run({ projectpath: "" }) }));
        expect(r.kind).toBe("wait");
    });
});

describe("resolveRecipient: project source", () => {
    const projectBatch = (over: Partial<BatchSource> = {}) =>
        batchOf({
            key: "project:waveterm",
            kind: "project",
            label: "waveterm",
            project: "waveterm",
            projectPath: "C:/stored/waveterm",
            agentId: undefined,
            ...over,
        });

    it("prefers the registered path over the stored one", () => {
        const r = resolveRecipient(projectBatch(), facts({ projectPath: "C:/registered/waveterm" }));
        expect(r).toEqual({ kind: "new", cwd: "C:/registered/waveterm", project: "waveterm", folder: "waveterm" });
    });

    it("falls back to the stored path", () => {
        expect(resolveRecipient(projectBatch(), facts())).toMatchObject({ kind: "new", cwd: "C:/stored/waveterm" });
    });

    it("waits when the project has no path at all", () => {
        expect(resolveRecipient(projectBatch({ projectPath: undefined }), facts()).kind).toBe("wait");
    });
});

describe("resolveRecipient: worktree source", () => {
    const worktreeBatch = (over: Partial<BatchSource> = {}) =>
        batchOf({
            key: "worktree:C:/p/waveterm/.worktrees/x",
            kind: "worktree",
            label: "x",
            project: "waveterm",
            projectPath: "C:/p/waveterm/.worktrees/x",
            agentId: undefined,
            ...over,
        });

    it("starts the agent in the worktree, not the registered main checkout", () => {
        const r = resolveRecipient(worktreeBatch(), facts({ projectPath: "C:/p/waveterm" }));
        expect(r).toEqual({ kind: "new", cwd: "C:/p/waveterm/.worktrees/x", project: "waveterm", folder: "x" });
    });

    it("waits when the worktree has no path", () => {
        expect(resolveRecipient(worktreeBatch({ projectPath: undefined }), facts()).kind).toBe("wait");
    });
});

describe("sendBarText", () => {
    const summary = { comments: 3, files: 2 };

    it("counts comments and files", () => {
        const live: Recipient = { kind: "live", name: "loom", blockId: "b", working: false };
        expect(sendBarText(summary, live).count).toBe("3 comments in 2 files");
        expect(sendBarText({ comments: 1, files: 1 }, live).count).toBe("1 comment in 1 file");
    });

    it("sends to a live agent at its prompt", () => {
        const t = sendBarText(summary, { kind: "live", name: "loom", blockId: "b", working: false });
        expect(t).toMatchObject({ detail: "at its prompt", action: "Send 3 comments" });
    });

    it("says a working agent takes the prompt in its turn", () => {
        const t = sendBarText(summary, { kind: "live", name: "loom", blockId: "b", working: true });
        expect(t.detail).toBe("working, joins its turn");
    });

    it("starts a new agent in its folder", () => {
        const t = sendBarText(
            { comments: 2, files: 1 },
            { kind: "new", cwd: "C:/p/waveterm", project: "waveterm", folder: "waveterm" }
        );
        expect(t).toEqual({
            count: "2 comments in 1 file",
            detail: "in waveterm",
            action: "Start agent with 2 comments",
        });
    });

    it("does not offer to start an agent while the live one is asking", () => {
        const r = resolveRecipient(batchOf(), facts({ agent: { ...LIVE_AGENT, state: "asking" } }));
        const t = sendBarText({ comments: 2, files: 1 }, r);
        expect(t.detail).toBe("loom is asking a question — answer it first");
        expect(t.action).toBe("Send 2 comments");
        expect(t.action).not.toContain("Start agent");
    });

    it("keeps the Start label on a wait and shows its reason", () => {
        const t = sendBarText(
            { comments: 2, files: 1 },
            { kind: "wait", reason: "run 3f9a21c4 hasn't landed; send once it does" }
        );
        expect(t).toMatchObject({
            detail: "run 3f9a21c4 hasn't landed; send once it does",
            action: "Start agent with 2 comments",
        });
    });
});

describe("sendBatch", () => {
    interface Fake extends CommentSendIO {
        prompts: [string, string][];
        launches: [string, string, string][];
    }
    const fakeIO = (over: Partial<CommentSendIO> = {}): Fake => {
        const io: Fake = {
            prompts: [],
            launches: [],
            prompt: async (blockId, text) => {
                io.prompts.push([blockId, text]);
            },
            launch: async (cwd, project, task) => {
                io.launches.push([cwd, project, task]);
            },
            exists: async () => true,
            ...over,
        };
        return io;
    };
    const LIVE: Recipient = { kind: "live", name: "loom", blockId: "blk-1", working: false };
    const NEW: Recipient = { kind: "new", cwd: "C:/p/waveterm", project: "waveterm", folder: "waveterm" };

    const seed = (b: CommentBatch) => globalStore.set(commentStoreAtom, { [b.source.key]: b });
    const stored = (b: CommentBatch) => globalStore.get(commentStoreAtom)[b.source.key];

    beforeEach(() => {
        globalStore.set(commentStoreAtom, {});
        globalStore.set(sentNoteAtom, {});
    });

    it("sends the live prompt, clears the batch and leaves the sent note", async () => {
        const b = batchOf();
        seed(b);
        const io = fakeIO();
        await sendBatch(b, LIVE, io);
        expect(io.prompts).toEqual([["blk-1", buildCommentPrompt(b, "live")]]);
        expect(stored(b)).toBeUndefined();
        expect(globalStore.get(sentNoteAtom)[b.source.key]).toMatchObject({ count: 2, to: "loom" });
    });

    it("launches a new agent with the new-agent prompt and clears the batch without a note", async () => {
        const b = batchOf();
        seed(b);
        const io = fakeIO();
        await sendBatch(b, NEW, io);
        expect(io.launches).toEqual([["C:/p/waveterm", "waveterm", buildCommentPrompt(b, "new")]]);
        expect(stored(b)).toBeUndefined();
        expect(globalStore.get(sentNoteAtom)[b.source.key]).toBeUndefined();
    });

    it("throws what failed when the prompt is rejected, and keeps the batch", async () => {
        const b = batchOf();
        seed(b);
        const io = fakeIO({ prompt: async () => Promise.reject(new Error("no session")) });
        await expect(sendBatch(b, LIVE, io)).rejects.toThrow("Couldn't send to loom: no session");
        expect(stored(b)).toBe(b);
        expect(globalStore.get(sentNoteAtom)[b.source.key]).toBeUndefined();
    });

    it("throws what failed when the launch is rejected, and keeps the batch", async () => {
        const b = batchOf();
        seed(b);
        const io = fakeIO({ launch: async () => Promise.reject(new Error("no active workspace")) });
        await expect(sendBatch(b, NEW, io)).rejects.toThrow("Couldn't start an agent in waveterm: no active workspace");
        expect(stored(b)).toBe(b);
    });

    it("throws a wait recipient's reason and sends nothing", async () => {
        const b = batchOf();
        seed(b);
        const io = fakeIO();
        await expect(sendBatch(b, { kind: "wait", reason: "the folder is gone" }, io)).rejects.toThrow(
            "the folder is gone"
        );
        expect(io.prompts).toEqual([]);
        expect(io.launches).toEqual([]);
        expect(stored(b)).toBe(b);
    });

    it("sendBatch refuses a second send of the same batch while one is in flight", async () => {
        const b = batchOf();
        seed(b);
        let release: () => void = () => {};
        const io = fakeIO({
            prompt: (blockId, text) =>
                new Promise<void>((resolve) => {
                    io.prompts.push([blockId, text]);
                    release = resolve;
                }),
        });
        const first = sendBatch(b, LIVE, io);
        await sendBatch(b, LIVE, io);
        expect(io.prompts).toHaveLength(1);
        release();
        await first;
        expect(io.prompts).toHaveLength(1);
        expect(stored(b)).toBeUndefined();
    });

    it("allows a send again after a failed one", async () => {
        const b = batchOf();
        seed(b);
        let fail = true;
        const io = fakeIO({
            prompt: async (blockId, text) => {
                if (fail) {
                    throw new Error("boom");
                }
                io.prompts.push([blockId, text]);
            },
        });
        await expect(sendBatch(b, LIVE, io)).rejects.toThrow("boom");
        fail = false;
        await sendBatch(b, LIVE, io);
        expect(io.prompts).toHaveLength(1);
    });

    // the hand-over takes seconds and the composer stays usable, so a comment can land mid-send
    const addDuringSend = () =>
        addComment(batchOf().source, {
            path: "src/b.go",
            side: "modified",
            start: 5,
            end: 5,
            quote: ["five"],
            refs: REFS,
            note: "added mid-send",
        });

    it("sendBatch keeps a comment added while a live send is in flight", async () => {
        const b = batchOf();
        seed(b);
        let release: () => void = () => {};
        const io = fakeIO({ prompt: () => new Promise<void>((resolve) => (release = resolve)) });
        const sent = sendBatch(b, LIVE, io);
        addDuringSend();
        release();
        await sent;
        expect(stored(b).comments.map((c) => c.note)).toEqual(["added mid-send"]);
        expect(globalStore.get(sentNoteAtom)[b.source.key]).toMatchObject({ count: b.comments.length, to: "loom" });
    });

    it("sendBatch keeps a comment added while a new agent is starting", async () => {
        const b = batchOf();
        seed(b);
        let release: () => void = () => {};
        const io = fakeIO({ launch: () => new Promise<void>((resolve) => (release = resolve)) });
        const sent = sendBatch(b, NEW, io);
        addDuringSend();
        release();
        await sent;
        expect(stored(b).comments.map((c) => c.note)).toEqual(["added mid-send"]);
    });
});
