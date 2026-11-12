// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { globalStore } from "@/app/store/jotaiStore";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentVM } from "./agentsviewmodel";
import {
    addComment,
    batchSourceFor,
    batchSummary,
    COMMENT_STORAGE_KEY,
    commentDraftAtom,
    commentsOnPair,
    commentStoreAtom,
    countsByPath,
    deleteComment,
    discardBatch,
    MAX_COMMENT_BATCHES,
    MAX_QUOTE_LINES,
    pairKey,
    parseStoredComments,
    pruneBatches,
    quoteLines,
    relocate,
    relocateComments,
    samePair,
    removeComments,
    sentNoteAtom,
    type BatchSource,
    type CommentBatch,
    type CommentDraft,
    type PendingComment,
} from "./diffcomments";
import type { DiffPairRefs } from "./diffcontent";
import type { DiffScope } from "./diffscope";

const REFS: DiffPairRefs = { original: { kind: "ref", ref: "HEAD" }, modified: { kind: "worktree" } };
const OTHER_REFS: DiffPairRefs = { original: { kind: "ref", ref: "abc^" }, modified: { kind: "ref", ref: "abc" } };
const SOURCE: BatchSource = { key: "agent:a1", kind: "agent", label: "loom", cwd: "/repo", agentId: "a1" };

const comment = (over: Partial<PendingComment> = {}): PendingComment => ({
    id: "c1",
    path: "src/a.go",
    side: "modified",
    start: 2,
    end: 2,
    quote: ["two"],
    refs: REFS,
    note: "why",
    at: 1,
    ...over,
});
const batch = (comments: PendingComment[], over: Partial<CommentBatch> = {}): CommentBatch => ({
    source: SOURCE,
    at: 1,
    comments,
    ...over,
});
const draft = (over: Partial<CommentDraft> = {}): CommentDraft => ({
    path: "src/a.go",
    side: "modified",
    start: 2,
    end: 3,
    quote: ["two", "three"],
    refs: REFS,
    note: "fix it",
    ...over,
});

function mockLocalStorage(): { data: Record<string, string>; writes: () => number } {
    const data: Record<string, string> = {};
    let writes = 0;
    (globalThis as any).localStorage = {
        getItem: (k: string) => (k in data ? data[k] : null),
        setItem: (k: string, v: string) => {
            writes++;
            data[k] = v;
        },
        removeItem: (k: string) => {
            delete data[k];
        },
    };
    return { data, writes: () => writes };
}

function reset(): void {
    globalStore.set(commentStoreAtom, {});
    globalStore.set(commentDraftAtom, null);
    globalStore.set(sentNoteAtom, {});
}

beforeEach(reset);
afterEach(() => {
    delete (globalThis as any).localStorage;
    vi.restoreAllMocks();
    reset();
});

describe("parseStoredComments", () => {
    const good = batch([comment()]);

    it("keeps good batches and drops malformed ones one by one", () => {
        const raw = JSON.stringify({
            "agent:a1": good,
            "agent:bad1": "nope",
            "agent:bad2": { source: SOURCE, at: "x", comments: [comment()] },
            "agent:bad3": { source: { key: 1 }, at: 1, comments: [comment()] },
            "agent:bad4": { source: SOURCE, at: 1, comments: "nope" },
            "agent:a2": { ...good, source: { ...SOURCE, key: "agent:a2" } },
        });
        expect(Object.keys(parseStoredComments(raw)).sort()).toEqual(["agent:a1", "agent:a2"]);
    });

    it("drops a malformed comment, not its batch", () => {
        const without = (id: string, field: keyof PendingComment): any => {
            const c: any = comment({ id });
            delete c[field];
            return c;
        };
        const raw = JSON.stringify({
            "agent:a1": batch([
                comment({ id: "ok" }),
                without("x", "path"),
                without("y", "start"),
                without("z", "refs"),
                comment({ id: "backwards", start: 5, end: 3 }),
                comment({ id: "badside", side: "left" as any }),
                comment({ id: "badquote", quote: [1] as any }),
                comment({ id: "badrefs", refs: { original: { kind: "ref" }, modified: { kind: "worktree" } } as any }),
            ]),
        });
        const out = parseStoredComments(raw);
        expect(out["agent:a1"].comments.map((c) => c.id)).toEqual(["ok"]);
    });

    it("drops a batch left with no valid comment", () => {
        const raw = JSON.stringify({ "agent:a1": batch([comment({ start: 5, end: 3 })]) });
        expect(parseStoredComments(raw)).toEqual({});
    });

    it("starts empty on null, non-JSON and non-object data without throwing", () => {
        vi.spyOn(console, "warn").mockImplementation(() => {});
        expect(parseStoredComments(null)).toEqual({});
        expect(parseStoredComments("{not json")).toEqual({});
        expect(parseStoredComments("[1,2]")).toEqual({});
        expect(parseStoredComments('"str"')).toEqual({});
        expect(parseStoredComments("null")).toEqual({});
    });

    it("round-trips what addComment stores", () => {
        const store = { "agent:a1": batch([comment({ lost: true })]) };
        expect(parseStoredComments(JSON.stringify(store))).toEqual(store);
    });

    // pairKey is the refs' JSON, so the parsed refs must come back in pairRefsFor's key order
    it("round-trips the refs in the order pairKey reads them", () => {
        const refs: DiffPairRefs = {
            original: { kind: "ref", ref: "abc^" },
            modified: { kind: "ref", ref: "abc" },
        };
        const store = { "agent:a1": batch([comment({ refs })]) };
        expect(JSON.stringify(parseStoredComments(JSON.stringify(store))["agent:a1"].comments[0].refs)).toBe(
            JSON.stringify(refs)
        );
    });
});

