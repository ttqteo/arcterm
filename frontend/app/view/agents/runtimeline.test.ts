// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { eventText, eventTitle, eventTone, planReviewLensTitle, toneFor, tsLabel } from "./runtimeline";

const kindTitle = (kind: string) => eventTitle({ id: "1", ts: 1, kind } as RunEvent);

describe("tsLabel", () => {
    // a local date, so the label reads the same in every timezone
    const ts = new Date(2026, 9, 16, 13, 59, 30).getTime();
    it("is HH:MM by default", () => {
        expect(tsLabel(ts)).toBe("13:59");
    });
    it("leads with the month and day when asked for the date", () => {
        expect(tsLabel(ts, true)).toBe("Oct 16 13:59");
    });
});

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

describe("eventTitle by kind", () => {
    it("names the queue and wake rows", () => {
        expect(kindTitle("task-forwarded")).toBe("Handed to you");
        expect(kindTitle("lead-woken")).toBe("Lead woken");
        expect(kindTitle("lead-launched")).toBe("Lead started");
        expect(kindTitle("lead-wake-failed")).toBe("Lead wake failed");
        expect(kindTitle("lead-revived")).toBe("Lead taking wakes again");
        expect(kindTitle("lead-exited")).toBe("Lead exited");
        expect(kindTitle("worker-exited")).toBe("Worker exited");
        expect(kindTitle("interrupted")).toBe("Interrupted by restart");
        expect(kindTitle("worker-resumed")).toBe("Worker resumed");
        expect(kindTitle("task-told")).toBe("You told a worker");
        expect(kindTitle("task-suspect")).toBe("Task may be stuck");
    });

    it("titles every kind the engine writes, never the raw kind", () => {
        for (const kind of [
            "land-held",
            "landed",
            "stage-session-started",
            "plan-reviewed",
            "queued-start",
            "land-queued",
            "land-resolving",
        ]) {
            expect(kindTitle(kind)).not.toBe(kind);
        }
    });

    it("says a run started from the queue as a sentence", () => {
        expect(kindTitle("queued-start")).toBe("Started from the queue");
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

describe("final-ended", () => {
    const ended = (outcome: string): RunEvent =>
        ({ id: "1", ts: 1, kind: "final-ended", detail: JSON.stringify({ round: 1, outcome }) }) as RunEvent;

    it("titles and tones the stage's end by its outcome, in the rail's words", () => {
        expect(["passed", "unverified", "failed"].map((o) => [eventTitle(ended(o)), eventTone(ended(o))])).toEqual([
            ["Final verification passed", "text-success"],
            ["Final stage unverified", "text-warning"],
            ["Final verification failed", "text-warning"],
        ]);
        expect(eventText(ended("passed"))).toBe("Final verification passed");
    });

    it("never shows the raw kind, even for an outcome it does not know", () => {
        expect(eventTitle(ended("odd"))).toBe("Final stage ended");
    });
});

describe("final-step", () => {
    const step = (detail: object): RunEvent =>
        ({ id: "1", ts: 1, kind: "final-step", detail: JSON.stringify(detail) }) as RunEvent;

    it("titles a step by its name and tones it by its outcome", () => {
        expect(eventTitle(step({ step: "check", ok: true }))).toBe("Final Check passed");
        expect(eventTitle(step({ step: "verify", ok: false }))).toBe("Final Verify failed");
        expect(eventTitle(step({ step: "tree", ok: true }))).toBe("Final tree passed");
        expect(eventTitle(step({ step: "final", ok: false }))).toBe("Final command failed");
        expect(eventTitle(step({ step: "other", ok: true }))).toBe("Final step passed");
        expect(eventTone(step({ step: "check", ok: true }))).toBe("text-success");
        expect(eventTone(step({ step: "verify", ok: false }))).toBe("text-warning");
    });
});

describe("eventTone", () => {
    it("is toneFor for a kind whose tone its kind alone carries", () => {
        expect(eventTone({ id: "1", ts: 1, kind: "task-failed" } as RunEvent)).toBe("text-warning");
        expect(eventTone({ id: "1", ts: 1, kind: "unknown-kind" } as RunEvent)).toBe("text-muted");
    });
});

describe("planReviewLensTitle", () => {
    it("titles every lens, and falls back to the key for one it does not know", () => {
        expect(["full", "second", "spec", "order", "tests", "final", "followup"].map(planReviewLensTitle)).toEqual([
            "Full review",
            "Second pass",
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

    it("names the queue entry a run started from, or just the title when the detail has none", () => {
        expect(eventText(eventWith("7", 1, "queued-start", { entryid: "q-ab12" }))).toBe(
            "Started from the queue · q-ab12"
        );
        expect(eventText(eventWith("8", 1, "queued-start"))).toBe("Started from the queue");
        expect(eventText(eventWith("9", 1, "queued-start", {}))).toBe("Started from the queue");
    });
});

describe("eventText: the human's and the lead's task actions", () => {
    const ev = (kind: string, detail?: object): RunEvent =>
        ({ id: "1", ts: 1, kind, detail: detail ? JSON.stringify(detail) : undefined }) as RunEvent;

    it("says a retry, skip and escalate in the actor's name", () => {
        expect(eventText(ev("task-retried", { taskid: "t-2", auto: false, by: "human" }))).toBe("you retried t-2");
        expect(eventText(ev("task-retried", { taskid: "t-2", auto: false, by: "lead" }))).toBe("lead retried t-2");
        expect(eventText(ev("task-skipped", { taskid: "t-3", by: "human" }))).toBe("you skipped t-3");
        expect(eventText(ev("task-skipped", { taskid: "t-3", by: "lead" }))).toBe("lead skipped t-3");
        expect(eventText(ev("task-escalated", { taskid: "t-3", model: "claude-opus-5-5", by: "human" }))).toBe(
            "you escalated t-3 to opus-5-5"
        );
        expect(eventText(ev("task-escalated", { taskid: "t-3", model: "claude-opus-5-5", by: "lead" }))).toBe(
            "lead escalated t-3 to opus-5-5"
        );
    });

    it("keeps an engine retry's text, which names no actor", () => {
        expect(eventText(ev("task-retried", { taskid: "t-2", kind: "failed", attempt: 1, auto: true }))).toBe(
            "Task retried · t-2"
        );
        expect(eventText(ev("task-retried", { taskid: "t-2", kind: "failed", attempt: 1 }))).toBe("Task retried · t-2");
    });

    it("ends an escalate at the task when the model is missing", () => {
        expect(eventText(ev("task-escalated", { taskid: "t-3", by: "human" }))).toBe("you escalated t-3");
    });

    it("says a final rerun as the human's act", () => {
        expect(eventText(ev("final-rerun", { round: 2 }))).toBe("you reran the final stage");
    });

    it("titles and tones the new kinds", () => {
        expect(eventTitle(ev("task-skipped", { taskid: "t-3" }))).toBe("Skipped");
        expect(eventTitle(ev("task-escalated", { taskid: "t-3" }))).toBe("Escalated");
        expect(eventTitle(ev("final-rerun", { round: 1 }))).toBe("Final stage rerun");
        expect(toneFor("task-skipped")).toBe("text-muted");
        expect(toneFor("task-escalated")).toBe("text-warning");
        expect(toneFor("final-rerun")).toBe("text-muted");
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
        expect(kindTitle("task-verify-started")).toBe("Verify started");
        expect(kindTitle("task-verify-passed")).toBe("Verify passed");
        expect(kindTitle("task-verify-failed")).toBe("Verify failed");
        expect(toneFor("task-verify-started")).toBe("text-muted");
        expect(toneFor("task-verify-passed")).toBe("text-success");
        expect(toneFor("task-verify-failed")).toBe("text-warning");
    });
});
