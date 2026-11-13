import { describe, expect, it } from "vitest";
import { taskLifecycle } from "./peeklifecycle";
import {
    axisEnd,
    eventCount,
    eventDetail,
    filterGroups,
    glyphOf,
    groupEvents,
    groupHasDetail,
    groupSnippet,
    needsDate,
    phaseOf,
    railRows,
    snippetOf,
    spanText,
    stepLabel,
    stripTicks,
} from "./timelinegroups";

const MIN = 60_000;
let seq = 0;
const ev = (min: number, kind: string, taskid?: string, extra: Record<string, unknown> = {}): RunEvent => ({
    id: `e${seq++}`,
    runid: "r",
    channelid: "c",
    ts: min * MIN,
    kind,
    detail: JSON.stringify(taskid ? { taskid, ...extra } : extra),
});

describe("phaseOf", () => {
    it("puts review, landing and work kinds in their phases", () => {
        expect(["task-review-started", "task-verify-failed", "task-merged", "task-spawned"].map(phaseOf)).toEqual([
            "review",
            "land",
            "land",
            "work",
        ]);
    });
});

describe("groupEvents", () => {
    it("bursts one phase of one task within 3 minutes into a row, newest row first", () => {
        const g = groupEvents([
            ev(0, "task-spawned", "t-1"),
            ev(1, "task-first-activity", "t-1"),
            ev(10, "task-done", "t-1"),
            ev(11, "task-verify-started", "t-1"),
            ev(12, "task-verify-passed", "t-1"),
            ev(12.5, "task-merged", "t-1"),
        ]);
        expect(g.map((x) => x.items.length)).toEqual([4, 2]);
        expect(g[0].head.kind).toBe("task-merged");
        expect(g[0].steps.map((e) => e.kind)).toEqual(["task-done", "task-verify-passed", "task-merged"]);
        expect(g[1].steps.map((e) => e.kind)).toEqual(["task-spawned"]);
    });
    it("splits a phase after a pause longer than the burst window", () => {
        expect(groupEvents([ev(0, "task-spawned", "t-1"), ev(4, "task-told", "t-1")])).toHaveLength(2);
    });
    it("flags a burst holding an attention event and heads it with that event", () => {
        const g = groupEvents([ev(0, "task-verify-started", "t-2"), ev(1, "task-verify-failed", "t-2")]);
        expect(g[0].attention).toBe(true);
        expect(g[0].head.kind).toBe("task-verify-failed");
    });
    it("sorts out-of-order events and treats a row without a task as dag-level", () => {
        const bad: RunEvent = { id: "x", runid: "r", channelid: "c", ts: 0, kind: "dag-blocked", detail: "{not json" };
        const g = groupEvents([ev(2, "task-spawned", "t-1"), bad]);
        expect(g.map((x) => x.taskId)).toEqual(["t-1", ""]);
    });
});

describe("filterGroups / railRows", () => {
    const groups = groupEvents([ev(0, "task-spawned", "t-1"), ev(20, "task-failed", "t-2")]);
    it("filters by attention and by the selected task", () => {
        expect(filterGroups(groups, "attention", null).map((g) => g.taskId)).toEqual(["t-2"]);
        expect(filterGroups(groups, "task", "t-1").map((g) => g.taskId)).toEqual(["t-1"]);
        expect(filterGroups(groups, "task", null)).toEqual([]);
        expect(filterGroups(groups, "all", null)).toHaveLength(2);
    });
    it("marks a quiet stretch of 5 minutes or more", () => {
        expect(railRows(groups).map((r) => r.kind)).toEqual(["group", "gap", "group"]);
        expect(railRows(groups)[1]).toEqual({ kind: "gap", minutes: 20 });
    });
});

describe("snippetOf / eventDetail", () => {
    it("picks the failing package from Verify output", () => {
        const e = ev(0, "task-verify-failed", "t-1", {
            detail: "exit 1: FAIL\nFAIL\tgithub.com/wavetermdev/waveterm/cmd/wsh/cmd\t4.8s",
        });
        expect(snippetOf(e)).toBe("FAIL cmd/wsh/cmd 4.8s");
        expect(eventDetail(e).pre).toContain("cmd/wsh/cmd");
    });
    it("reports spawn timing and the merge commit", () => {
        expect(snippetOf(ev(0, "task-spawned", "t", { worktreems: 1200, setupms: 65000, spawnms: 300 }))).toBe(
            "worktree 1.2s · setup 1m 5s · spawn 0.3s"
        );
        expect(snippetOf(ev(0, "task-merged", "t", { commit: "f00dcafe12345678" }))).toBe("commit f00dcafe");
        expect(snippetOf(ev(0, "task-merged", "t", { commit: "f00dcafe12345678", verify: "final" }))).toBe(
            "commit f00dcafe · Verify left to the final stage"
        );
    });
    it("falls back to the first item with a snippet", () => {
        const g = groupEvents([ev(0, "task-spawned", "t", { worktreems: 1000 }), ev(1, "task-first-activity", "t")]);
        expect(groupSnippet(g[0])).toBe("worktree 1.0s · setup 0.0s · spawn 0.0s");
    });
    it("is empty for a row with no detail", () => {
        expect(snippetOf({ id: "x", runid: "r", channelid: "c", ts: 0, kind: "task-merged" })).toBe("");
    });
});