describe("pruneBatches", () => {
    it("keeps the newest batches by at", () => {
        const store: Record<string, CommentBatch> = {};
        for (let i = 0; i < MAX_COMMENT_BATCHES + 5; i++) {
            store[`agent:${i}`] = batch([comment()], { at: i });
        }
        const out = pruneBatches(store, MAX_COMMENT_BATCHES);
        expect(Object.keys(out)).toHaveLength(MAX_COMMENT_BATCHES);
        expect(out["agent:0"]).toBeUndefined();
        expect(out["agent:4"]).toBeUndefined();
        expect(out["agent:5"]).toBeDefined();
        expect(out[`agent:${MAX_COMMENT_BATCHES + 4}`]).toBeDefined();
    });

    it("returns the same object when under the cap", () => {
        const store = { "agent:a1": batch([comment()]) };
        expect(pruneBatches(store, MAX_COMMENT_BATCHES)).toBe(store);
    });
});

describe("quoteLines", () => {
    const text = "one\ntwo\nthree\nfour";
    it("returns the 1-based inclusive range", () => {
        expect(quoteLines(text, 2, 3)).toEqual(["two", "three"]);
        expect(quoteLines(text, 4, 4)).toEqual(["four"]);
    });

    it("caps at MAX_QUOTE_LINES from the start", () => {
        const long = Array.from({ length: 100 }, (_, i) => `l${i + 1}`).join("\n");
        const q = quoteLines(long, 10, 90);
        expect(q).toHaveLength(MAX_QUOTE_LINES);
        expect(q[0]).toBe("l10");
    });

    it("reads CRLF text without the carriage returns", () => {
        expect(quoteLines("a\r\nb\r\nc", 2, 2)).toEqual(["b"]);
    });
});

describe("relocate", () => {
    const c = comment({ start: 2, end: 3, quote: ["two", "three"] });

    it("returns the same object when the quote is still at its range", () => {
        expect(relocate(c, "one\ntwo\nthree\nfour")).toBe(c);
    });

    it("moves to the quoted block when lines were inserted above", () => {
        const out = relocate(c, "new1\nnew2\none\ntwo\nthree\nfour");
        expect(out).toMatchObject({ start: 4, end: 5 });
        expect(out.lost).toBeUndefined();
        expect(out.id).toBe(c.id);
    });

    it("picks the nearest of several exact matches", () => {
        const text = ["two", "three", "x", "x", "x", "x", "two", "three", "x", "x", "y", "y"].join("\n");
        // at 2 the block is not in place; matches start at 1 and 7, and 1 is nearer to 2
        expect(relocate(c, text)).toMatchObject({ start: 1, end: 2 });
        const far = comment({ start: 9, end: 10, quote: ["two", "three"] });
        expect(relocate(far, text)).toMatchObject({ start: 7, end: 8 });
    });

    it("keeps a long range's length when only its first lines are quoted", () => {
        const long = comment({ start: 2, end: 60, quote: ["two", "three"] });
        const text = ["zero", "one", "two", "three", ...Array.from({ length: 70 }, () => "pad")].join("\n");
        expect(relocate(long, text)).toMatchObject({ start: 3, end: 61 });
    });

    it("marks lost when the block is gone, keeping its original lines", () => {
        const out = relocate(c, "one\nTWO\nthree\nfour");
        expect(out).toMatchObject({ lost: true, start: 2, end: 3, quote: ["two", "three"] });
    });

    it("relocate marks lost on empty text", () => {
        expect(relocate(comment({ quote: [""] }), "")).toMatchObject({ lost: true, start: 2, end: 2 });
    });

    it("keeps an already-lost comment lost, as the same object", () => {
        const lost = relocate(c, "nothing");
        expect(relocate(lost, "still nothing")).toBe(lost);
    });

    it("clears lost when the block returns", () => {
        const lost = relocate(c, "nothing");
        const back = relocate(lost, "a\none\ntwo\nthree");
        expect(back.lost).toBeUndefined();
        expect(back).toMatchObject({ start: 3, end: 4 });
        expect("lost" in back).toBe(false);
    });
});

