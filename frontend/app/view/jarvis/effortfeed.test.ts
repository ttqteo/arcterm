import { describe, expect, it } from "vitest";
import {
    clock,
    codeSegments,
    dayLabel,
    effortFeed,
    feedGroups,
    feedNoteCounts,
    headline,
    kilo,
    noteBody,
    paragraphs,
    stamp,
    type FeedEntry,
    type FeedGroupRow,
} from "./effortfeed";

const MIN = 60 * 1000;
// local time, so the day and clock assertions hold in any timezone
const T = new Date(2026, 8, 15, 9, 5).getTime();

function effort(chunks: Partial<EffortChunk>[], events: EffortEvent[]): Effort {
    return {
        oid: "e1",
        otype: "effort",
        version: 1,
        meta: {},
        title: "t",
        status: "active",
        createdts: 0,
        updatedts: 0,
        chunks: chunks.map((c) => ({ label: "", status: "pending", updatedts: 0, ...c })),
        events,
    } as Effort;
}

describe("effortFeed", () => {
    it("names a note's chunk by the note written onto it, even when the event holds an index", () => {
        const e = effort(
            [{ label: "A" }, { label: "B", status: "active", notes: [{ ts: T, text: "shipped the fold" }] }],
            [{ ts: T, kind: "effort-note", label: "2", text: "shipped the fold" }]
        );
        expect(effortFeed(e)).toEqual([
            {
                seq: 0,
                ts: T,
                kind: "effort-note",
                chunk: "B",
                status: "active",
                marked: "",
                text: "shipped the fold",
                noteAt: 1,
                edited: false,
            },
        ]);
    });

    it("reads a status change's note off the chunk when the event dropped it", () => {
        const e = effort(
            [{ label: "B", status: "done", notes: [{ ts: T, text: "marked done · plan written" }] }],
            [{ ts: T, kind: "chunk-done", label: "B", text: "" }]
        );
        const [entry] = effortFeed(e);
        expect([entry.marked, entry.text]).toEqual(["marked done", "plan written"]);
    });

    it("prefers the chunk the event names when one batch marks two chunks alike", () => {
        const e = effort(
            [
                { label: "A", status: "done", notes: [{ ts: T, text: "marked done" }] },
                { label: "B", status: "done", notes: [{ ts: T, text: "marked done" }] },
            ],
            [
                { ts: T, kind: "chunk-done", label: "B", text: "" },
                { ts: T, kind: "chunk-done", label: "A", text: "" },
            ]
        );
        expect(effortFeed(e).map((x) => [x.seq, x.chunk])).toEqual([
            [1, "A"],
            [0, "B"],
        ]);
    });

    it("follows a renamed chunk from the label an added event still carries", () => {
        const e = effort(
            [{ label: "B2 new", notes: [{ ts: T + MIN, text: "renamed from B2 old" }] }],
            [{ ts: T, kind: "chunk-added", label: "B2 old" }]
        );
        const [entry] = effortFeed(e);
        expect([entry.chunk, entry.marked, entry.text]).toEqual(["B2 new", "chunk added", ""]);
    });

    it("tags an entry on a chunk that no longer exists as removed", () => {
        const e = effort([{ label: "A" }], [{ ts: T, kind: "effort-note", label: "4", text: "old note" }]);
        const [entry] = effortFeed(e);
        expect([entry.chunk, entry.status, entry.text]).toEqual(["removed chunk", "removed", "old note"]);
    });

    it("lists newest first and leaves out effort-level events", () => {
        const e = effort(
            [{ label: "A", notes: [{ ts: T + 1, text: "one" }] }],
            [
                { ts: T, kind: "effort-created" },
                { ts: T + 1, kind: "effort-note", label: "A", text: "one" },
                { ts: T + 2, kind: "effort-status", text: "paused" },
                { ts: T + 3, kind: "chunk-added", label: "A" },
            ]
        );
        expect(effortFeed(e).map((x) => x.kind)).toEqual(["chunk-added", "effort-note"]);
    });
});

