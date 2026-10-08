// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { doneSuggestion } from "./donesuggest";

describe("doneSuggestion", () => {
    const done = { state: "idle" as const, committed: true };

    it("offers Close on an idle agent whose read last turn committed", () => {
        expect(doneSuggestion(done, 0)).toBe(true);
    });

    it("waits until you have read the turn", () => {
        expect(doneSuggestion(done, 1)).toBe(false);
    });

    it("needs a commit", () => {
        expect(doneSuggestion({ state: "idle" }, 0)).toBe(false);
        expect(doneSuggestion({ state: "idle", committed: false }, 0)).toBe(false);
    });

    it("never offers it to a working or asking agent", () => {
        expect(doneSuggestion({ ...done, state: "working" }, 0)).toBe(false);
        expect(doneSuggestion({ ...done, state: "asking" }, 0)).toBe(false);
    });

    it("not while a part waits on your reply", () => {
        expect(doneSuggestion({ ...done, step: "2/4" }, 0)).toBe(false);
    });

    it("leaves a run's sessions to the engine", () => {
        expect(doneSuggestion({ ...done, runId: "85548d0b" }, 0)).toBe(false);
    });
});