describe("addComment", () => {
    it("starts a batch with the source and the comment", () => {
        mockLocalStorage();
        addComment(SOURCE, draft());
        const b = globalStore.get(commentStoreAtom)["agent:a1"];
        expect(b.source).toEqual(SOURCE);
        expect(b.comments).toHaveLength(1);
        expect(b.comments[0]).toMatchObject({
            path: "src/a.go",
            side: "modified",
            start: 2,
            end: 3,
            quote: ["two", "three"],
            refs: REFS,
            note: "fix it",
        });
        expect(b.comments[0].id).toBeTruthy();
    });

    it("keeps the comment in memory and warns when the write throws, or there is no localStorage", () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        (globalThis as any).localStorage = {
            getItem: () => null,
            setItem: () => {
                throw new Error("quota");
            },
        };
        addComment(SOURCE, draft());
        expect(globalStore.get(commentStoreAtom)["agent:a1"].comments).toHaveLength(1);
        expect(warn).toHaveBeenCalled();
        delete (globalThis as any).localStorage;
        addComment(SOURCE, draft({ start: 5, end: 5 }));
        expect(globalStore.get(commentStoreAtom)["agent:a1"].comments).toHaveLength(2);
    });

    it("gives each comment its own id", () => {
        mockLocalStorage();
        addComment(SOURCE, draft());
        addComment(SOURCE, draft({ start: 5, end: 5 }));
        const ids = globalStore.get(commentStoreAtom)["agent:a1"].comments.map((c) => c.id);
        expect(new Set(ids).size).toBe(2);
    });

    it("persists to localStorage", () => {
        const ls = mockLocalStorage();
        addComment(SOURCE, draft());
        expect(Object.keys(JSON.parse(ls.data[COMMENT_STORAGE_KEY]))).toEqual(["agent:a1"]);
    });

    it("with editingId replaces the note and keeps the id and anchor", () => {
        mockLocalStorage();
        addComment(SOURCE, draft());
        const [orig] = globalStore.get(commentStoreAtom)["agent:a1"].comments;
        addComment(SOURCE, draft({ editingId: orig.id, note: "changed", start: 9, end: 9, quote: ["nine"] }));
        const comments = globalStore.get(commentStoreAtom)["agent:a1"].comments;
        expect(comments).toHaveLength(1);
        expect(comments[0]).toMatchObject({
            id: orig.id,
            note: "changed",
            start: orig.start,
            end: orig.end,
            quote: orig.quote,
        });
    });

    it("clears the source's sent note and leaves other sources' alone", () => {
        mockLocalStorage();
        globalStore.set(sentNoteAtom, {
            "agent:a1": { count: 3, to: "loom", at: 1 },
            "agent:a2": { count: 1, to: "other", at: 1 },
        });
        addComment(SOURCE, draft());
        expect(Object.keys(globalStore.get(sentNoteAtom))).toEqual(["agent:a2"]);
    });

    it("from a source with cwd empty keeps the batch's stored cwd, project and runId", () => {
        mockLocalStorage();
        addComment({ ...SOURCE, project: "waveterm", runId: "r1" }, draft());
        addComment({ ...SOURCE, cwd: "" }, draft({ start: 5, end: 5 }));
        const b = globalStore.get(commentStoreAtom)["agent:a1"];
        expect(b.source).toMatchObject({ cwd: "/repo", project: "waveterm", runId: "r1" });
        expect(b.comments).toHaveLength(2);
    });

    it("takes a newly resolved cwd over the stored one", () => {
        mockLocalStorage();
        addComment(SOURCE, draft());
        addComment({ ...SOURCE, cwd: "/moved" }, draft({ start: 5, end: 5 }));
        expect(globalStore.get(commentStoreAtom)["agent:a1"].source.cwd).toBe("/moved");
    });

    it("prunes to the newest batches", () => {
        mockLocalStorage();
        const store: Record<string, CommentBatch> = {};
        for (let i = 0; i < MAX_COMMENT_BATCHES; i++) {
            store[`agent:old${i}`] = batch([comment()], { at: i + 1 });
        }
        globalStore.set(commentStoreAtom, store);
        addComment(SOURCE, draft());
        const keys = Object.keys(globalStore.get(commentStoreAtom));
        expect(keys).toHaveLength(MAX_COMMENT_BATCHES);
        expect(keys).toContain("agent:a1");
        expect(keys).not.toContain("agent:old0");
    });
});

