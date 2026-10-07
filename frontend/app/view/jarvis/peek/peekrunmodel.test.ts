// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { buildRunPeek, runPeekFacts, type PeekRunInput } from "./peekrunmodel";

const NOW = 10 * 3_600_000;

function run(over: Partial<Run> = {}): Run {
    return {
        otype: "run",
        oid: "r1",
        version: 1,
        meta: {},
        id: "r1",
        goal: "Implement the vault sync design\n\nAll three stages. The spec is approved.",
        mode: "orchestrator",
        runtime: "claude",
        model: "claude-opus-5-5",
        workspaceid: "",
        projectpath: "/src/waveterm",
        status: "done",
        phases: [],
        createdts: NOW - 3 * 3_600_000,
        completedts: NOW - 2 * 3_600_000,
        basecommit: "139ad29aaaaaaa",
        endcommit: "08c06f2bbbbbbb",
        ...over,
    } as Run;
}

function task(id: string, state: string): TaskNode {
    return { id, label: `Task ${id}`, state } as TaskNode;
}

function group(over: Partial<TaskGroup> = {}): TaskGroup {
    const ids = ["t-1", "t-2", "t-3", "t-4", "t-5", "t-6", "t-7", "t-8"];
    return {
        otype: "dag",
        oid: "g1",
        version: 1,
        meta: {},
        id: "g1",
        runid: "r1",
        channelid: "c1",
        parallelism: 3,
        tasks: ids.map((id) => task(id, "done")),
        status: "done",
        failures: 0,
        createdts: 0,
        updatedts: 0,
        planreview: { state: "passed", round: 1 },
        final: { state: "unverified", round: 1, unverified: ["the verifier did not open Settings > Memory."] },
        ...over,
    } as TaskGroup;
}

function usage(taskid: string, input: number): UsageRow {
    return { role: "worker", taskid, input, output: 0, cacheread: 0, cachewrite: 0, cachewrite1h: 0, msgs: 1 };
}

function input(over: Partial<PeekRunInput> = {}): PeekRunInput {
    return { run: run(), group: group(), usage: [], commitCount: 7, project: "waveterm", now: NOW, ...over };
}

describe("buildRunPeek: an orchestrator run", () => {
    it("draws the phase strip from the plan, its review, the tasks and the final stage", () => {
        expect(buildRunPeek(input()).phases).toEqual([
            { label: "Plan", state: "passed", tone: "done" },
            { label: "Plan review", state: "passed", tone: "done" },
            { label: "Tasks", state: "8 of 8 landed", tone: "done" },
            { label: "Final", state: "unverified", tone: "warning" },
        ]);
    });

    it("reads a run still executing as such", () => {
        const g = group({
            tasks: [task("t-1", "done"), task("t-2", "running"), task("t-3", "pending")],
            planreview: { state: "accepted", round: 2 },
            final: undefined,
        });
        expect(buildRunPeek(input({ run: run({ status: "executing" }), group: g })).phases).toEqual([
            { label: "Plan", state: "passed", tone: "done" },
            { label: "Plan review", state: "accepted", tone: "done" },
            { label: "Tasks", state: "1 of 3 landed", tone: "running" },
            { label: "Final", state: "waiting", tone: "pending" },
        ]);
    });

    it("says the lead is still writing the plan before a graph exists", () => {
        const view = buildRunPeek(input({ run: run({ status: "planning" }), group: null }));
        expect(view.phases?.map((p) => p.state)).toEqual(["writing", "waiting", "waiting", "waiting"]);
        expect(view.tasks).toBeNull();
    });

    it("prints the unverified line only when the final stage ended unverified", () => {
        expect(buildRunPeek(input()).unverified).toBe("the verifier did not open Settings > Memory.");
        const passed = group({ final: { state: "passed", round: 1 } });
        expect(buildRunPeek(input({ group: passed })).unverified).toBeNull();
    });

    it("lists the tasks in plan order with their tokens", () => {
        const g = group({ tasks: [task("t-2", "done"), task("t-1", "failed"), task("t-3", "pending")] });
        const view = buildRunPeek(input({ group: g, usage: [usage("t-2", 1_700_000), usage("t-1", 2_000)] }));
        expect(view.tasks).toEqual([
            { id: "t-2", title: "Task t-2", mark: "done", state: "done", tokens: "1.7M" },
            { id: "t-1", title: "Task t-1", mark: "failed", state: "failed", tokens: "2k" },
            { id: "t-3", title: "Task t-3", mark: "pending", state: "pending", tokens: "" },
        ]);
    });

    it("names the landed commit range and its size", () => {
        expect(buildRunPeek(input()).commits).toBe("139ad29..08c06f2 · 7 commits");
        expect(buildRunPeek(input({ run: run({ endcommit: undefined }), commitCount: undefined })).commits).toBeNull();
    });

    it("prints the meta line: mode, project, lead, duration, tokens, age", () => {
        const view = buildRunPeek(input({ usage: [usage("t-1", 32_400_000)] }));
        expect(view.meta).toEqual([
            { text: "orchestrator" },
            { text: "waveterm" },
            { text: "claude opus-5-5", runtime: "claude" },
            { text: "1h0m" },
            { text: "32.4M tok" },
            { text: "2h0m ago", faint: true },
        ]);
    });

    it("takes the title from the goal's first line and keeps the goal text", () => {
        const view = buildRunPeek(input());
        expect(view.title).toBe("Implement the vault sync design");
        expect(view.goal).toContain("The spec is approved.");
        expect(view.status).toEqual({ label: "done", tone: "done" });
    });
});

describe("buildRunPeek: a quick run", () => {
    it("has no phase strip and no task list, even with a parent's graph to hand", () => {
        const view = buildRunPeek(input({ run: run({ mode: "quick", goal: "Fix the typo" }) }));
        expect(view.phases).toBeNull();
        expect(view.tasks).toBeNull();
        expect(view.unverified).toBeNull();
        expect(view.commits).toBeNull();
        expect(view.goal).toBeNull();
        expect(view.meta[0]).toEqual({ text: "quick" });
    });
});

describe("runPeekFacts", () => {
    it("is gone when the run no longer exists", () => {
        expect(runPeekFacts(undefined)).toEqual({ gone: true });
    });

    it("is present while the run exists", () => {
        expect(runPeekFacts(run())).toEqual({ gone: false });
    });
});
