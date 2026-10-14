// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { doneSuggestion } from "./donesuggest";

describe("doneSuggestion", () => {
    const done = { id: "a1", state: "idle" as const, committed: true };
    const none = {};
    const noQueue: RunQueueEntry[] = [];

    it("offers Close on an idle agent whose read last turn committed", () => {
        expect(doneSuggestion(done, 0, none, 0, noQueue)).toBe(true);
    });

    it("waits until you have read the turn", () => {
        expect(doneSuggestion(done, 1, none, 0, noQueue)).toBe(false);
    });

    it("needs a commit", () => {
        expect(doneSuggestion({ id: "a1", state: "idle" }, 0, none, 0, noQueue)).toBe(false);
        expect(doneSuggestion({ id: "a1", state: "idle", committed: false }, 0, none, 0, noQueue)).toBe(false);
    });

    it("never offers it to a working or asking agent", () => {
        expect(doneSuggestion({ ...done, state: "working" }, 0, none, 0, noQueue)).toBe(false);
        expect(doneSuggestion({ ...done, state: "asking" }, 0, none, 0, noQueue)).toBe(false);
    });

    it("not while a part waits on your reply", () => {
        expect(doneSuggestion({ ...done, step: "2/4" }, 0, none, 0, noQueue)).toBe(false);
    });

    it("leaves a run's sessions to the engine", () => {
        expect(doneSuggestion({ ...done, runId: "85548d0b" }, 0, none, 0, noQueue)).toBe(false);
    });

    // its last turn committed a plan and handed it to `wsh runs start`: the work goes on in that run
    it("not while a run it started is still going", () => {
        expect(doneSuggestion(done, 0, { r1: { originId: "a1", status: "running" } }, 0, noQueue)).toBe(false);
        expect(
            doneSuggestion(done, 0, { r1: { originId: "a1", dag: { status: "running" } as TaskGroup } }, 0, noQueue)
        ).toBe(false);
    });

    it("offers it again once that run has ended, and ignores runs another agent started", () => {
        expect(doneSuggestion(done, 0, { r1: { originId: "a1", status: "done" } }, 0, noQueue)).toBe(true);
        expect(doneSuggestion(done, 0, { r1: { originId: "a1", status: "cancelled" } }, 0, noQueue)).toBe(true);
        expect(doneSuggestion(done, 0, { r1: { originId: "a2", status: "running" } }, 0, noQueue)).toBe(true);
    });

    // closing the agent ends its process, and with it a build it left running in the background
    it("not while a background task still runs", () => {
        expect(doneSuggestion(done, 0, none, 1, noQueue)).toBe(false);
        expect(doneSuggestion(done, 0, none, 2, noQueue)).toBe(false);
    });

    // `wsh runs start --queue` handed a plan to wavesrv, which starts it when there is room: until it does, there is no
    // run to hold the Close back, and closing the session would leave nobody to tell when the run lands
    it("not while a plan it queued still waits, or is blocked, to start", () => {
        const waiting = { id: "q1", state: "waiting", data: { origintabid: "a1" } } as RunQueueEntry;
        const blocked = { id: "q2", state: "blocked", data: { origintabid: "a1" } } as RunQueueEntry;
        expect(doneSuggestion(done, 0, none, 0, [waiting])).toBe(false);
        expect(doneSuggestion(done, 0, none, 0, [blocked])).toBe(false);
    });

    it("ignores a plan another agent queued, and offers it again once its own has started", () => {
        const other = { id: "q1", state: "waiting", data: { origintabid: "a2" } } as RunQueueEntry;
        const noOrigin = { id: "q2", state: "waiting", data: {} } as RunQueueEntry;
        expect(doneSuggestion(done, 0, none, 0, [other, noOrigin])).toBe(true);
        expect(doneSuggestion(done, 0, none, 0, noQueue)).toBe(true);
    });
});
