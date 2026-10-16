// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { CUE_IDS, freqOf, line, SCORES, scoreSeconds, TRACKS, UI_CUES } from "./officescores";

describe("officescores", () => {
    it("turns a note name into its frequency", () => {
        expect(freqOf("A4")).toBe(440);
        expect(freqOf("C4")).toBeCloseTo(261.63, 1);
        expect(freqOf("A#4")).toBeCloseTo(466.16, 1);
        expect(() => freqOf("H4")).toThrow();
    });

    it("reads a line of name/length tokens, rests leaving a gap", () => {
        const notes = line("sq1", "C5/2 r/1 E5/1", { vol: 0.5 });
        expect(notes.map((n) => [n.at, n.len])).toEqual([
            [0, 2],
            [3, 1],
        ]);
        expect(notes[0]).toMatchObject({ ch: "sq1", vol: 0.5, duty: 0.5 });
        expect(line("noise", "N/1")[0].freq).toBe(0);
    });

    it("keeps every jingle short and every note sound", () => {
        for (const id of [...CUE_IDS, ...UI_CUES]) {
            const s = SCORES[id];
            expect(s.loop).toBe(false);
            expect(scoreSeconds(s)).toBeLessThanOrEqual(2.5);
            for (const n of s.notes) {
                expect(n.len).toBeGreaterThan(0);
                expect(n.ch === "noise" ? n.freq === 0 : n.freq > 20).toBe(true);
            }
        }
    });

    it("closes every loop on a whole bar, each channel filling it", () => {
        for (const id of TRACKS) {
            const s = SCORES[id];
            expect(s.loop).toBe(true);
            expect(s.length % 16).toBe(0);
            for (const ch of new Set(s.notes.map((n) => n.ch))) {
                const end = Math.max(...s.notes.filter((n) => n.ch === ch).map((n) => n.at + n.len));
                expect(end).toBe(s.length);
            }
        }
    });
});
