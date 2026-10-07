// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
    artifactsOf,
    buildRunTimeline,
    clickTargetFor,
    eventKindTitle,
    eventText,
    joinWorkspacePath,
    toneFor,
} from "./runtimeline";

function ev(kind: string, ts: number, phaseIdx?: number): RunEvent {
    return {
        id: "e" + ts,
        runid: "run-1",
        channelid: "ch",
        ts,
        kind,
        phaseidx: phaseIdx,
        detail: undefined,
    } as RunEvent;
}

const fakeRun = {
    id: "run-1",
    phases: [{ kind: "brainstorm" }, { kind: "plan" }, { kind: "execute" }],
} as unknown as Run;

describe("buildRunTimeline", () => {
    it("groups phase events under their phase and cross-cutting events under RUN", () => {
        const events = [ev("run-created", 1), ev("phase-started", 2, 0), ev("triage", 3), ev("phase-complete", 4, 1)];
        const { groups } = buildRunTimeline(fakeRun, events);
        const runGroup = groups.find((g) => g.id === "run");
        const phase1 = groups.find((g) => g.id === "phase-1");
        const phase2 = groups.find((g) => g.id === "phase-2");
        expect(runGroup?.events.map((e) => e.kind)).toEqual(["triage", "run-created"]);
        expect(phase1?.events.map((e) => e.kind)).toEqual(["phase-started"]);
        expect(phase2?.events.map((e) => e.kind)).toEqual(["phase-complete"]);
    });

    it("preview is the last 3 events overall (newest first)", () => {
        const events = [ev("run-created", 1), ev("phase-started", 2, 0), ev("triage", 3), ev("phase-held", 4, 1)];
        const { preview } = buildRunTimeline(fakeRun, events);
        expect(preview.map((e) => e.kind)).toEqual(["phase-held", "triage", "phase-started"]);
    });

    it("lists what the human told a worker under RUN", () => {
        const { groups } = buildRunTimeline(fakeRun, [ev("task-told", 1)]);
        expect(groups.find((g) => g.id === "run")?.events.map((e) => e.kind)).toEqual(["task-told"]);
    });

    it("lists a worker that may be stuck under RUN", () => {
        const { groups } = buildRunTimeline(fakeRun, [ev("task-suspect", 1)]);
        expect(groups.find((g) => g.id === "run")?.events.map((e) => e.kind)).toEqual(["task-suspect"]);
    });

    it("returns empty groups when there are no events", () => {
        const { groups, preview } = buildRunTimeline(fakeRun, []);
        expect(groups).toEqual([]);
        expect(preview).toEqual([]);
    });
});

describe("clickTargetFor", () => {
    // phase-held is a row only a run stored before slice 5c can carry. It scrolls to the phase it names
    // like any other phase row — the verb that released a held phase is gone.
    it("maps phase-held to focus-phase and child events to select-child", () => {
        expect(clickTargetFor(ev("phase-held", 4, 1))).toEqual({ kind: "focus-phase", phaseIdx: 1 });
        const childEv = { ...ev("child-done", 5), detail: JSON.stringify({ childrunid: "run-9", goal: "t" }) };
        expect(clickTargetFor(childEv)).toEqual({ kind: "select-child", childRunId: "run-9" });
    });

    it("maps stalled/blocked to open-dag and evidence-sealed to open-diff", () => {
        const stalled = { ...ev("task-stalled", 6), detail: JSON.stringify({ taskid: "t-2" }) };
        expect(clickTargetFor(stalled)).toEqual({ kind: "open-dag", taskId: "t-2" });
        const suspect = { ...ev("task-suspect", 6), detail: JSON.stringify({ taskid: "t-3" }) };
        expect(clickTargetFor(suspect)).toEqual({ kind: "open-dag", taskId: "t-3" });
        expect(clickTargetFor(ev("evidence-sealed", 7))).toEqual({ kind: "open-diff" });
    });

    it("returns none for unhandled kinds", () => {
        expect(clickTargetFor(ev("run-created", 1))).toEqual({ kind: "none" });
    });
});

describe("artifactsOf", () => {
    it("extracts the first artifact from detail", () => {
        const e = { ...ev("phase-complete", 4, 1), detail: JSON.stringify({ artifacts: ["deliverable.md"] }) };
        expect(artifactsOf(e)).toEqual(["deliverable.md"]);
    });

    it("is empty when detail has no artifacts", () => {
        expect(artifactsOf(ev("phase-complete", 4, 1))).toEqual([]);
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

describe("joinWorkspacePath", () => {
    it("joins a workspace-relative path onto the project path and passes absolute paths through", () => {
        expect(joinWorkspacePath("/repo/a", "docs/x.md")).toBe("/repo/a/docs/x.md");
        expect(joinWorkspacePath("C:\\repo", "docs\\x.md")).toBe("C:\\repo\\docs\\x.md");
        expect(joinWorkspacePath("/repo", "/abs/x.md")).toBe("/abs/x.md");
        expect(joinWorkspacePath("/repo", "C:\\abs\\x.md")).toBe("C:\\abs\\x.md");
    });
});
