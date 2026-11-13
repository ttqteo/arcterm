// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { recoverySummary, recoveryText } from "./recoverysummary";

function ev(kind: string, detail: Record<string, unknown>, ts: number): RunEvent {
    return { id: `${kind}-${ts}`, runid: "r", channelid: "c", ts, kind, detail: JSON.stringify(detail) } as RunEvent;
}

const retried = (taskid: string, kind: string, attempt: number, ts: number) =>
    ev("task-retried", { taskid, kind, attempt }, ts);
const failed = (taskid: string, lastfailurekind: string, attempts: number, ts: number) =>
    ev("task-failed", { taskid, runid: "child", lastfailurekind, attempts }, ts);

describe("recoverySummary", () => {
    it("says nothing about a task that never failed", () => {
        expect(recoverySummary([ev("task-done", { taskid: "t-1" }, 1)], "t-1")).toBeNull();
        expect(recoverySummary([], "t-1")).toBeNull();
    });

    it("counts only the retries actually retained, for the task asked about", () => {
        const events = [
            retried("t-1", "tool-error", 1, 10),
            retried("t-1", "tool-error", 2, 20),
            retried("t-2", "timeout", 1, 30),
        ];
        expect(recoverySummary(events, "t-1")?.retries).toBe(2);
        expect(recoverySummary(events, "t-2")?.retries).toBe(1);
    });

    it("carries the newest failure kind, not the first one seen", () => {
        const events = [retried("t-1", "tool-error", 1, 10), failed("t-1", "context-window", 2, 20)];
        expect(recoverySummary(events, "t-1")?.lastFailureKind).toBe("context-window");
    });

    // The event log is bounded, so "how many times was this retried" can only ever be answered from
    // what survived. The attempt numbers the surviving rows carry are what expose the gap.
    it("flags history that cannot account for the attempts its own rows record", () => {
        expect(recoverySummary([retried("t-1", "tool-error", 3, 30)], "t-1")?.partial).toBe(true);
    });

    it("does not flag a complete retry history as partial", () => {
        const events = [retried("t-1", "tool-error", 1, 10), retried("t-1", "tool-error", 2, 20)];
        expect(recoverySummary(events, "t-1")?.partial).toBe(false);
    });

    // a terminal failure consumes an attempt without emitting a retry, so attempts legitimately
    // exceeds retries by exactly one
    it("does not flag a terminal failure as missing a retry that never happened", () => {
        expect(recoverySummary([failed("t-1", "timeout", 1, 10)], "t-1")?.partial).toBe(false);
        const events = [retried("t-1", "timeout", 1, 10), failed("t-1", "timeout", 2, 20)];
        expect(recoverySummary(events, "t-1")?.partial).toBe(false);
    });
});

// 2026-11-13 Kael sync, 932d4fa34 (D3): a human's or lead's retry carries `by` and no kind or attempt, so it is
// not an engine recovery
describe("recoverySummary, a retry somebody else took", () => {
    it("skips a human's retry, keeping the engine's count and last failure kind", () => {
        const events = [
            retried("t-1", "verify", 1, 10),
            retried("t-1", "verify", 2, 20),
            failed("t-1", "verify", 3, 30),
            ev("task-retried", { taskid: "t-1", auto: false, by: "human" }, 40),
        ];
        expect(recoverySummary(events, "t-1")).toEqual({
            retries: 2,
            lastFailureKind: "verify",
            partial: false,
            terminalFailure: true,
        });
    });

    it("says nothing about a task whose only retry was a human's", () => {
        const events = [ev("task-retried", { taskid: "t-1", auto: false, by: "human" }, 10)];
        expect(recoverySummary(events, "t-1")).toBeNull();
    });

    it("skips the lead's retry the same way", () => {
        const events = [retried("t-1", "timeout", 1, 10), ev("task-retried", { taskid: "t-1", by: "lead" }, 20)];
        expect(recoverySummary(events, "t-1")?.retries).toBe(1);
        expect(recoverySummary(events, "t-1")?.lastFailureKind).toBe("timeout");
    });
});

describe("recoveryText", () => {
    it("summarises a recovered retry with its kind and where the task stands now", () => {
        const summary = recoverySummary([retried("t-1", "tool-error", 1, 10)], "t-1")!;
        expect(recoveryText(summary, "running")).toBe("Retried once · tool-error · now running");
    });

    it("pluralises repeated retries", () => {
        const events = [retried("t-1", "timeout", 1, 10), retried("t-1", "timeout", 2, 20)];
        expect(recoveryText(recoverySummary(events, "t-1")!, "done")).toBe("Retried 2 times · timeout · now done");
    });

    it("reports a failure that was never retried as a failure, not a recovery", () => {
        const summary = recoverySummary([failed("t-1", "timeout", 1, 10)], "t-1")!;
        expect(recoveryText(summary, "failed")).toBe("Failed · timeout · now failed");
    });

    it("says so when the history behind the summary is incomplete", () => {
        const summary = recoverySummary([retried("t-1", "tool-error", 4, 40)], "t-1")!;
        expect(recoveryText(summary, "running")).toBe(
            "Retried at least once · tool-error · now running · earlier history not retained"
        );
    });
});
