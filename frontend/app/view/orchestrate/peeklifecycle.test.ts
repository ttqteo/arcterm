// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { tsLabel } from "../agents/runtimeline";
import { eventsCountText, finalLifecycle, isFinalStageEvent, taskLifecycle } from "./peeklifecycle";

function ev(kind: string, detail: Record<string, unknown> | undefined, ts: number): RunEvent {
    return {
        id: `${kind}-${ts}`,
        runid: "run-1",
        channelid: "ch-1",
        ts,
        kind,
        detail: detail == null ? undefined : JSON.stringify(detail),
    };
}

const MIN = 60_000;
const T0 = new Date(2026, 9, 20, 15, 46).getTime();

describe("taskLifecycle", () => {
    const events = [
        ev("task-spawned", { taskid: "t-3" }, T0),
        ev("task-spawned", { taskid: "t-2" }, T0),
        ev("task-done", { taskid: "t-3" }, T0 + 6 * MIN),
        ev("task-verify-started", { taskid: "t-3" }, T0 + 6 * MIN + 1),
        ev("task-verify-failed", { taskid: "t-3", reason: "exit 1", detail: "FAIL\tpkg/x\t0.4s\nmore" }, T0 + 7 * MIN),
        ev("task-failed", { taskid: "t-3", attempts: 1, lastfailurekind: "test-failed" }, T0 + 7 * MIN + 1),
        ev("dag-done", undefined, T0 + 8 * MIN),
    ];

    it("keeps only the task's own events, newest first", () => {
        expect(taskLifecycle(events, "t-3").map((r) => r.title)).toEqual([
            "Task failed",
            "Verify failed",
            "Verify started",
            "Task done",
            "Task spawned",
        ]);
    });

    it("orders by time whatever order the log arrives in", () => {
        expect(taskLifecycle([...events].reverse(), "t-3").map((r) => r.id)).toEqual(
            taskLifecycle(events, "t-3").map((r) => r.id)
        );
    });

    it("marks attention kinds, and only those", () => {
        expect(taskLifecycle(events, "t-3").map((r) => r.attention)).toEqual([true, true, false, false, false]);
    });

    it("gives each row its time, the rail's tone and its detail in words", () => {
        const [, verifyFailed] = taskLifecycle(events, "t-3");
        expect(verifyFailed.time).toBe(tsLabel(T0 + 7 * MIN));
        expect(verifyFailed.tone).toBe("text-warning");
        // the failing line, not the whole Verify output
        expect(verifyFailed.detail).toBe("FAIL pkg/x 0.4s");
    });

    it("is empty for a task with no events yet", () => {
        expect(taskLifecycle(events, "t-9")).toEqual([]);
    });
});

describe("finalLifecycle", () => {
    const events = [
        ev("stage-session-started", { role: "plan-reviewer", lens: "spec" }, T0),
        ev("task-merged", { taskid: "t-1" }, T0 + MIN),
        ev("final-step", { round: 1, step: "check", ms: 4000, ok: true }, T0 + 2 * MIN),
        ev("final-step", { round: 1, step: "verify", ms: 38000, ok: false }, T0 + 3 * MIN),
        ev("dag-blocked", { failures: 1, kind: "final-failed" }, T0 + 3 * MIN + 1),
        ev("dag-blocked", { failures: 1, kind: "task-failed" }, T0 + 3 * MIN + 2),
        ev("stage-session-started", { role: "verifier", runid: "r-v" }, T0 + 4 * MIN),
        ev("final-ended", { round: 1, outcome: "unverified" }, T0 + 4 * MIN + 1),
        ev("land-held", { reason: "the base has uncommitted changes" }, T0 + 5 * MIN),
        ev("landed", { commit: "f00dcafe12345678", title: "Merge wave/run-1" }, T0 + 6 * MIN),
    ];

    it("keeps the final stage's own run-level events, newest first", () => {
        expect(finalLifecycle(events).map((r) => r.title)).toEqual([
            "Run landed",
            "Land held",
            "Final stage unverified",
            "Final verifier started",
            "DAG blocked",
            "Final Verify failed",
            "Final Check passed",
        ]);
    });

    it("tones a final step by its outcome", () => {
        const rows = finalLifecycle(events);
        expect(rows.find((r) => r.title === "Final Check passed")?.tone).toBe("text-success");
        expect(rows.find((r) => r.title === "Final Verify failed")?.tone).toBe("text-warning");
    });

    it("gives the final stage's end its round", () => {
        const byTitle = new Map(finalLifecycle(events).map((r) => [r.title, r.detail]));
        expect(byTitle.get("Final stage unverified")).toBe("round 1");
    });

    it("lists a rerun with the stage's own events", () => {
        const rerun = [...events, ev("final-rerun", { round: 1 }, T0 + 7 * MIN)];
        expect(finalLifecycle(rerun)[0]).toMatchObject({ title: "Final stage rerun", tone: "text-muted" });
        expect(isFinalStageEvent(ev("final-rerun", { round: 1 }, 1))).toBe(true);
    });

    it("is empty while the stage has not run", () => {
        expect(finalLifecycle(events.slice(0, 2))).toEqual([]);
    });
});

describe("isFinalStageEvent", () => {
    it("never claims a task's event", () => {
        expect(isFinalStageEvent(ev("final-step", { taskid: "t-1", step: "check", ok: true }, 1))).toBe(false);
    });
});

describe("eventsCountText", () => {
    it("counts in words", () => {
        expect(eventsCountText(0)).toBe("0 events");
        expect(eventsCountText(1)).toBe("1 event");
        expect(eventsCountText(5)).toBe("5 events");
    });
});