describe("note text", () => {
    it("drops a leading date only when it repeats the note's own day", () => {
        expect(noteBody({ ts: T, text: "2026-09-15: code complete." })).toBe("code complete.");
        expect(noteBody({ ts: T, text: "2026-09-14 code complete." })).toBe("2026-09-14 code complete.");
    });

    it("heads a note with its first sentence", () => {
        expect(headline("Code complete, verification partial. Details follow; more.")).toBe(
            "Code complete, verification partial."
        );
        expect(headline("fixed effortops.go and moved on")).toBe("fixed effortops.go and moved on");
    });

    it("cuts an overlong first sentence at a word and marks the cut", () => {
        const head = headline("word ".repeat(50) + "end.");
        expect(head.length).toBeLessThanOrEqual(181);
        expect(head.endsWith("word…")).toBe(true);
    });

    it("puts each inline list item on its own line, sub-items one level deeper", () => {
        const flat = paragraphs("Done: (1) first (a) sub (2) second\nNext line").map((p) => [
            p.level,
            p.segs.map((s) => s.text).join(""),
        ]);
        expect(flat).toEqual([
            [0, "Done:"],
            [1, "(1) first"],
            [2, "(a) sub"],
            [1, "(2) second"],
            [0, "Next line"],
        ]);
    });

    it("sets backtick spans, paths and commit ids as code", () => {
        expect(codeSegments("see `wsh effort` in pkg/jarvisstate/effortops.go at 98077bff04 now")).toEqual([
            { text: "see ", code: false },
            { text: "wsh effort", code: true },
            { text: " in ", code: false },
            { text: "pkg/jarvisstate/effortops.go", code: true },
            { text: " at ", code: false },
            { text: "98077bff04", code: true },
            { text: " now", code: false },
        ]);
    });

    it("stamps today's entries with the time and older ones with the date", () => {
        expect(stamp(T, T + 60 * MIN)).toBe("09:05");
        expect(stamp(new Date(2026, 8, 14, 23, 0).getTime(), T)).toBe("09-14");
    });
});

const entry = (seq: number, ts: number, chunk: string, over: Partial<FeedEntry> = {}): FeedEntry => ({
    seq,
    ts,
    kind: "effort-note",
    chunk,
    status: "active",
    marked: "",
    text: "note " + seq,
    ...over,
});
const added = (seq: number, ts: number, chunk: string) =>
    entry(seq, ts, chunk, { kind: "chunk-added", marked: "chunk added", text: "" });

const shape = (rows: FeedGroupRow[]) =>
    rows.map((r) =>
        r.kind === "day" ? `day ${r.label}` : r.kind === "head" ? `head ${r.chunk}` : `${r.kind} ${r.entry.seq}`
    );

describe("dayLabel and clock", () => {
    it("names today, yesterday with its date, and older days by date", () => {
        expect(dayLabel(T, T)).toBe("Today");
        expect(dayLabel(new Date(2026, 8, 14, 23, 0).getTime(), T)).toBe("Yesterday · Mon 14 Sep");
        expect(dayLabel(new Date(2026, 8, 13, 8, 0).getTime(), T)).toBe("Sun 13 Sep");
    });
    it("reads the time of day as HH:MM, whatever the day", () => {
        expect(clock(new Date(2026, 8, 13, 8, 7).getTime())).toBe("08:07");
    });
});

describe("feedGroups", () => {
    it("divides by day, groups by chunk ordered by newest entry, entries newest first", () => {
        const feed = [
            entry(4, T + 4 * MIN, "A"),
            entry(3, T + 3 * MIN, "B"),
            entry(2, T + 2 * MIN, "A"),
            entry(1, new Date(2026, 8, 14, 12, 0).getTime(), "B"),
        ];
        const { rows } = feedGroups(feed, { only: null, limit: 25, now: T });
        expect(shape(rows)).toEqual([
            "day Today",
            "head A",
            "note 4",
            "note 2",
            "head B",
            "note 3",
            "day Yesterday · Mon 14 Sep",
            "head B",
            "note 1",
        ]);
    });

    it("under one chunk draws no headings but keeps the day dividers, and pages the rest", () => {
        const feed = Array.from({ length: 12 }, (_, i) => entry(11 - i, T - i * 60 * MIN, i % 2 === 0 ? "A" : "B"));
        const { rows, left } = feedGroups(feed, { only: "A", limit: 4, now: T });
        expect(rows.some((r) => r.kind === "head")).toBe(false);
        expect(rows.filter((r) => r.kind === "note")).toHaveLength(4);
        expect(rows[0]).toMatchObject({ kind: "day", label: "Today" });
        expect(left).toBe(2);
    });

    it("folds a chunk added into its heading, and pills a status change whether or not it carries a note", () => {
        const feed = [
            entry(3, T + 3 * MIN, "A", { kind: "chunk-done", marked: "marked done", text: "Landed. Details follow." }),
            entry(2, T + 2 * MIN, "A", { kind: "chunk-status", marked: "marked active", text: "" }),
            added(1, T + MIN, "A"),
        ];
        const { rows } = feedGroups(feed, { only: null, limit: 25, now: T });
        expect(shape(rows)).toEqual(["day Today", "head A", "note 3", "event 2"]);
        expect(rows[1]).toMatchObject({ kind: "head", tone: "active", added: "09:06" });
        expect(rows[2]).toMatchObject({ mark: "done", head: "Landed." });
        expect(rows[3]).toMatchObject({ text: "marked active", time: "09:07", mark: "active" });
    });

    it("keeps a chunk added as its own line under one chunk, where no heading can carry it", () => {
        const { rows } = feedGroups([entry(2, T + MIN, "A"), added(1, T, "A")], { only: "A", limit: 25, now: T });
        expect(shape(rows)).toEqual(["day Today", "note 2", "event 1"]);
        expect(rows[2]).toMatchObject({ text: "chunk added", mark: null });
    });

    it("heads a chunk whose only entry that day is its adding, with nothing under it", () => {
        const { rows } = feedGroups([added(1, T, "A")], { only: null, limit: 25, now: T });
        expect(shape(rows)).toEqual(["day Today", "head A"]);
        expect(rows[1]).toMatchObject({ added: "09:05" });
    });

    it("heads each note with its first sentence and keeps the whole body to expand", () => {
        const body = "First. " + "x".repeat(1200);
        const { rows } = feedGroups([entry(0, T, "A", { text: body })], { only: null, limit: 25, now: T });
        expect(rows[2]).toMatchObject({ kind: "note", head: "First.", body, mark: null });
    });

    it("carries the chunk's status on its heading, a removed chunk reading as skipped", () => {
        const { rows } = feedGroups([entry(0, T, "A", { status: "removed" })], { only: null, limit: 25, now: T });
        expect(rows[1]).toMatchObject({ kind: "head", chunk: "A", status: "removed", tone: "skipped", added: "" });
    });
});

