// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { fuzzyMatch, fuzzyScore, highlightRuns, rankPaletteItems } from "./palette-match";

describe("fuzzyScore", () => {
    it("returns null when query chars are not a subsequence", () => {
        expect(fuzzyScore("xyz", "New agent")).toBeNull();
    });
    it("matches a gapped subsequence", () => {
        expect(fuzzyScore("nag", "New agent")).not.toBeNull();
    });
    it("is case-insensitive", () => {
        expect(fuzzyScore("NEW", "new agent")).not.toBeNull();
    });
    it("empty query scores 0 (not null)", () => {
        expect(fuzzyScore("", "anything")).toBe(0);
    });
    it("scores a contiguous run higher than a gapped one", () => {
        const contiguous = fuzzyScore("abc", "abcxyz")!;
        const gapped = fuzzyScore("abc", "axbxcx")!;
        expect(contiguous).toBeGreaterThan(gapped);
    });
});

describe("rankPaletteItems", () => {
    const items = [
        { search: "Profile" },
        { search: "Go to Files" },
        { search: "axbxcx" },
        { search: "abcxyz" },
    ];

    it("passes items through unchanged for an empty query", () => {
        expect(rankPaletteItems(items, "").map((i) => i.search)).toEqual(items.map((i) => i.search));
    });
    it("drops non-matches", () => {
        expect(rankPaletteItems(items, "zzz")).toEqual([]);
    });
    it("ranks a word-boundary match above a mid-word match", () => {
        // "file" starts a word in "Go to Files" but is mid-word in "Profile"
        const ranked = rankPaletteItems(items, "file").map((i) => i.search);
        expect(ranked[0]).toBe("Go to Files");
    });
    it("ranks a contiguous match above a gapped match", () => {
        const ranked = rankPaletteItems(items, "abc").map((i) => i.search);
        expect(ranked.indexOf("abcxyz")).toBeLessThan(ranked.indexOf("axbxcx"));
    });
});

describe("fuzzyMatch", () => {
    it("returns the matched indices in ascending order", () => {
        // "new agent": n@0, a@4, g@5
        expect(fuzzyMatch("nag", "New agent")!.positions).toEqual([0, 4, 5]);
    });
    it("returns score 0 and no positions for an empty query", () => {
        expect(fuzzyMatch("", "anything")).toEqual({ score: 0, positions: [] });
    });
    it("returns null when the query is not a subsequence", () => {
        expect(fuzzyMatch("xyz", "New agent")).toBeNull();
    });
    it("treats a whitespace-only query as empty and ignores whitespace around a real one", () => {
        expect(fuzzyMatch("   ", "a b c")).toStrictEqual({ score: 0, positions: [] });
        expect(fuzzyMatch("  nag ", "New agent")!.positions).toEqual([0, 4, 5]);
    });
    it("scores a lone character by its match and word start, with no gap to penalize", () => {
        // 1 for the match; 'a' mid-word earns no boundary bonus and there is no previous match to gap from
        expect(fuzzyMatch("a", "xxa")!.score).toBe(1);
        expect(fuzzyMatch("a", "xxa")!.positions).toEqual([2]);
    });
    it("penalizes a gap after a match at the very start of the text", () => {
        // a@0: 1 + 3 (word start); b@2: 1, minus a gap of 1
        expect(fuzzyScore("ab", "axb")).toBe(4);
    });
    it("penalizes a gap by its width up to a cap", () => {
        // a gap of 5 costs the cap of 3, not 5: 4 + 1 - 3
        expect(fuzzyScore("ab", "axxxxxb")).toBe(2);
    });
    it("agrees with fuzzyScore", () => {
        expect(fuzzyMatch("nag", "New agent")!.score).toBe(fuzzyScore("nag", "New agent"));
    });
});

describe("highlightRuns", () => {
    it("splits text into alternating hit and miss runs", () => {
        expect(highlightRuns("New agent", [0, 4, 5])).toEqual([
            { text: "N", hit: true },
            { text: "ew ", hit: false },
            { text: "ag", hit: true },
            { text: "ent", hit: false },
        ]);
    });
    it("returns a single miss run when there are no positions", () => {
        expect(highlightRuns("New agent", [])).toEqual([{ text: "New agent", hit: false }]);
    });
    it("returns [] for empty text", () => {
        expect(highlightRuns("", [0])).toEqual([]);
    });
});