describe("deleteComment and discardBatch", () => {
    it("deleting the last comment removes the batch", () => {
        mockLocalStorage();
        addComment(SOURCE, draft());
        const [c] = globalStore.get(commentStoreAtom)["agent:a1"].comments;
        deleteComment("agent:a1", c.id);
        expect(globalStore.get(commentStoreAtom)["agent:a1"]).toBeUndefined();
    });

    it("deleting one of two keeps the other", () => {
        mockLocalStorage();
        addComment(SOURCE, draft());
        addComment(SOURCE, draft({ start: 7, end: 7 }));
        const [a, b] = globalStore.get(commentStoreAtom)["agent:a1"].comments;
        deleteComment("agent:a1", a.id);
        expect(globalStore.get(commentStoreAtom)["agent:a1"].comments.map((c) => c.id)).toEqual([b.id]);
    });

    it("ignores an unknown key or id without writing", () => {
        const ls = mockLocalStorage();
        addComment(SOURCE, draft());
        const before = ls.writes();
        deleteComment("agent:a1", "nope");
        deleteComment("agent:zzz", "nope");
        discardBatch("agent:zzz");
        expect(ls.writes()).toBe(before);
    });

    it("discardBatch drops the whole batch and persists it", () => {
        const ls = mockLocalStorage();
        addComment(SOURCE, draft());
        addComment({ ...SOURCE, key: "agent:a2" }, draft());
        discardBatch("agent:a1");
        expect(Object.keys(globalStore.get(commentStoreAtom))).toEqual(["agent:a2"]);
        expect(Object.keys(JSON.parse(ls.data[COMMENT_STORAGE_KEY]))).toEqual(["agent:a2"]);
    });
});

describe("removeComments", () => {
    const addThree = () => {
        addComment(SOURCE, draft());
        addComment(SOURCE, draft({ start: 7, end: 7 }));
        addComment(SOURCE, draft({ start: 9, end: 9 }));
        return globalStore.get(commentStoreAtom)["agent:a1"].comments;
    };

    it("removeComments keeps a comment that is not in ids", () => {
        const ls = mockLocalStorage();
        const [a, b, c] = addThree();
        removeComments("agent:a1", [a.id, b.id]);
        expect(globalStore.get(commentStoreAtom)["agent:a1"].comments).toEqual([c]);
        expect(JSON.parse(ls.data[COMMENT_STORAGE_KEY])["agent:a1"].comments).toEqual([c]);
    });

    it("removeComments deletes the batch when every comment is removed", () => {
        const ls = mockLocalStorage();
        const ids = addThree().map((c) => c.id);
        removeComments("agent:a1", ids);
        expect(globalStore.get(commentStoreAtom)["agent:a1"]).toBeUndefined();
        expect(JSON.parse(ls.data[COMMENT_STORAGE_KEY])["agent:a1"]).toBeUndefined();
    });

    it("removeComments writes nothing when no id matches", () => {
        const ls = mockLocalStorage();
        addThree();
        const before = globalStore.get(commentStoreAtom);
        const writes = ls.writes();
        removeComments("agent:a1", ["nope"]);
        removeComments("agent:zzz", ["nope"]);
        expect(globalStore.get(commentStoreAtom)).toBe(before);
        expect(ls.writes()).toBe(writes);
    });
});