describe("stepLabel / glyphOf / stripTicks", () => {
    it("labels steps in words", () => {
        expect(stepLabel(ev(0, "task-verify-passed", "t-1"))).toBe("verify passed");
        expect(stepLabel(ev(0, "dag-done"))).not.toBe("");
    });
    it("names a stage session by its role, so two in one burst read apart", () => {
        expect(stepLabel(ev(0, "stage-session-started", undefined, { role: "plan-reviewer" }))).toBe(
            "Plan reviewer started"
        );
        expect(stepLabel(ev(0, "stage-session-started", undefined, { role: "verifier" }))).toBe(
            "Final verifier started"
        );
    });
    it("gives attention kinds the alert glyph", () => {
        expect(glyphOf("task-failed")).toBe("alert");
        expect(glyphOf("task-review-started")).toBe("eye");
        expect(glyphOf("task-merged")).toBe("merge");
    });
    it("places every event on the run's time axis", () => {
        const t = stripTicks([ev(0, "task-spawned", "t-1"), ev(5, "task-failed", "t-1")], 10 * MIN);
        expect(t.map((x) => [x.frac, x.attention])).toEqual([
            [0, false],
            [0.5, true],
        ]);
    });
});

describe("groupEvents keys (8d14dca57)", () => {
    it("keys a group by its first event, whatever its place in the sorted list", () => {
        const spawned = ev(0, "task-spawned", "t-1");
        const g = groupEvents([ev(2, "task-told", "t-1"), spawned, ev(1, "task-retried", "t-1")]);
        expect(g[0].key).toBe(`t-1:work@${spawned.id}`);
    });
    it("keeps every later group's key when an event stamped earlier arrives", () => {
        const later = [ev(10, "task-told", "t-2"), ev(20, "task-told", "t-3")];
        const before = groupEvents(later).map((g) => g.key);
        const after = groupEvents([...later, ev(0, "task-spawned", "t-1")]);
        expect(after.filter((g) => g.taskId !== "t-1").map((g) => g.key)).toEqual(before);
    });
    it("keeps same-millisecond events in the order they happened", () => {
        const first = ev(0, "task-spawned", "t-1");
        const second = ev(0, "task-told", "t-1");
        // newest-first, as the history and the live stream deliver them
        const g = groupEvents([second, first]);
        expect(g[0].items.map((e) => e.id)).toEqual([first.id, second.id]);
    });
});

describe("final stage rows", () => {
    it("says the round of the final stage's end", () => {
        expect(snippetOf(ev(0, "final-ended", undefined, { round: 2, outcome: "passed" }))).toBe("round 2");
    });
    it("labels the human's escalate and the final rerun", () => {
        expect(stepLabel(ev(0, "task-skipped", "t-1"))).toBe("skipped");
        expect(stepLabel(ev(0, "task-escalated", "t-1"))).toBe("escalated");
        expect(stepLabel(ev(0, "final-rerun"))).toBe("final rerun");
    });
});

