// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { eventKindTitle, eventText, eventTitle, planReviewLensTitle, toneFor } from "./runtimeline";

describe("toneFor", () => {
    it("stays within the existing tone utilities and falls back to muted", () => {
        expect(toneFor("phase-started")).toBe("text-success");
        expect(toneFor("task-stalled")).toBe("text-warning");
        expect(toneFor("task-suspect")).toBe("text-warning");
        expect(toneFor("unknown-kind")).toBe("text-muted");
    });

    it("tones the queue and wake rows", () => {
        expect(toneFor("task-forwarded")).toBe("text-asking");
        expect(toneFor("lead-wake-failed")).toBe("text-warning");
        expect(toneFor("lead-exited")).toBe("text-warning");
        expect(toneFor("worker-exited")).toBe("text-warning");
        expect(toneFor("interrupted")).toBe("text-warning");
        expect(toneFor("lead-woken")).toBe("text-muted");
        expect(toneFor("lead-launched")).toBe("text-muted");
        expect(toneFor("task-told")).toBe("text-muted");
    });
});

describe("eventKindTitle", () => {
    it("names the queue and wake rows", () => {
        expect(eventKindTitle("task-forwarded")).toBe("Handed to you");
        expect(eventKindTitle("lead-woken")).toBe("Lead woken");
        expect(eventKindTitle("lead-launched")).toBe("Lead started");
        expect(eventKindTitle("lead-wake-failed")).toBe("Lead wake failed");
        expect(eventKindTitle("lead-revived")).toBe("Lead taking wakes again");
        expect(eventKindTitle("lead-exited")).toBe("Lead exited");
        expect(eventKindTitle("worker-exited")).toBe("Worker exited");
        expect(eventKindTitle("interrupted")).toBe("Interrupted by restart");
        expect(eventKindTitle("worker-resumed")).toBe("Worker resumed");
        expect(eventKindTitle("task-told")).toBe("You told a worker");
        expect(eventKindTitle("task-suspect")).toBe("Task may be stuck");
    });

    it("titles every kind the engine writes, never the raw kind", () => {
        for (const kind of ["land-held", "landed", "stage-session-started", "plan-reviewed"]) {
            expect(eventKindTitle(kind)).not.toBe(kind);
        }
    });
});

describe("eventTitle", () => {
    const started = (detail: object): RunEvent =>
        ({ id: "1", ts: 1, kind: "stage-session-started", detail: JSON.stringify(detail) }) as RunEvent;

    it("names a plan reviewer's lens in its started row", () => {
        expect(eventTitle(started({ role: "plan-reviewer", lens: "spec" }))).toBe(
            "Plan reviewer started · Spec coverage"
        );
        expect(eventTitle(started({ role: "plan-reviewer", lens: "followup" }))).toBe(
            "Plan reviewer started · Round-2 follow-up"
        );
    });

    it("says only the role when the detail names no lens", () => {
        expect(eventTitle(started({ role: "plan-reviewer" }))).toBe("Plan reviewer started");
        expect(eventTitle(started({ role: "verifier" }))).toBe("Final verifier started");
    });
});

describe("planReviewLensTitle", () => {
    it("titles every lens, and falls back to the key for one it does not know", () => {
        expect(["full", "spec", "order", "tests", "final", "followup"].map(planReviewLensTitle)).toEqual([
            "Full review",
            "Spec coverage",
            "Task order and files",
            "Tests and commands",
            "Final coverage",
            "Round-2 follow-up",
        ]);
        expect(planReviewLensTitle("style")).toBe("style");
    });
});

describe("eventText", () => {
    const eventWith = (id: string, ts: number, kind: string, detail?: object): RunEvent =>
        ({ id, ts, kind, detail: detail ? JSON.stringify(detail) : undefined }) as RunEvent;

    it("says a take-over as the human's act and a forward as a hand-off", () => {
        expect(eventText(eventWith("1", 1, "task-forwarded", { taskid: "t-4", by: "human", note: "taken over" }))).toBe(
            "you took t-4 over from the lead"
        );
        expect(eventText(eventWith("2", 1, "task-forwarded", { taskid: "t-4", note: "lead unsure" }))).toBe(
            "t-4 handed to you · lead unsure"
        );
        expect(eventText(eventWith("3", 1, "child-ask", { taskid: "t-4", question: "hide it?" }))).toBe(
            "t-4 asked · hide it?"
        );
        expect(eventText(eventWith("4", 1, "task-merged", { taskid: "t-1" }))).toBe("Task merged · t-1");
        expect(eventText(eventWith("5", 1, "dag-done"))).toBe("DAG complete");
        expect(
            eventText(eventWith("6", 1, "task-told", { taskid: "t-3", text: "keep closed-session\nlinks clickable" }))
        ).toBe("you told t-3 · keep closed-session links clickable");
    });
});

describe("eventText: rows with an optional tail", () => {
    const ev = (kind: string, detail?: object): RunEvent =>
        ({ id: "1", ts: 1, kind, detail: detail ? JSON.stringify(detail) : undefined }) as RunEvent;

    it("ends a row at its subject when the note, question or text is missing", () => {
        expect(eventText(ev("task-forwarded", { taskid: "t-4" }))).toBe("t-4 handed to you");
        expect(eventText(ev("child-ask", { taskid: "t-4" }))).toBe("t-4 asked");
        expect(eventText(ev("task-told", { taskid: "t-4" }))).toBe("you told t-4");
        expect(eventText(ev("task-review-passed", { taskid: "t-4" }))).toBe("Review passed · t-4");
        expect(eventText(ev("task-review-failed", { taskid: "t-4" }))).toBe("Review failed · t-4");
    });

    it("folds every run of whitespace in a told text into one space", () => {
        expect(eventText(ev("task-told", { taskid: "t-3", text: "keep  it\n\n  tidy" }))).toBe(
            "you told t-3 · keep it tidy"
        );
    });

    it("carries a reviewer's note on the review rows, whitespace folded", () => {
        expect(eventText(ev("task-review-passed", { taskid: "t-2", note: "looks  good\n\nship it" }))).toBe(
            "Review passed · t-2 · looks good ship it"
        );
        expect(eventText(ev("task-review-failed", { taskid: "t-2", note: "missing\n  a test" }))).toBe(
            "Review failed · t-2 · missing a test"
        );
    });
});

describe("verify rows", () => {
    it("names and tones the merge-point Verify rows", () => {
        expect(eventKindTitle("task-verify-started")).toBe("Verify started");
        expect(eventKindTitle("task-verify-passed")).toBe("Verify passed");
        expect(eventKindTitle("task-verify-failed")).toBe("Verify failed");
        expect(toneFor("task-verify-started")).toBe("text-muted");
        expect(toneFor("task-verify-passed")).toBe("text-success");
        expect(toneFor("task-verify-failed")).toBe("text-warning");
    });
});