describe("relocateComments", () => {
    const texts = (modified: string, original = "") => ({ original, modified });

    it("relocateComments is a no-op when every comment is in place", () => {
        const ls = mockLocalStorage();
        globalStore.set(commentStoreAtom, { "agent:a1": batch([comment()]) });
        const before = globalStore.get(commentStoreAtom);
        relocateComments("agent:a1", "src/a.go", REFS, texts("one\ntwo\nthree"));
        expect(globalStore.get(commentStoreAtom)).toBe(before);
        expect(ls.writes()).toBe(0);
    });

    it("is a no-op for an unknown batch or a path with no comments", () => {
        const ls = mockLocalStorage();
        globalStore.set(commentStoreAtom, { "agent:a1": batch([comment()]) });
        const before = globalStore.get(commentStoreAtom);
        relocateComments("agent:zzz", "src/a.go", REFS, texts("x"));
        relocateComments("agent:a1", "src/other.go", REFS, texts("x"));
        expect(globalStore.get(commentStoreAtom)).toBe(before);
        expect(ls.writes()).toBe(0);
    });

    it("moves a comment and writes once when lines were inserted above", () => {
        const ls = mockLocalStorage();
        globalStore.set(commentStoreAtom, { "agent:a1": batch([comment()], { at: 7 }) });
        relocateComments("agent:a1", "src/a.go", REFS, texts("x\ny\none\ntwo\nthree"));
        const b = globalStore.get(commentStoreAtom)["agent:a1"];
        expect(b.comments[0]).toMatchObject({ start: 4, end: 4 });
        expect(b.at).toBe(7);
        expect(ls.writes()).toBe(1);
    });

    it("checks each comment against its own side's text", () => {
        mockLocalStorage();
        const orig = comment({ id: "o", side: "original", start: 1, end: 1, quote: ["gone"] });
        globalStore.set(commentStoreAtom, { "agent:a1": batch([comment(), orig]) });
        relocateComments("agent:a1", "src/a.go", REFS, texts("one\ntwo", "gone"));
        expect(globalStore.get(commentStoreAtom)["agent:a1"].comments.every((c) => !c.lost)).toBe(true);
    });

    it("leaves comments on another pair alone", () => {
        const ls = mockLocalStorage();
        globalStore.set(commentStoreAtom, { "agent:a1": batch([comment({ refs: OTHER_REFS })]) });
        relocateComments("agent:a1", "src/a.go", REFS, texts("nothing here"));
        expect(globalStore.get(commentStoreAtom)["agent:a1"].comments[0].lost).toBeUndefined();
        expect(ls.writes()).toBe(0);
    });

    it("follows the working tree when HEAD moves under it, and takes the new pair once re-found", () => {
        mockLocalStorage();
        const atOld: DiffPairRefs = { original: { kind: "ref", ref: "sha-old" }, modified: { kind: "worktree" } };
        const atNew: DiffPairRefs = { original: { kind: "ref", ref: "sha-new" }, modified: { kind: "worktree" } };
        globalStore.set(commentStoreAtom, { "agent:a1": batch([comment({ refs: atOld })]) });
        // an unrelated commit moved HEAD: the comment is still on this file of the tree
        expect(commentsOnPair(globalStore.get(commentStoreAtom)["agent:a1"], "src/a.go", atNew)).toHaveLength(1);
        relocateComments("agent:a1", "src/a.go", atNew, texts("x\none\ntwo"));
        const c = globalStore.get(commentStoreAtom)["agent:a1"].comments[0];
        expect(c).toMatchObject({ start: 3, refs: atNew });
        expect(c.lost).toBeUndefined();
    });

    it("marks every comment on a path lost when the file is emptied, then finds them again", () => {
        mockLocalStorage();
        globalStore.set(commentStoreAtom, { "agent:a1": batch([comment()]) });
        relocateComments("agent:a1", "src/a.go", REFS, texts(""));
        expect(globalStore.get(commentStoreAtom)["agent:a1"].comments[0].lost).toBe(true);
        relocateComments("agent:a1", "src/a.go", REFS, texts("one\ntwo"));
        expect(globalStore.get(commentStoreAtom)["agent:a1"].comments[0].lost).toBeUndefined();
    });
});

