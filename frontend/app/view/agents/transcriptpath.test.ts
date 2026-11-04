// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { sameTranscript } from "./transcriptpath";

describe("sameTranscript", () => {
    it("matches one path written either way", () => {
        expect(sameTranscript("C:\\T\\a.jsonl", "c:/t/A.jsonl")).toBe(true);
    });

    it("matches a session synced from another computer by its file name", () => {
        expect(
            sameTranscript(
                "/Users/me/.claude/projects/-Users-me-thesis/953f36b0-6a49.jsonl",
                "C:\\Users\\me\\.claude\\projects\\d--thesis\\953f36b0-6a49.jsonl"
            )
        ).toBe(true);
    });

    it("tells two sessions apart, and never matches an empty path", () => {
        expect(sameTranscript("/t/a.jsonl", "/t/b.jsonl")).toBe(false);
        expect(sameTranscript("", "")).toBe(false);
        expect(sameTranscript("/t/a.jsonl", "")).toBe(false);
    });
});
