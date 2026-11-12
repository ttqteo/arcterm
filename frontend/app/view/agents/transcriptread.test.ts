// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import type { LoadedWindow } from "./railtranscriptmodel";
import { TAIL_LINES, transcriptAsk, windowAfter } from "./transcriptread";

const lines = (from: number, n: number) => Array.from({ length: n }, (_, i) => `l${from + i}`);

// the tail a first read answers with: lines 6400..8399 of an 8400-line file
const tailAnswer = (over: Partial<CommandGetAgentTranscriptRtnData> = {}): CommandGetAgentTranscriptRtnData => ({
    lines: lines(6400, TAIL_LINES),
    start: 6400,
    total: 8400,
    end: 900_000,
    ...over,
});

const held = (over: Partial<LoadedWindow> = {}): LoadedWindow => ({
    lines: lines(6400, TAIL_LINES),
    start: 6400,
    total: 8400,
    end: 900_000,
    ...over,
});

describe("transcriptAsk", () => {
    it("asks for the tail while no window is held", () => {
        expect(transcriptAsk("/t.jsonl", "claude", null)).toEqual({ path: "/t.jsonl", maxlines: TAIL_LINES });
    });

    it("asks pi for the whole file, whose active branch needs every line", () => {
        expect(transcriptAsk("/t.jsonl", "pi", null)).toEqual({ path: "/t.jsonl", maxlines: -1 });
    });

    it("asks only for the bytes after the window's end once one is held", () => {
        expect(transcriptAsk("/t.jsonl", "claude", held())).toEqual({ path: "/t.jsonl", frombyte: 900_000 });
        expect(transcriptAsk("/t.jsonl", "pi", held())).toEqual({ path: "/t.jsonl", frombyte: 900_000 });
    });

    it("reads the tail again when the window holds no complete line to read on from", () => {
        // frombyte 0 means "no offset" to wavesrv, which would answer a tail the window would then mistake for an append
        expect(transcriptAsk("/t.jsonl", "claude", held({ lines: [], end: 0 }))).toEqual({
            path: "/t.jsonl",
            maxlines: TAIL_LINES,
        });
    });
});

describe("windowAfter", () => {
    it("takes the first read as the window", () => {
        const w = windowAfter(null, { path: "/t.jsonl", maxlines: TAIL_LINES }, tailAnswer());
        expect(w).toEqual(held());
    });

    it("drops the half-written last line of a first read, which the first append returns whole", () => {
        const w = windowAfter(
            null,
            { path: "/t.jsonl", maxlines: TAIL_LINES },
            tailAnswer({ lines: ["a", "b"], partial: true, end: 6 })
        );
        expect(w).toMatchObject({ lines: ["a"], end: 6 });
    });

    it("keeps the window's first line and adds the new ones on an append", () => {
        const before = held();
        const w = windowAfter(
            before,
            { path: "/t.jsonl", frombyte: before.end },
            { lines: lines(8400, 50), start: 0, total: 0, end: 905_000 }
        );
        expect(w).not.toBe("reread");
        const next = w as LoadedWindow;
        expect(next.lines[0]).toBe(before.lines[0]);
        expect(next.start).toBe(before.start);
        expect(next.lines).toHaveLength(TAIL_LINES + 50);
        expect(next.lines.slice(-50)).toEqual(lines(8400, 50));
        expect(next.end).toBe(905_000);
        // the window it grew from is left as it was
        expect(before.lines).toHaveLength(TAIL_LINES);
    });

    it("hands back the same window when the append found nothing new", () => {
        const before = held();
        expect(
            windowAfter(
                before,
                { path: "/t.jsonl", frombyte: before.end },
                { lines: [], start: 0, total: 0, end: before.end }
            )
        ).toBe(before);
    });

    it("asks for a reread when the file was replaced", () => {
        const before = held();
        expect(
            windowAfter(
                before,
                { path: "/t.jsonl", frombyte: before.end },
                { lines: [], start: 0, total: 0, end: 12, reset: true }
            )
        ).toBe("reread");
    });

    it("lets a tail read replace the window it was asked for in place of an append", () => {
        const before = held({ lines: [], end: 0 });
        const w = windowAfter(
            before,
            { path: "/t.jsonl", maxlines: TAIL_LINES },
            tailAnswer({ lines: ["x"], start: 0, total: 1, end: 3 })
        );
        expect(w).toEqual({ lines: ["x"], start: 0, total: 1, end: 3 });
    });
});
