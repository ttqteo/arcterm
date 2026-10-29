// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import type { AgentEntry } from "./agentsviewmodel";
import {
    APPEND_INTERVAL_MS,
    appendLines,
    appendThrottle,
    compactionStep,
    firstWindow,
    keyOffsetAfter,
    prependChunk,
    shouldStream,
    showsCompactions,
    type LoadedWindow,
} from "./railtranscriptmodel";

const win = (over: Partial<LoadedWindow> = {}): LoadedWindow => ({
    lines: ["l10", "l11", "l12"],
    start: 10,
    total: 13,
    end: 130,
    ...over,
});

describe("firstWindow", () => {
    it("takes the answer's lines, start, total and end", () => {
        expect(firstWindow({ lines: ["a", "b"], start: 4, total: 6, end: 60 })).toEqual({
            lines: ["a", "b"],
            start: 4,
            total: 6,
            end: 60,
        });
    });

    it("drops a half-written last line and keeps the end the answer put before it", () => {
        const w = firstWindow({ lines: ["a", "b", '{"half'], start: 0, total: 3, end: 40, partial: true });
        expect(w.lines).toEqual(["a", "b"]);
        expect(w.end).toBe(40);
        expect(w.start).toBe(0);
    });

    it("leaves nothing when the only line is half written", () => {
        expect(firstWindow({ lines: ['{"half'], start: 0, total: 1, end: 0, partial: true }).lines).toEqual([]);
    });

    it("keeps every line when partial is false or absent", () => {
        expect(firstWindow({ lines: ["a"], start: 0, total: 1, end: 2, partial: false }).lines).toEqual(["a"]);
        expect(firstWindow({ lines: ["a"], start: 0, total: 1, end: 2 }).lines).toEqual(["a"]);
    });

    it("does not hand back the answer's own array", () => {
        const lines = ["a", "b"];
        const w = firstWindow({ lines, start: 0, total: 2, end: 4 });
        expect(w.lines).not.toBe(lines);
    });
});

describe("prependChunk", () => {
    it("puts a chunk that ends where the window starts in front of it", () => {
        const w = prependChunk(win(), { lines: ["l8", "l9"], start: 8, total: 13, end: 130 });
        expect(w).toEqual({ lines: ["l8", "l9", "l10", "l11", "l12"], start: 8, total: 13, end: 130 });
    });

    it("keeps the window's end and total, whatever the before answer says of them", () => {
        const w = prependChunk(win({ total: 40, end: 400 }), { lines: ["l9"], start: 9, total: 12, end: 99 });
        expect(w).toEqual({ lines: ["l9", "l10", "l11", "l12"], start: 9, total: 40, end: 400 });
    });

    it("rereads when the chunk ends before the window starts (a gap)", () => {
        expect(prependChunk(win(), { lines: ["l6", "l7"], start: 6, total: 13, end: 130 })).toBe("reread");
    });

    it("rereads when the chunk runs past the window's start (an overlap)", () => {
        expect(prependChunk(win(), { lines: ["l9", "l10"], start: 9, total: 13, end: 130 })).toBe("reread");
    });

    it("rereads on an empty chunk that does not sit at the window's start", () => {
        expect(prependChunk(win(), { lines: [], start: 4, total: 13, end: 130 })).toBe("reread");
    });

    it("reaches the start of the file", () => {
        const w = prependChunk(win({ start: 2, lines: ["l2"] }), {
            lines: ["l0", "l1"],
            start: 0,
            total: 13,
            end: 130,
        });
        expect(w).toEqual({ lines: ["l0", "l1", "l2"], start: 0, total: 13, end: 130 });
    });

    it("leaves the window it was given alone", () => {
        const before = win();
        prependChunk(before, { lines: ["l9"], start: 9, total: 13, end: 130 });
        expect(before).toEqual(win());
    });
});

describe("appendLines", () => {
    it("adds the new lines after the window and moves its end", () => {
        const w = appendLines(win(), { lines: ["l13", "l14"], end: 170 });
        expect(w).toEqual({ lines: ["l10", "l11", "l12", "l13", "l14"], start: 10, total: 15, end: 170 });
    });

    it("rereads on a reset, whatever else the answer holds", () => {
        expect(appendLines(win(), { lines: [], end: 0, reset: true })).toBe("reread");
        expect(appendLines(win(), { lines: ["x"], end: 5, reset: true })).toBe("reread");
    });

    it("hands back the same window when nothing is new", () => {
        const w = win();
        expect(appendLines(w, { lines: [], end: w.end })).toBe(w);
    });

    it("moves the end past lines it dropped as empty", () => {
        expect(appendLines(win(), { lines: [], end: 140 })).toEqual({ ...win(), end: 140 });
    });

    it("keeps a total that already reaches past the lines held", () => {
        // the first read counted a half-written line the window dropped; the append returns it whole
        const w = appendLines(win({ total: 14 }), { lines: ["l13"], end: 150 });
        expect(w).toEqual({ lines: ["l10", "l11", "l12", "l13"], start: 10, total: 14, end: 150 });
    });

    it("leaves the window it was given alone", () => {
        const before = win();
        appendLines(before, { lines: ["l13"], end: 150 });
        expect(before).toEqual(win());
    });
});

