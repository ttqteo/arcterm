// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { doneSuggestion } from "./donesuggest";

describe("doneSuggestion", () => {
    const done = { id: "a1", state: "idle" as const, committed: true };
    const none = {};

    it("offers Close on an idle agent whose read last turn committed", () => {
        expect(doneSuggestion(done, 0, none)).toBe(true);
    });

    it("waits until you have read the turn", () => {
        expect(doneSuggestion(done, 1, none)).toBe(false);
    });

    it("needs a commit", () => {
        expect(doneSuggestion({ id: "a1", state: "idle" }, 0, none)).toBe(false);
        expect(doneSuggestion({ id: "a1", state: "idle", committed: false }, 0, none)).toBe(false);
    });

    it("never offers it to a working or asking agent", () => {
        expect(doneSuggestion({ ...done, state: "working" }, 0, none)).toBe(false);
        expect(doneSuggestion({ ...done, state: "asking" }, 0, none)).toBe(false);
    });

    it("not while a part waits on your reply", () => {
        expect(doneSuggestion({ ...done, step: "2/4" }, 0, none)).toBe(false);
    });

    it("leaves a run's sessions to the engine", () => {
        expect(doneSuggestion({ ...done, runId: "85548d0b" }, 0, none)).toBe(false);
    });

    // its last turn committed a plan and handed it to `wsh runs start`: the work goes on in that run
    it("not while a run it started is still going", () => {
        expect(doneSuggestion(done, 0, { r1: { originId: "a1", status: "running" } })).toBe(false);
        expect(doneSuggestion(done, 0, { r1: { originId: "a1", dag: { status: "running" } as TaskGroup } })).toBe(
            false
        );
    });

    it("offers it again once that run has ended, and ignores runs another agent started", () => {
        expect(doneSuggestion(done, 0, { r1: { originId: "a1", status: "done" } })).toBe(true);
        expect(doneSuggestion(done, 0, { r1: { originId: "a1", status: "cancelled" } })).toBe(true);
        expect(doneSuggestion(done, 0, { r1: { originId: "a2", status: "running" } })).toBe(true);
    });
});