describe("feedNoteCounts", () => {
    it("counts only the entries that carry text, per chunk", () => {
        const counts = feedNoteCounts([entry(2, T, "A"), added(1, T, "A"), entry(0, T, "B")]);
        expect([counts.get("A"), counts.get("B"), counts.get("C")]).toEqual([1, 1, undefined]);
    });
});

describe("kilo", () => {
    it("shortens a count past a thousand to one decimal", () => {
        expect([kilo(950), kilo(1740)]).toEqual(["950", "1.7k"]);
    });
});

describe("effortFeed noteAt", () => {
    const effort = {
        oid: "e",
        chunks: [
            {
                label: "A",
                status: "active",
                notes: [
                    { ts: 10, text: "marked active" },
                    { ts: 20, text: "a real note", edited: true },
                ],
            },
        ],
        events: [
            { ts: 10, kind: "chunk-status", label: "A", text: "" },
            { ts: 20, kind: "effort-note", label: "A", text: "a real note" },
        ],
    } as unknown as Effort;

    it("gives an effort-note its 1-based place in the chunk's trail, and carries edited", () => {
        const note = effortFeed(effort).find((e) => e.kind === "effort-note");
        expect(note?.noteAt).toBe(2);
        expect(note?.edited).toBe(true);
    });
    it("leaves status entries without noteAt, so they stay read-only", () => {
        const status = effortFeed(effort).find((e) => e.kind === "chunk-status");
        expect(status?.noteAt).toBeUndefined();
    });
});

