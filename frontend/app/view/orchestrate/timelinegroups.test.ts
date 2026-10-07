import { describe, expect, it } from "vitest";
import {
    eventDetail,
    filterGroups,
    glyphOf,
    groupEvents,
    groupSnippet,
    phaseOf,
    railRows,
    snippetOf,
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