describe("reading a batch", () => {
    const b = batch([
        comment({ id: "1", path: "a.go" }),
        comment({ id: "2", path: "a.go", refs: OTHER_REFS }),
        comment({ id: "3", path: "a.go", lost: true }),
        comment({ id: "4", path: "b.go" }),
    ]);

    it("pairKey tells pairs apart", () => {
        expect(pairKey(REFS)).not.toBe(pairKey(OTHER_REFS));
        expect(pairKey(REFS)).toBe(pairKey({ ...REFS }));
    });

    it("samePair holds across a moved base of the working tree, never across a fixed pair", () => {
        const tree = (ref: string): DiffPairRefs => ({ original: { kind: "ref", ref }, modified: { kind: "worktree" } });
        expect(samePair(tree("a"), tree("b"))).toBe(true);
        expect(samePair(OTHER_REFS, { ...OTHER_REFS })).toBe(true);
        expect(samePair(OTHER_REFS, { original: { kind: "ref", ref: "def^" }, modified: { kind: "ref", ref: "def" } })).toBe(
            false
        );
        expect(samePair(tree("a"), OTHER_REFS)).toBe(false);
    });

    it("commentsOnPair filters by path and pair and excludes lost", () => {
        expect(commentsOnPair(b, "a.go", REFS).map((c) => c.id)).toEqual(["1"]);
        expect(commentsOnPair(b, "a.go", OTHER_REFS).map((c) => c.id)).toEqual(["2"]);
        expect(commentsOnPair(b, "c.go", REFS)).toEqual([]);
        expect(commentsOnPair(undefined, "a.go", REFS)).toEqual([]);
    });

    it("countsByPath counts every pair and lost comments", () => {
        expect(countsByPath(b)).toEqual({ "a.go": 3, "b.go": 1 });
        expect(countsByPath(undefined)).toEqual({});
    });

    it("batchSummary counts comments and files, lost included", () => {
        expect(batchSummary(b)).toEqual({ comments: 4, files: 2 });
        expect(batchSummary(undefined)).toEqual({ comments: 0, files: 0 });
    });
});

describe("batchSourceFor", () => {
    const scope = (origin: DiffScope["repo"]["origin"], label: string): DiffScope => ({
        repo: { origin, label },
        range: { kind: "working" },
    });

    it("maps an agent origin and copies runId and project from the roster entry", () => {
        const agent = { id: "a1", runId: "r9", project: "waveterm" } as AgentVM;
        expect(batchSourceFor(scope({ kind: "agent", id: "a1" }, "loom"), "/repo", agent)).toEqual({
            key: "agent:a1",
            kind: "agent",
            label: "loom",
            cwd: "/repo",
            agentId: "a1",
            runId: "r9",
            project: "waveterm",
        });
    });

    it("maps an agent origin whose agent has left the roster", () => {
        expect(batchSourceFor(scope({ kind: "agent", id: "a1" }, "loom"), null, undefined)).toEqual({
            key: "agent:a1",
            kind: "agent",
            label: "loom",
            cwd: "",
            agentId: "a1",
        });
    });

    it("maps a project origin with its name and path", () => {
        expect(
            batchSourceFor(
                scope({ kind: "project", name: "waveterm", path: "/p/waveterm" }, "waveterm"),
                "/p/waveterm",
                undefined
            )
        ).toEqual({
            key: "project:waveterm",
            kind: "project",
            label: "waveterm",
            cwd: "/p/waveterm",
            project: "waveterm",
            projectPath: "/p/waveterm",
        });
    });

    it("maps a worktree origin to its own checkout and its project", () => {
        expect(
            batchSourceFor(
                scope({ kind: "worktree", path: "/p/waveterm/.worktrees/x", project: "waveterm" }, "x"),
                "/p/waveterm/.worktrees/x",
                undefined
            )
        ).toEqual({
            key: "worktree:/p/waveterm/.worktrees/x",
            kind: "worktree",
            label: "x",
            cwd: "/p/waveterm/.worktrees/x",
            project: "waveterm",
            projectPath: "/p/waveterm/.worktrees/x",
        });
    });

    it("maps a run origin with its run id", () => {
        expect(
            batchSourceFor(
                scope({ kind: "run", runId: "r1", cwd: "/w/r1", baseCommit: "abc" }, "run r1"),
                "/w/r1",
                undefined
            )
        ).toEqual({ key: "run:r1", kind: "run", label: "run r1", cwd: "/w/r1", runId: "r1" });
    });

    it("returns null with no scope", () => {
        expect(batchSourceFor(null, "/repo", undefined)).toBeNull();
    });

    it("gives cwd an empty string when it is unresolved", () => {
        const s = scope({ kind: "project", name: "p", path: "/p" }, "p");
        expect(batchSourceFor(s, null, undefined)?.cwd).toBe("");
        expect(batchSourceFor(s, undefined, undefined)?.cwd).toBe("");
    });
});
