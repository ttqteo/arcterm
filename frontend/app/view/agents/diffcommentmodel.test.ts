// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { commentableSide, draftTitle, rangeLabel, removedOnlyHunks, selectedLines } from "./diffcommentmodel";

describe("a comment's range label", () => {
    it("names one line in the singular", () => {
        expect(rangeLabel("modified", 4, 4)).toBe("Line 4");
    });

    it("names a range with an en dash", () => {
        expect(rangeLabel("modified", 7, 9)).toBe("Lines 7–9");
    });

    it("names the left side's lines as removed", () => {
        expect(rangeLabel("original", 1, 3)).toBe("Removed lines 1–3");
        expect(rangeLabel("original", 2, 2)).toBe("Removed line 2");
    });
});

describe("the draft card's title", () => {
    it("reads Comment on, then the range in lower case", () => {
        expect(draftTitle("modified", 3, 3)).toBe("Comment on line 3");
        expect(draftTitle("modified", 7, 9)).toBe("Comment on lines 7–9");
        expect(draftTitle("original", 1, 3)).toBe("Comment on removed lines 1–3");
    });
});

describe("removed-only hunks", () => {
    it("hangs the hint under the modified line a pure deletion follows", () => {
        expect(
            removedOnlyHunks([
                { modifiedStartLineNumber: 0, modifiedEndLineNumber: 0 },
                { modifiedStartLineNumber: 12, modifiedEndLineNumber: 0 },
            ])
        ).toEqual([0, 12]);
    });

    // a mixed hunk's added side takes the comment, so it gets no hint
    it("ignores hunks with added lines", () => {
        expect(
            removedOnlyHunks([
                { modifiedStartLineNumber: 4, modifiedEndLineNumber: 4 },
                { modifiedStartLineNumber: 7, modifiedEndLineNumber: 9 },
            ])
        ).toEqual([]);
    });

    // Monaco pairs a deleted file's removed lines with the empty file's one blank line, which it marks added
    it("hangs the hint at the top of a deleted file", () => {
        expect(removedOnlyHunks([{ modifiedStartLineNumber: 1, modifiedEndLineNumber: 1 }], true)).toEqual([0]);
    });
});

describe("which side takes a comment", () => {
    it("takes the right side in both views", () => {
        expect(commentableSide("modified", false)).toBe(true);
        expect(commentableSide("modified", true)).toBe(true);
    });

    // unified view draws removed lines as zones with no gutter, selection or editor of their own
    it("takes the left side only in split view", () => {
        expect(commentableSide("original", false)).toBe(false);
        expect(commentableSide("original", true)).toBe(true);
    });
});

describe("the lines a selection names", () => {
    const sel = (startLineNumber: number, startColumn: number, endLineNumber: number, endColumn: number) => ({
        startLineNumber,
        startColumn,
        endLineNumber,
        endColumn,
    });

    it("is the cursor's line when nothing is selected", () => {
        expect(selectedLines(sel(5, 3, 5, 3))).toEqual({ start: 5, end: 5 });
    });

    it("spans the selected lines", () => {
        expect(selectedLines(sel(7, 1, 9, 2))).toEqual({ start: 7, end: 9 });
    });

    // a whole-line selection (a drag down the gutter) ends at column 1 of the line after it
    it("drops a last line the selection only touches at its start", () => {
        expect(selectedLines(sel(7, 1, 10, 1))).toEqual({ start: 7, end: 9 });
    });
});