describe("keyOffsetAfter", () => {
    it("adds the entries a load put in front", () => {
        expect(keyOffsetAfter(0, 120, 150)).toBe(30);
        expect(keyOffsetAfter(30, 150, 190)).toBe(70);
    });

    it("keeps the offset when the load added no entries", () => {
        expect(keyOffsetAfter(30, 150, 150)).toBe(30);
    });
});

const msg = (text: string): AgentEntry => ({ kind: "message", text });
const compaction = (summary?: string): AgentEntry => ({ kind: "compaction", summary });

describe("showsCompactions", () => {
    it("shows when a compaction is loaded", () => {
        expect(showsCompactions([msg("a"), compaction(), msg("b")], { start: 0 })).toBe(true);
    });

    it("shows when the loaded part does not start the file, with no compaction in it", () => {
        expect(showsCompactions([msg("a")], { start: 2000 })).toBe(true);
    });

    it("stays hidden with no compaction loaded and the whole file from its start", () => {
        expect(showsCompactions([msg("a"), msg("b")], { start: 0 })).toBe(false);
        expect(showsCompactions([], { start: 0 })).toBe(false);
    });
});

describe("compactionStep", () => {
    // 0 msg, 1 compaction, 2 msg, 3 msg, 4 compaction, 5 msg
    const entries = [msg("a"), compaction("old"), msg("b"), msg("c"), compaction("new"), msg("d")];

    it("goes to the newest marker first", () => {
        expect(compactionStep(entries, null, false)).toBe(4);
        expect(compactionStep(entries, null, true)).toBe(4);
    });

    it("steps from the marker last shown to the next older one loaded", () => {
        expect(compactionStep(entries, 4, false)).toBe(1);
    });

    it("loads an earlier chunk when no older marker is loaded and the start is not reached", () => {
        expect(compactionStep(entries, 1, false)).toBe("load-earlier");
    });

    it("says none are left when no older marker is loaded and the start is reached", () => {
        expect(compactionStep(entries, 1, true)).toBe("none-left");
    });

    it("loads earlier on the first press when no compaction is loaded yet and the start is not reached", () => {
        expect(compactionStep([msg("a"), msg("b")], null, false)).toBe("load-earlier");
    });

    it("says none are left on the first press with no compaction in a window from the start", () => {
        expect(compactionStep([msg("a")], null, true)).toBe("none-left");
        expect(compactionStep([], null, true)).toBe("none-left");
    });

    it("finds a marker at the very first entry", () => {
        expect(compactionStep([compaction(), msg("a")], null, false)).toBe(0);
        expect(compactionStep([compaction(), msg("a")], 0, true)).toBe("none-left");
    });

    it("steps from a shifted index after a load put entries in front", () => {
        // an earlier chunk of 2 entries (one a marker) lands in front: the marker last shown at 1 is now at 3
        const loaded = [msg("x"), compaction("older"), ...entries];
        expect(compactionStep(loaded, 1 + 2, false)).toBe(1);
        expect(compactionStep(loaded, 1, true)).toBe("none-left");
    });
});

describe("appendThrottle", () => {
    it("reads at once before any read, or once the interval has passed", () => {
        expect(appendThrottle({ lastReadAt: null, inFlight: false, now: 1000 })).toEqual({ do: "read" });
        expect(appendThrottle({ lastReadAt: 1000, inFlight: false, now: 1000 + APPEND_INTERVAL_MS })).toEqual({
            do: "read",
        });
        expect(appendThrottle({ lastReadAt: 1000, inFlight: false, now: 9000 })).toEqual({ do: "read" });
    });

    it("schedules a trailing read at the end of the interval when a stamp comes inside it", () => {
        expect(appendThrottle({ lastReadAt: 1000, inFlight: false, now: 1001 })).toEqual({ do: "later", at: 4000 });
        expect(appendThrottle({ lastReadAt: 1000, inFlight: false, now: 3999 })).toEqual({ do: "later", at: 4000 });
    });

    it("waits while a read is in flight, inside the interval or past it, even with no read before", () => {
        expect(appendThrottle({ lastReadAt: 1000, inFlight: true, now: 1500 })).toEqual({ do: "wait" });
        expect(appendThrottle({ lastReadAt: 1000, inFlight: true, now: 9000 })).toEqual({ do: "wait" });
        expect(appendThrottle({ lastReadAt: null, inFlight: true, now: 9000 })).toEqual({ do: "wait" });
    });

    it("reads when the trailing timer fires at its time", () => {
        const first = appendThrottle({ lastReadAt: 1000, inFlight: false, now: 2000 });
        expect(first).toEqual({ do: "later", at: 4000 });
        expect(appendThrottle({ lastReadAt: 1000, inFlight: false, now: 4000 })).toEqual({ do: "read" });
    });
});

describe("shouldStream", () => {
    const on = { surface: "agent", railOpen: true, shownTab: "transcript" };

    it("streams on the Agent surface with the rail open on Transcript", () => {
        expect(shouldStream(on)).toBe(true);
    });

    it("does not stream on another surface", () => {
        expect(shouldStream({ ...on, surface: "cockpit" })).toBe(false);
        expect(shouldStream({ ...on, surface: "code" })).toBe(false);
    });

    it("does not stream with the rail closed", () => {
        expect(shouldStream({ ...on, railOpen: false })).toBe(false);
    });

    it("does not stream while another tab is shown", () => {
        expect(shouldStream({ ...on, shownTab: "overview" })).toBe(false);
        expect(shouldStream({ ...on, shownTab: "file" })).toBe(false);
    });
});