describe("effortFeed locating", () => {
    const bySeq = (e: Effort) => Object.fromEntries(effortFeed(e).map((x) => [x.seq, x]));

    it("picks among same-instant status notes by the text the event carries, an empty one taking the bare note", () => {
        const e = effort(
            [
                {
                    label: "A",
                    status: "done",
                    notes: [
                        { ts: T, text: "marked done · alpha", author: "x" },
                        { ts: T, text: "marked done · beta", author: "y" },
                        { ts: T, text: "marked done", author: "z" },
                    ],
                },
            ],
            [
                { ts: T, kind: "chunk-done", label: "A", text: "beta" },
                { ts: T, kind: "chunk-done", label: "A", text: "" },
                { ts: T, kind: "chunk-done", label: "A", text: "alpha" },
            ]
        );
        const feed = bySeq(e);
        expect([feed[0].author, feed[1].author, feed[2].author]).toEqual(["y", "z", "x"]);
        expect([feed[0].text, feed[1].text, feed[2].text]).toEqual(["beta", "", "alpha"]);
    });

    it("leaves a status event unlocated when several notes share its instant and none carries its text", () => {
        const e = effort(
            [
                {
                    label: "A",
                    status: "done",
                    notes: [
                        { ts: T, text: "marked done · alpha", author: "x" },
                        { ts: T, text: "marked done · beta", author: "y" },
                    ],
                },
            ],
            [{ ts: T, kind: "chunk-done", label: "A", text: "gamma" }]
        );
        const [entry] = effortFeed(e);
        expect(entry.author).toBeUndefined();
        expect([entry.chunk, entry.marked, entry.text]).toEqual(["A", "marked done", "gamma"]);
    });

    it("gives two identical notes of one instant to two events, never the same note twice", () => {
        const e = effort(
            [
                {
                    label: "A",
                    notes: [
                        { ts: T, text: "x" },
                        { ts: T, text: "x" },
                    ],
                },
            ],
            [
                { ts: T, kind: "effort-note", label: "A", text: "x" },
                { ts: T, kind: "effort-note", label: "A", text: "x" },
            ]
        );
        const feed = bySeq(e);
        expect([feed[0].noteAt, feed[1].noteAt]).toEqual([1, 2]);
    });

    it("locates an effort-note only by a note of the same instant that says the same thing", () => {
        const e = effort(
            [
                {
                    label: "A",
                    notes: [
                        { ts: T + 1, text: "x" },
                        { ts: T, text: "y" },
                    ],
                },
            ],
            [{ ts: T, kind: "effort-note", label: "A", text: "x" }]
        );
        const [entry] = effortFeed(e);
        expect(entry).toEqual({
            seq: 0,
            ts: T,
            kind: "effort-note",
            chunk: "A",
            status: "pending",
            marked: "",
            text: "x",
        });
    });

    it("locates a status event only by a status note, not by a free note of the same instant", () => {
        const e = effort(
            [{ label: "A", status: "active", notes: [{ ts: T, text: "plain note", author: "z" }] }],
            [{ ts: T, kind: "chunk-status", label: "A", text: "" }]
        );
        const [entry] = effortFeed(e);
        expect(entry.author).toBeUndefined();
        expect([entry.marked, entry.text]).toEqual(["status changed", ""]);
    });

    it("words a status change by the status its note records, and by its kind when no note is found", () => {
        const e = effort(
            [{ label: "A", status: "active", notes: [{ ts: T, text: "marked active · started" }] }],
            [
                { ts: T, kind: "chunk-status", label: "A", text: "" },
                { ts: T + 1, kind: "chunk-status", label: "A", text: "" },
                { ts: T + 2, kind: "chunk-done", label: "A", text: "" },
            ]
        );
        const feed = bySeq(e);
        expect([feed[0].marked, feed[0].text]).toEqual(["marked active", "started"]);
        expect([feed[1].marked, feed[1].text]).toEqual(["status changed", ""]);
        expect([feed[2].marked, feed[2].text]).toEqual(["marked done", ""]);
    });

    it("never reads a free effort-note as a status change, even when it starts with the same words", () => {
        const e = effort(
            [{ label: "A", notes: [{ ts: T, text: "marked done" }] }],
            [{ ts: T, kind: "effort-note", label: "A", text: "marked done" }]
        );
        const [entry] = effortFeed(e);
        expect([entry.marked, entry.text, entry.noteAt]).toEqual(["", "marked done", 1]);
    });

    it("leaves a chunk added from taking the note a later status event is waiting for", () => {
        const e = effort(
            [{ label: "A", status: "done", notes: [{ ts: T, text: "marked done · landed" }] }],
            [
                { ts: T, kind: "chunk-added", label: "A" },
                { ts: T, kind: "chunk-done", label: "A", text: "" },
            ]
        );
        const feed = bySeq(e);
        expect([feed[0].marked, feed[0].text]).toEqual(["chunk added", ""]);
        expect([feed[1].marked, feed[1].text]).toEqual(["marked done", "landed"]);
    });

    it("reads a chunk added's status off the chunk that still holds its label", () => {
        const e = effort([{ label: "A", status: "active" }], [{ ts: T, kind: "chunk-added", label: "A" }]);
        const [entry] = effortFeed(e);
        expect([entry.chunk, entry.status]).toEqual(["A", "active"]);
    });

    it("follows only a rename note to a chunk whose label is gone, never another chunk's note", () => {
        const e = effort(
            [{ label: "B", notes: [{ ts: T, text: "unrelated" }] }],
            [{ ts: T, kind: "chunk-added", label: "gone" }]
        );
        const [entry] = effortFeed(e);
        expect([entry.chunk, entry.status]).toEqual(["gone", "removed"]);
    });

    it("calls a chunk removed only when the event named it by its index alone", () => {
        const e = effort(
            [],
            ["12", "3", "v2", "2nd phase"].map((label, i) => ({ ts: T + i, kind: "effort-note", label }))
        );
        expect(effortFeed(e).map((x) => x.chunk)).toEqual(["2nd phase", "v2", "removed chunk", "removed chunk"]);
    });

    it("orders by time, newest first, whatever order the events were appended in", () => {
        const e = effort(
            [],
            [
                { ts: T + 2, kind: "effort-note", label: "A", text: "second" },
                { ts: T, kind: "effort-note", label: "A", text: "first" },
                { ts: T + 1, kind: "effort-note", label: "A", text: "middle" },
                { ts: T + 1, kind: "effort-note", label: "A", text: "later in the same instant" },
            ]
        );
        expect(effortFeed(e).map((x) => x.text)).toEqual(["second", "later in the same instant", "middle", "first"]);
    });
});
