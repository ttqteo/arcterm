import { describe, expect, it } from "vitest";
import { chunkMove, chunkTrail, trailCounts } from "./chunktrail";
import type { FeedEntry } from "./effortfeed";

const e = (seq: number, over: Partial<FeedEntry> = {}): FeedEntry => ({
    seq,
    ts: 1000 + seq,
    kind: "effort-note",
    chunk: "N1",
    status: "active",
    marked: "",
    text: "",
    ...over,
});
const note = (seq: number, text: string, over: Partial<FeedEntry> = {}) => e(seq, { text, noteAt: seq, ...over });
const marked = (seq: number, status: string, text = "") =>
    e(seq, { kind: status === "done" ? "chunk-done" : "chunk-status", marked: "marked " + status, text });

// the scenario's chunk: three notes, two bare status changes, newest first as effortFeed gives them
const FEED: FeedEntry[] = [
    note(5, "the newest note", { author: "agent", session: "agent:tab1" }),
    marked(4, "active"),
    note(3, "a note of mine", { author: "you" }),
    marked(2, "pending"),
    note(1, "the oldest note"),
    note(9, "another chunk's note", { chunk: "N2" }),
];

describe("chunkTrail", () => {
    it("keeps the chunk's entries newest first: notes as blocks, bare status changes as lines", () => {
        const trail = chunkTrail(FEED, "N1", 5000, new Set(), false);
        expect(trail.map((t) => `${t.kind}:${t.key}`)).toEqual(["note:5", "status:4", "note:3", "status:2", "note:1"]);
        expect(trail[1]).toMatchObject({ kind: "status", status: "active", tone: "active" });
        expect(trail[3]).toMatchObject({ kind: "status", status: "pending", tone: "pending" });
    });

    it("sorts by time even when the feed arrives out of order", () => {
        const trail = chunkTrail([note(1, "old"), note(3, "new"), marked(2, "blocked")], "N1", 5000, new Set(), false);
        expect(trail.map((t) => t.key)).toEqual(["3", "2", "1"]);
    });

    it("a status change that carries text is a block tagged with the status it set", () => {
        const trail = chunkTrail([marked(2, "blocked", "waiting on the API key")], "N1", 5000, new Set(), false);
        expect(trail).toHaveLength(1);
        expect(trail[0]).toMatchObject({ kind: "note", tag: "blocked", text: "waiting on the API key" });
    });

    it("a plain note carries no tag", () => {
        const [block] = chunkTrail([note(1, "just a note")], "N1", 5000, new Set(), false);
        expect(block).toMatchObject({ kind: "note", tag: null });
    });

    it("a status change whose status went unrecorded still draws, with no status", () => {
        const [line] = chunkTrail(
            [e(1, { kind: "chunk-status", marked: "status changed" })],
            "N1",
            5000,
            new Set(),
            false
        );
        expect(line).toMatchObject({ kind: "status", status: null });
    });

    it("leaves out the chunk's bookkeeping that is not a status change", () => {
        expect(
            chunkTrail([e(1, { kind: "chunk-added", marked: "chunk added" })], "N1", 5000, new Set(), false)
        ).toEqual([]);
    });

    it("notes only hides the thin lines and keeps every block", () => {
        const trail = chunkTrail(FEED, "N1", 5000, new Set(), true);
        expect(trail.map((t) => t.kind)).toEqual(["note", "note", "note"]);
    });

    it("a block is expanded only when the person asked for all of it", () => {
        const trail = chunkTrail(FEED, "N1", 5000, new Set(["3"]), false);
        const blocks = trail.filter((t) => t.kind === "note");
        expect(blocks.map((b) => b.expanded)).toEqual([false, true, false]);
    });

    it("keeps who wrote a note and where it came from", () => {
        const [first] = chunkTrail(FEED, "N1", 5000, new Set(), false);
        // an agent's note is its record of what it did: only the person's own notes edit
        expect(first).toMatchObject({ who: "agent", sessionTab: "tab1", editable: false });
        expect(chunkTrail(FEED, "N1", 5000, new Set(), true)[1]).toMatchObject({ who: "you", editable: true });
    });
});

describe("trailCounts", () => {
    it("counts the status changes and the notes, a status change with text in both", () => {
        const trail = chunkTrail([...FEED, marked(0, "blocked", "why")], "N1", 5000, new Set(), false);
        expect(trailCounts(trail)).toEqual({ statusChanges: 3, notes: 4 });
    });
});

describe("chunkMove", () => {
    it("pending starts the chunk", () => {
        expect(chunkMove("pending", false)).toEqual({ label: "Start", move: { kind: "set", status: "active" } });
    });
    it("the active chunk is done by advancing the plan", () => {
        expect(chunkMove("active", true)).toEqual({ label: "Done", move: { kind: "advance" } });
    });
    it("an active chunk that is not the one advance would close is marked done", () => {
        expect(chunkMove("active", false)).toEqual({ label: "Done", move: { kind: "set", status: "done" } });
    });
    it("a done chunk reopens", () => {
        expect(chunkMove("done", false)).toEqual({ label: "Reopen", move: { kind: "reopen" } });
    });
    it("a blocked chunk unblocks to active", () => {
        expect(chunkMove("blocked", false)).toEqual({ label: "Unblock", move: { kind: "set", status: "active" } });
    });
    it("a deferred or skipped chunk reopens to pending", () => {
        expect(chunkMove("deferred", false)).toEqual({ label: "Reopen", move: { kind: "set", status: "pending" } });
        expect(chunkMove("skipped", false)).toEqual({ label: "Reopen", move: { kind: "set", status: "pending" } });
    });
    it("a proposed chunk has no move here", () => {
        expect(chunkMove("proposed", false)).toBeNull();
    });
});