describe("axis, spans and dates (652fa1a3d)", () => {
    const HOUR = 60 * MIN;
    const DAY = 24 * HOUR;
    it("puts an ended run's last event at the end of its axis", () => {
        const evs = [ev(0, "task-spawned", "t-1"), ev(4, "task-done", "t-1"), ev(8, "dag-done")];
        const t = stripTicks(evs, axisEnd(evs, true, 30 * DAY));
        expect(t.map((x) => x.frac)).toEqual([0, 0.5, 1]);
    });
    it("reads a duration in the largest unit that keeps it short", () => {
        expect(spanText(45_000)).toBe("45s");
        expect(spanText(12 * MIN)).toBe("12m");
        expect(spanText(77 * MIN)).toBe("1h17m");
        expect(spanText(29 * DAY + 19 * HOUR)).toBe("29d");
    });
    it("ends an ended run's axis at its last event and a live run's at now", () => {
        const evs = [ev(3, "task-done", "t-1"), ev(1, "task-spawned", "t-1")];
        expect(axisEnd(evs, true, 100 * MIN)).toBe(3 * MIN);
        expect(axisEnd(evs, false, 100 * MIN)).toBe(100 * MIN);
        expect(axisEnd([], true, 100 * MIN)).toBe(100 * MIN);
    });
    it("dates the labels when the events span days or are not from today", () => {
        const at = (d: number, h: number, m = 0): RunEvent => ({
            id: `${d}:${h}:${m}`,
            runid: "r",
            channelid: "c",
            ts: new Date(2026, 9, d, h, m).getTime(),
            kind: "task-done",
        });
        const now = new Date(2026, 9, 16, 15, 0).getTime();
        expect(needsDate([at(15, 23, 50), at(16, 0, 10)], now)).toBe(true);
        expect(needsDate([at(16, 9), at(16, 14)], now)).toBe(false);
        expect(needsDate([at(15, 9), at(15, 14)], now)).toBe(true);
        expect(needsDate([], now)).toBe(false);
    });
});

// 2026-11-13 Kael sync, 9f9b2f3e9 (D3)
describe("eventDetail for an actor's action", () => {
    it("says who retried, skipped, escalated or reran, as the timeline does", () => {
        expect(eventDetail(ev(0, "task-skipped", "t-3", { by: "human" })).text).toBe("you skipped t-3");
        expect(eventDetail(ev(0, "task-skipped", "t-3", { by: "lead" })).text).toBe("lead skipped t-3");
        expect(eventDetail(ev(0, "task-retried", "t-2", { auto: false, by: "human" })).text).toBe("you retried t-2");
        expect(eventDetail(ev(0, "task-escalated", "t-3", { by: "human" })).text).toBe("you escalated t-3");
        expect(eventDetail(ev(0, "final-rerun", undefined, { round: 2 })).text).toBe("you reran the final stage");
    });

    it("keeps an engine retry's own text", () => {
        expect(eventDetail(ev(0, "task-retried", "t-2", { auto: true, text: "stalled, retrying" })).text).toBe(
            "stalled, retrying"
        );
    });
});

describe("eventDetail / groupHasDetail (rows that only repeat their title)", () => {
    it("gives a failed lead wake its reason and the lines behind it", () => {
        expect(eventDetail(ev(0, "lead-wake-failed", undefined, { reason: "lead exited", lines: ["a", "b"] }))).toEqual({
            text: "lead exited",
            pre: "a\nb",
        });
    });
    it("is empty for a sealed evidence row with no note", () => {
        expect(eventDetail(ev(0, "evidence-sealed"))).toEqual({ text: "", pre: "" });
    });
    it("drops a detail that only repeats the title", () => {
        expect(eventDetail(ev(0, "task-told", "t-1", { text: "You told a worker" }))).toEqual({ text: "", pre: "" });
    });
    it("expands only a row with something beyond its title", () => {
        const [sealed] = groupEvents([ev(0, "evidence-sealed")]);
        expect(groupHasDetail(sealed)).toBe(false);
        const [wake] = groupEvents([ev(0, "lead-wake-failed", undefined, { reason: "lead exited" })]);
        expect(groupHasDetail(wake)).toBe(true);
        const [reviewed] = groupEvents([
            ev(0, "plan-reviewed", undefined, { reviewers: [{ lens: "full", state: "approved" }] }),
        ]);
        expect(groupHasDetail(reviewed)).toBe(true);
        const [burst] = groupEvents([ev(0, "task-spawned", "t-1"), ev(1, "task-first-activity", "t-1")]);
        expect(groupHasDetail(burst)).toBe(true);
    });
});

describe("eventCount", () => {
    it("counts a task's events as the peek's Lifecycle does, not its bursts", () => {
        const evs = [
            ev(0, "task-spawned", "t-3"),
            ev(1, "task-first-activity", "t-3"),
            ev(2, "task-spawned", "t-1"),
            ev(10, "task-done", "t-3"),
            ev(11, "task-verify-started", "t-3"),
            ev(12, "task-verify-passed", "t-3"),
            ev(30, "task-told", "t-3"),
            ev(31, "dag-done"),
        ];
        const groups = filterGroups(groupEvents(evs), "task", "t-3");
        expect(groups.length).toBeLessThan(taskLifecycle(evs, "t-3").length);
        expect(eventCount(groups)).toBe(taskLifecycle(evs, "t-3").length);
        expect(eventCount(groupEvents(evs))).toBe(evs.length);
    });
});
