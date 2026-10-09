// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { emptyDiffState, type EmptyDiffInput } from "./diffempty";

const pair = (
    over: Partial<{ binary: boolean; tooLarge: boolean; original: string; modified: string; size: number }> = {}
) => ({
    path: "a.ts",
    binary: false,
    tooLarge: false,
    original: "x",
    modified: "y",
    size: 0,
    ...over,
});

// a list that has loaded and holds files unless a case says otherwise
const input = (over: Partial<EmptyDiffInput> = {}): EmptyDiffInput => ({
    path: null,
    pair: null,
    nothingToCompare: null,
    listStatus: "ready",
    fileCount: 2,
    ...over,
});

describe("emptyDiffState", () => {
    it("says two refs that agree are an answer, not a blank", () => {
        expect(
            emptyDiffState(input({ nothingToCompare: { base: "main", head: "origin/main" }, fileCount: 0 }))
        ).toEqual({
            kind: "nothing",
            title: "Nothing to compare",
            body: "main and origin/main have no file differences.",
        });
    });
    it("asks for a file when none is selected", () => {
        expect(emptyDiffState(input())?.kind).toBe("nofile");
    });
    it("is null while the pair is still loading, so the pane shows its skeleton", () => {
        expect(emptyDiffState(input({ path: "a.ts" }))).toBeNull();
        expect(emptyDiffState(input({ path: "b.ts", pair: pair() }))).toBeNull();
    });
    it("names the 2 MB limit for a file too large to diff", () => {
        expect(emptyDiffState(input({ path: "a.ts", pair: pair({ tooLarge: true }) }))).toEqual({
            kind: "toolarge",
            title: "Too large to show here",
            body: "Diffs stop at 2 MB. Open it in Code to read the file.",
        });
    });
    it("explains a binary file", () => {
        expect(emptyDiffState(input({ path: "a.ts", pair: pair({ binary: true }) }))?.body).toBe(
            "Git records a change here, but there is no text to compare."
        );
    });
    it("explains a rename or mode change", () => {
        expect(emptyDiffState(input({ path: "a.ts", pair: pair({ original: "same", modified: "same" }) }))).toEqual({
            kind: "unchanged",
            title: "Contents unchanged",
            body: "Only the name or the file mode changed.",
        });
    });
    it("is null when there is a diff to draw", () => {
        expect(emptyDiffState(input({ path: "a.ts", pair: pair() }))).toBeNull();
    });

    describe("while the file list itself loads or fails", () => {
        it("is null with no path, so the pane shows its skeleton instead of 'Pick a file'", () => {
            expect(emptyDiffState(input({ listStatus: "loading", fileCount: null }))).toBeNull();
            expect(emptyDiffState(input({ listStatus: "loading", fileCount: 0 }))).toBeNull();
        });
        it("says the list failed", () => {
            const empty = emptyDiffState(input({ listStatus: "failed", fileCount: null }));
            expect(empty?.kind).toBe("listfailed");
            expect(empty?.title).toBe("Couldn't read the file list");
        });
        it("says a commit that lists no files changes none, instead of asking for a file", () => {
            expect(emptyDiffState(input({ fileCount: 0 }))).toEqual({
                kind: "nofiles",
                title: "This commit changes no files",
                body: "It may be a merge or an empty commit.",
            });
        });
        it("keeps asking for a file when there is no list to pick from", () => {
            expect(emptyDiffState(input({ fileCount: null }))?.kind).toBe("nofile");
        });
        it("never blanks a file that is already open", () => {
            expect(
                emptyDiffState(input({ path: "a.ts", pair: pair(), listStatus: "loading", fileCount: null }))
            ).toBeNull();
        });
    });
});
