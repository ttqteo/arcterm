// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import type { AgentEntry } from "./agentsviewmodel";
import { findPosLabel, transcriptMatches } from "./transcriptfind";

const user = (text: string): AgentEntry => ({ kind: "user", text });
const message = (text: string): AgentEntry => ({ kind: "message", text });
const action: AgentEntry = { kind: "action", verb: "Read", target: "needle.ts" } as AgentEntry;

describe("transcriptMatches", () => {
    it("lists every match over the prompts and replies, in transcript order, as an entry and its nth match", () => {
        const entries = [
            user("find the needle"),
            message("a needle, and another needle"),
            user("no hit"),
            message("Needle"),
        ];
        expect(transcriptMatches(entries, ["needle"])).toEqual([
            { entry: 0, nth: 0 },
            { entry: 1, nth: 0 },
            { entry: 1, nth: 1 },
            { entry: 3, nth: 0 },
        ]);
    });

    it("leaves out what is neither a prompt nor a reply, however much it says the term", () => {
        const entries = [action, { kind: "command", name: "needle" } as AgentEntry, message("one needle")];
        expect(transcriptMatches(entries, ["needle"])).toEqual([{ entry: 2, nth: 0 }]);
    });

    it("counts a text's matches the way the Go matcher does: every term, overlapping ranges merged", () => {
        // "ab" and "bc" overlap in "abc": one merged range, so one hit
        expect(transcriptMatches([message("abc x abc")], ["ab", "bc"])).toEqual([
            { entry: 0, nth: 0 },
            { entry: 0, nth: 1 },
        ]);
        // two terms in different places are two
        expect(transcriptMatches([message("foo bar")], ["foo", "bar"])).toHaveLength(2);
    });

    it("matches a quoted phrase as one term", () => {
        expect(transcriptMatches([message("one two, two one")], ["one two"])).toEqual([{ entry: 0, nth: 0 }]);
    });

    it("finds nothing without terms or without a match", () => {
        expect(transcriptMatches([message("needle")], [])).toEqual([]);
        expect(transcriptMatches([message("hay")], ["needle"])).toEqual([]);
        expect(transcriptMatches([], ["needle"])).toEqual([]);
    });
});

describe("findPosLabel", () => {
    it("reads 'N / total' from one", () => {
        expect(findPosLabel(0, 7)).toBe("1 / 7");
        expect(findPosLabel(1, 7)).toBe("2 / 7");
    });

    it("says no matches at zero", () => {
        expect(findPosLabel(0, 0)).toBe("No matches");
    });

    it("says nothing while the transcript is still loading", () => {
        expect(findPosLabel(0, null)).toBe("");
    });
});
