// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import type { AgentVM } from "./agentsviewmodel";
import { finalStageId } from "./finalstage";
import {
    agentProject,
    endedPlanReviewers,
    endedReviewerId,
    endedReviewerOf,
    endedReviewerVM,
    endedRoles,
    endedVerifierId,
    endedVerifierOf,
    endedVerifierVM,
    endedWorkerId,
    endedWorkerVM,
    finalStageRoles,
    finalStageVM,
    formatLeft,
    holdsTask,
    isEndedWorkerId,
    laneLabel,
    leadAgentOf,
    leadRunTabIds,
    leadStandingBy,
    mergeGateLine,
    runAgentsOf,
    runEngineBusy,
    runFocusAgent,
    runInfoOf,
    runProgress,
    runRoleOf,
    runTitle,
    stageLabel,
    taskAgentOf,
    taskElapsed,
    taskStateLabel,
    unmetDeps,
    verifierStepTarget,
    verifyFailLine,
    workerAge,
    workerAsk,
    workerSubtext,
    type Lineage,
    type RunInfo,
} from "./runlineage";
import { modelLabel } from "./session-models/sessionviewmodel";

const dag = {
    oid: "dag-1",
    runid: "lead-run",
    title: "",
    tasks: [{ id: "t-1", runid: "child-run", state: "running" }],
} as TaskGroup;

describe("runRoleOf", () => {
    it("reads the dag's owning run as the lead", () => {
        const run = { oid: "lead-run", dagoref: "dag:dag-1", mode: "orchestrator" } as Run;
        expect(runRoleOf(run, dag)).toEqual({ kind: "lead", runId: "lead-run" });
    });

    it("reads a task's child run as a worker of the lead run", () => {
        const run = { oid: "child-run", dagoref: "dag:dag-1", mode: "quick" } as Run;
        expect(runRoleOf(run, dag)).toEqual({ kind: "worker", leadRunId: "lead-run", taskId: "t-1" });
    });

    it("drops a child run no task points at any more", () => {
        expect(runRoleOf({ oid: "old-attempt", dagoref: "dag:dag-1", mode: "quick" } as Run, dag)).toBeNull();
    });

    it("reads an orchestrator run with no dag yet as a lead, and a Quick run as nothing", () => {
        expect(runRoleOf({ oid: "planning", mode: "orchestrator" } as Run, undefined)).toEqual({
            kind: "lead",
            runId: "planning",
        });
        expect(runRoleOf({ oid: "quick", mode: "quick" } as Run, undefined)).toBeNull();
        expect(runRoleOf(undefined, undefined)).toBeNull();
    });
});

describe("run facts", () => {
    it("titles a run by its plan, else its goal's first line", () => {
        expect(runTitle({ goal: "ignored" } as Run, { title: "Resource linking" } as TaskGroup)).toBe(
            "Resource linking"
        );
        expect(runTitle({ goal: "Link resources\nacross surfaces" } as Run, undefined)).toBe("Link resources");
        expect(runTitle(undefined, undefined)).toBe("Orchestrator run");
    });

    it("letters lanes in plan order", () => {
        const digest = { lanes: [["t-1", "t-3"], ["t-2"]] } as DagStatusDigest;
        expect(laneLabel(digest, "t-3")).toBe("A");
        expect(laneLabel(digest, "t-2")).toBe("B");
        expect(laneLabel(digest, "t-9")).toBeUndefined();
        expect(laneLabel(undefined, "t-1")).toBeUndefined();
    });

    it("says who holds a task's question", () => {
        const digest = {
            tasks: [
                { taskid: "t-1", waitreason: "lead-ask", askdeadline: 5000 },
                { taskid: "t-2", waitreason: "ask" },
                { taskid: "t-3", waitreason: "none" },
            ],
        } as DagStatusDigest;
        expect(workerAsk(digest, "t-1")).toEqual({ owner: "lead", deadline: 5000 });
        expect(workerAsk(digest, "t-2")).toEqual({ owner: "you" });
        expect(workerAsk(digest, "t-3")).toBeUndefined();
    });

    it("writes a worker's second line from its question, else its lane and age", () => {
        expect(workerSubtext({ taskId: "t-2", ask: { owner: "lead", deadline: 481_000 }, lane: "B", age: "6m" })).toBe(
            "t-2 · asked the lead"
        );
        expect(workerSubtext({ taskId: "t-3", ask: { owner: "you" }, lane: "C", age: "3m" })).toBe("t-3 · asks you");
        expect(workerSubtext({ taskId: "t-2", lane: "B", age: "6m" })).toBe("t-2 · lane B");
        expect(workerSubtext({ taskId: "t-2", age: "6m" })).toBe("t-2");
        expect(workerSubtext({ taskId: "t-1", lane: "A", age: "", outcome: "landed" })).toBe("t-1 · lane A · landed");
        expect(workerSubtext({ taskId: "t-4", lane: "A", age: "", waits: ["t-2", "t-3"] })).toBe(
            "t-4 · lane A · waits on t-2, t-3"
        );
        expect(workerSubtext({ taskId: "t-4", lane: "A", age: "", waits: [] })).toBe("t-4 · lane A · queued");
        expect(formatLeft(59_000)).toBe("<1m left");
    });

    it("puts a worker's age in its own column, only where it says something", () => {
        expect(workerAge({ taskId: "t-2", lane: "B", age: "6m" })).toBe("6m");
        expect(workerAge({ taskId: "t-2", ask: { owner: "lead", deadline: 481_000 }, age: "6m" })).toBe("6m");
        expect(workerAge({ taskId: "t-3", ask: { owner: "you" }, state: "running", age: "3m" })).toBe("3m");
        expect(workerAge({ taskId: "t-1", age: "9m", outcome: "landed" })).toBe("");
        expect(workerAge({ taskId: "t-4", age: "1m", waits: [] })).toBe("");
        expect(workerAge({ taskId: "t-1", age: "3m", state: "verifying 2m" })).toBe("");
    });

    it("lists what a not-started task still waits on, and nothing once it has started", () => {
        const g = {
            tasks: [
                { id: "t-1", state: "done" },
                { id: "t-2", state: "running" },
                { id: "t-3", state: "pending", deps: ["t-1", "t-2"] },
                { id: "t-4", state: "ready", deps: ["t-1"] },
            ],
        } as TaskGroup;
        expect(unmetDeps(g, g.tasks[2])).toEqual(["t-2"]);
        expect(unmetDeps(g, g.tasks[3])).toEqual([]);
        expect(unmetDeps(g, g.tasks[1])).toBeUndefined();
    });

    it("finds the roster agents leading a run and working its tasks", () => {
        const lineage = {
            roles: { w: { kind: "worker", leadRunId: "r1", taskId: "t-1" }, l: { kind: "lead", runId: "r1" } },
            runs: {},
        } as const;
        const agents = [{ id: "w" }, { id: "l" }];
        expect(leadAgentOf(lineage, agents, "r1")).toEqual({ id: "l" });
        expect(leadAgentOf(lineage, agents, "r2")).toBeUndefined();
        expect(taskAgentOf(lineage, agents, "r1", "t-1")).toEqual({ id: "w" });
        expect(taskAgentOf(lineage, agents, "r1", "t-2")).toBeUndefined();
        expect(taskAgentOf(lineage, agents, "r2", "t-1")).toBeUndefined();
    });

    it("finds every roster tab a run still holds, its lead and all its task tabs", () => {
        const lineage = {
            roles: {
                w1: { kind: "worker", leadRunId: "r1", taskId: "t-1" },
                w2: { kind: "worker", leadRunId: "r1", taskId: "t-6" },
                l: { kind: "lead", runId: "r1" },
                other: { kind: "worker", leadRunId: "r2", taskId: "t-1" },
            },
            runs: {},
        } as const;
        const agents = [{ id: "w1" }, { id: "plain" }, { id: "w2" }, { id: "l" }, { id: "other" }];
        expect(runAgentsOf(lineage, agents, "r1").map((a) => a.id)).toEqual(["w1", "w2", "l"]);
        expect(runAgentsOf(lineage, agents, "r3")).toEqual([]);
    });

    it("offers a lead's whole run to close only when the run holds tabs besides the lead", () => {
        const lineage = {
            roles: {
                l: { kind: "lead", runId: "r1" },
                w: { kind: "worker", leadRunId: "r1", taskId: "t-1" },
                s: { kind: "stage", leadRunId: "r1", stageRole: "plan-reviewer" },
                alone: { kind: "lead", runId: "r2" },
            },
            runs: {},
        } as const;
        const agents = [{ id: "l" }, { id: "w" }, { id: "s" }, { id: "alone" }, { id: "plain" }];
        expect(leadRunTabIds(lineage, agents, "l")).toEqual(["l", "w", "s"]);
        expect(leadRunTabIds(lineage, agents, "alone")).toBeUndefined();
        expect(leadRunTabIds(lineage, agents, "w")).toBeUndefined();
        expect(leadRunTabIds(lineage, agents, "plain")).toBeUndefined();
    });

    it("opens a lead-less run on the tab that asks, else the one at work, never one with no terminal", () => {
        const lineage = {
            roles: {
                done: { kind: "worker", leadRunId: "r1", taskId: "t-1" },
                rev: { kind: "stage", leadRunId: "r1", stageRole: "plan-reviewer" },
                w: { kind: "worker", leadRunId: "r1", taskId: "t-2" },
                ask: { kind: "worker", leadRunId: "r1", taskId: "t-3" },
                noblock: { kind: "worker", leadRunId: "r1", taskId: "t-4" },
                other: { kind: "worker", leadRunId: "r2", taskId: "t-1" },
            },
            runs: {},
        } as const;
        const tab = (id: string, state: AgentVM["state"], blockId: string | null = `b-${id}`) =>
            ({ id, state, blockId: blockId ?? undefined }) as const;
        const idle = tab("done", "idle");
        const reviewing = tab("rev", "working");
        const working = tab("w", "working");
        const asking = tab("ask", "asking");
        const blockless = tab("noblock", "asking", null);
        const other = tab("other", "asking");
        expect(runFocusAgent(lineage, [idle, reviewing, working, asking, other], "r1")?.id).toBe("ask");
        expect(runFocusAgent(lineage, [idle, reviewing, working, blockless], "r1")?.id).toBe("rev");
        expect(runFocusAgent(lineage, [idle, other], "r1")).toBeUndefined();
        expect(runFocusAgent(lineage, [], "r1")).toBeUndefined();
    });

    it("shows a worker under its lead's project, else its run's", () => {
        const lineage = {
            roles: { w: { kind: "worker", leadRunId: "r1", taskId: "t-1" }, l: { kind: "lead", runId: "r1" } },
            runs: { r1: { runId: "r1", channelId: "c", title: "", project: "accept-ask" } },
        } as const;
        const worker = { id: "w", name: "w", task: "", state: "working", project: "3" } as const;
        const lead = { id: "l", name: "l", task: "", state: "idle", project: "waveterm" } as const;
        expect(agentProject(lineage, [worker, lead], worker)).toBe("waveterm");
        expect(agentProject(lineage, [worker], worker)).toBe("accept-ask");
        expect(agentProject(lineage, [worker, lead], lead)).toBe("waveterm");
    });

    it("counts done and skipped tasks as finished", () => {
        const tasks = [{ state: "done" }, { state: "skipped" }, { state: "running" }] as TaskNode[];
        expect(runProgress({ tasks } as TaskGroup)).toEqual({ done: 2, total: 3 });
        expect(runProgress(undefined)).toEqual({ done: 0, total: 0 });
    });
});

describe("ended workers", () => {
    const done = { id: "t-1", label: "link model", state: "done", runid: "child-1", merged: true } as TaskNode;
    const runs = {
        r1: {
            runId: "r1",
            channelId: "c",
            title: "",
            project: "p",
            dag: { tasks: [done, { id: "t-2", state: "running" }, { id: "t-3", state: "skipped" }] } as TaskGroup,
        },
    };

    it("gives each done task a worker role under an id no roster agent has", () => {
        const id = endedWorkerId("r1", "t-1");
        expect(endedRoles(runs)).toEqual({ [id]: { kind: "worker", leadRunId: "r1", taskId: "t-1" } });
        expect(isEndedWorkerId(id)).toBe(true);
        expect(isEndedWorkerId("5c1e9a4e-tab")).toBe(false);
    });

    it("reads a done task's worker from the child run it last ran", () => {
        const child = { runtime: "claude", model: "claude-sonnet-4-6", completedts: 5000 } as Run;
        expect(endedWorkerVM("r1", done, child, "C:/t.jsonl")).toEqual({
            id: endedWorkerId("r1", "t-1"),
            name: "link model",
            task: "link model",
            state: "idle",
            agent: "claude",
            model: "sonnet 4.6",
            idleSince: 5000,
            transcriptPath: "C:/t.jsonl",
            runId: "child-1",
        });
        expect(endedWorkerVM("r1", done, undefined, "")).toMatchObject({
            agent: undefined,
            idleSince: undefined,
            transcriptPath: undefined,
        });
    });
});

describe("ended plan reviewers", () => {
    const reviewers: PlanReviewer[] = [
        { lens: "full", state: "passed", runid: "rv-full" },
        { lens: "second", state: "failed", runid: "rv-second" },
        { lens: "order", state: "lost", runid: "rv-order" },
        { lens: "tests", state: "reviewing", runid: "rv-tests" },
        { lens: "spec", state: "lost", runid: "" },
    ];
    const run: RunInfo = {
        runId: "r1",
        channelId: "c",
        title: "",
        project: "p",
        dag: { tasks: [], planreview: { state: "failed", round: 1, reviewers } } as TaskGroup,
    };

    it("lists the round's reviewers with a verdict and a run, not one still reviewing or never started", () => {
        expect(endedPlanReviewers(run).map((r) => r.runid)).toEqual(["rv-full", "rv-second", "rv-order"]);
        expect(endedPlanReviewers({ ...run, dag: undefined })).toEqual([]);
    });

    it("lists none while the round is still reviewing, as the roster's tabs alone are then the rows", () => {
        const reviewing = {
            ...run,
            dag: { tasks: [], planreview: { state: "reviewing", round: 1, reviewers } } as TaskGroup,
        };
        expect(endedPlanReviewers(reviewing)).toEqual([]);
    });

    it("gives each a plan-reviewer stage role under an ended id no roster agent has", () => {
        const id = endedReviewerId("r1", "rv-full");
        const roles = endedRoles({ r1: run });
        expect(roles[id]).toEqual({ kind: "stage", leadRunId: "r1", stageRole: "plan-reviewer" });
        expect(Object.keys(roles)).toHaveLength(3);
        expect(roles[endedReviewerId("r1", "rv-tests")]).toBeUndefined();
        expect(isEndedWorkerId(id)).toBe(true);
    });

    it("finds the reviewer an ended id names, and none for a worker's ended id", () => {
        expect(endedReviewerOf(run, endedReviewerId("r1", "rv-second"))?.lens).toBe("second");
        expect(endedReviewerOf(run, endedReviewerId("r1", "rv-tests"))).toBeUndefined();
        expect(endedReviewerOf(run, endedWorkerId("r1", "t-1"))).toBeUndefined();
    });

    it("reads an ended reviewer from its own run, named by its lens", () => {
        const child = { runtime: "claude", model: "claude-haiku-4-5", completedts: 7000 } as Run;
        expect(endedReviewerVM("r1", reviewers[1], child, "C:/r.jsonl")).toMatchObject({
            id: endedReviewerId("r1", "rv-second"),
            name: "Plan review · Second pass",
            task: "",
            state: "idle",
            agent: "claude",
            idleSince: 7000,
            transcriptPath: "C:/r.jsonl",
            runId: "rv-second",
        });
        expect(endedReviewerVM("r1", reviewers[0])).toMatchObject({
            agent: undefined,
            idleSince: undefined,
            transcriptPath: undefined,
            runId: "rv-full",
        });
    });
});

describe("runRoleOf for a reviewer", () => {
    it("reads a task's reviewer run as that task's worker", () => {
        const reviewed = {
            ...dag,
            tasks: [{ id: "t-1", runid: "child-run", reviewrunid: "review-run", state: "reviewing" }],
        } as TaskGroup;
        const run = { oid: "review-run", dagoref: "dag:dag-1", mode: "quick" } as Run;
        expect(runRoleOf(run, reviewed)).toEqual({ kind: "worker", leadRunId: "lead-run", taskId: "t-1" });
    });

    it("keeps a reviewer under its task by its stamped task id once its verdict clears the task's link", () => {
        const passed = {
            ...dag,
            tasks: [{ id: "t-1", runid: "child-run", reviewrunid: "", reviewverdict: "pass", state: "done" }],
        } as TaskGroup;
        const run = { oid: "review-run", dagoref: "dag:dag-1", mode: "quick" } as Run;
        expect(runRoleOf(run, passed, "t-1")).toEqual({ kind: "worker", leadRunId: "lead-run", taskId: "t-1" });
        // a stamp naming no task of the dag places nothing
        expect(runRoleOf(run, passed, "t-9")).toBeNull();
    });

    it("tells a task's current agent from a tab an earlier run left on it", () => {
        const info = { runId: "lead-run", channelId: "c", title: "", project: "", dag };
        expect(holdsTask(info, "t-1", { runId: "child-run" })).toBe(true);
        expect(holdsTask(info, "t-1", { runId: "old-attempt" })).toBe(false);
        expect(holdsTask(info, "t-1", {})).toBe(false);
        const roles = {
            stale: { kind: "worker", leadRunId: "lead-run", taskId: "t-1" },
            live: { kind: "worker", leadRunId: "lead-run", taskId: "t-1" },
        } as const;
        const agents = [
            { id: "stale", runId: "old-attempt" },
            { id: "live", runId: "child-run" },
        ];
        expect(taskAgentOf({ roles, runs: { "lead-run": info } }, agents, "lead-run", "t-1")?.id).toBe("live");
    });
});

describe("leadStandingBy", () => {
    const run = {
        runId: "lead-run",
        channelId: "c",
        title: "",
        project: "",
        dag: { ...dag, status: "running" } as TaskGroup,
    };

    it("reads a lead at its prompt while the plan executes as standing by", () => {
        expect(leadStandingBy({ atPrompt: true }, run)).toBe(true);
    });

    it("keeps a busy lead, a finished run and a run with no plan as they are", () => {
        expect(leadStandingBy({ atPrompt: undefined }, run)).toBe(false);
        expect(leadStandingBy({ atPrompt: true }, { ...run, dag: { ...dag, status: "done" } as TaskGroup })).toBe(
            false
        );
        expect(leadStandingBy({ atPrompt: true }, { ...run, dag: undefined })).toBe(false);
    });
});

describe("runEngineBusy", () => {
    const runOf = (over: Partial<TaskGroup>) => ({
        runId: "lead-run",
        channelId: "c",
        title: "",
        project: "",
        dag: { ...dag, status: "running", tasks: [], ...over } as TaskGroup,
    });
    const tasks = (...states: string[]) => states.map((state, i) => ({ id: `t-${i}`, state }) as TaskNode);

    it("is busy while a worker, reviewer or merge Verify is at work", () => {
        for (const state of ["running", "reviewing", "verifying"]) {
            expect(runEngineBusy(runOf({ tasks: tasks("done", state) }))).toBe(true);
        }
    });

    it("is busy while the plan is reviewed or the final stage runs", () => {
        expect(runEngineBusy(runOf({ planreview: { state: "reviewing", round: 1 } }))).toBe(true);
        for (const state of ["checking", "final", "verifying"]) {
            expect(runEngineBusy(runOf({ final: { state, round: 1 } }))).toBe(true);
        }
    });

    it("is not busy when every task waits, ended, or needs a judgment", () => {
        expect(runEngineBusy(runOf({ tasks: tasks("pending", "failed", "stalled", "review-failed", "done") }))).toBe(
            false
        );
        expect(
            runEngineBusy(runOf({ planreview: { state: "failed", round: 1 }, final: { state: "passed", round: 1 } }))
        ).toBe(false);
        expect(runEngineBusy({ ...runOf({}), dag: undefined })).toBe(false);
    });
});

describe("stage sessions", () => {
    it("reads a run the engine started for a stage as that stage of the lead run", () => {
        const run = { oid: "reviewer-run", dagoref: "dag-1", mode: "quick", stagerole: "plan-reviewer" } as Run;
        expect(runRoleOf(run, dag)).toEqual({ kind: "stage", leadRunId: "lead-run", stageRole: "plan-reviewer" });
    });

    it("counts a stage session among its run's tabs, under the run's project", () => {
        const lineage = {
            roles: {
                lead: { kind: "lead", runId: "lead-run" },
                rev: { kind: "stage", leadRunId: "lead-run", stageRole: "verifier" },
                other: { kind: "lead", runId: "other-run" },
            },
            runs: { "lead-run": { runId: "lead-run", channelId: "ch", title: "t", project: "waveterm" } },
        } as Lineage;
        const tabs = [{ id: "lead" }, { id: "rev" }, { id: "other" }];
        expect(runAgentsOf(lineage, tabs, "lead-run").map((a) => a.id)).toEqual(["lead", "rev"]);
        const rev = { id: "rev", name: "rev", task: "", state: "working", project: "b01cfdd6-wt" } as AgentVM;
        expect(agentProject(lineage, [], rev)).toBe("waveterm");
    });

    it("titles a stage row by its stage", () => {
        expect(stageLabel("plan-reviewer")).toBe("Plan review");
        expect(stageLabel("verifier")).toBe("Final verification");
    });

    it("titles a land resolver's row Conflict resolver, and a role it does not know by the role", () => {
        expect(stageLabel("land-resolver")).toBe("Conflict resolver");
        expect(stageLabel("auditor")).toBe("auditor");
    });
});

describe("a task past its worker", () => {
    it("names verifying with how long its Verify has run, and leaves the states a row already shows unsaid", () => {
        const now = 1_000_000;
        expect(taskStateLabel({ id: "t", state: "verifying", verifystartedts: now - 125_000 } as TaskNode, now)).toBe(
            "verifying 2m"
        );
        expect(taskStateLabel({ id: "t", state: "verify-failed" } as TaskNode, now)).toBe("verify failed");
        for (const state of ["pending", "ready", "running", "done"]) {
            expect(taskStateLabel({ id: "t", state } as TaskNode, now)).toBeUndefined();
        }
    });

    it("times a worker from its spawn, and says nothing for a task spawned before the stamp", () => {
        const now = 1_000_000;
        expect(taskElapsed({ id: "t", state: "running", spawnedts: now - 9 * 60_000 } as TaskNode, now)).toBe("9m");
        expect(taskElapsed({ id: "t", state: "running", spawnedts: now - 20_000 } as TaskNode, now)).toBe("<1m");
        expect(taskElapsed({ id: "t", state: "running" } as TaskNode, now)).toBe("");
    });

    it("leads the worker row with its state in place of its age, so truncation drops the lane first", () => {
        expect(workerSubtext({ taskId: "t-1", lane: "A", age: "3m", state: "verifying 2m" })).toBe(
            "t-1 · verifying 2m · lane A"
        );
        expect(workerSubtext({ taskId: "t-2", lane: "B", age: "1m", state: "reviewing" })).toBe(
            "t-2 · reviewing · lane B"
        );
    });

    it("gives a merged task still verifying an ended worker, so its transcript opens", () => {
        const tasks = [
            { id: "t-1", state: "verifying", merged: true },
            { id: "t-2", state: "running" },
        ] as TaskNode[];
        const runs = { r: { runId: "r", channelId: "ch", title: "t", project: "p", dag: { tasks } as TaskGroup } };
        expect(Object.keys(endedRoles(runs))).toEqual([endedWorkerId("r", "t-1")]);
    });
});

describe("the final stage's own id", () => {
    const info = (runId: string, status: string, final?: FinalStage) => ({
        runId,
        channelId: "ch",
        title: "t",
        project: "p",
        dag: { status, final, tasks: [{ id: "t-1", state: "done" }] } as TaskGroup,
    });

    it("has a verifier stage role under its run once the stage has a row", () => {
        const runs = {
            r1: info("r1", "finalizing", { state: "checking", round: 1, step: "tree" }),
            r2: info("r2", "running"),
            r3: info("r3", "running", { state: "", round: 2 }),
            r4: { runId: "r4", channelId: "ch", title: "t", project: "p" },
        };
        expect(finalStageRoles(runs)).toEqual({
            [finalStageId("r1")]: { kind: "stage", leadRunId: "r1", stageRole: "verifier" },
            [finalStageId("r3")]: { kind: "stage", leadRunId: "r3", stageRole: "verifier" },
        });
    });

    it("is shown as a session named for the stage, with no terminal to mount", () => {
        const vm = finalStageVM("r1");
        expect(vm).toMatchObject({ id: finalStageId("r1"), name: stageLabel("verifier"), state: "idle" });
        expect(vm.blockId).toBeUndefined();
        expect(vm.runId).toBeUndefined();
    });
});

describe("runInfoOf", () => {
    it("reads a run's title, project, base and land from the lead's run", () => {
        const lead = {
            oid: "r-1",
            channeloid: "ch-1",
            goal: "Ship it\nmore",
            projectpath: "C:\\code\\arc",
            status: "done",
            landpath: "C:\\code\\.arc-land\\r-1",
            basebranch: "main",
            land: { state: "landed", commit: "7867142abc" },
            phases: [{ workerorefs: ["run:w"] }],
        } as unknown as Run;
        const digest = { dagversion: 3 } as DagStatusDigest;
        expect(runInfoOf("r-1", lead, dag, digest)).toEqual({
            runId: "r-1",
            channelId: "ch-1",
            title: "Ship it",
            project: "arc",
            projectPath: "C:\\code\\arc",
            leadStarted: true,
            status: "done",
            landPath: "C:\\code\\.arc-land\\r-1",
            base: "main",
            land: { state: "landed", commit: "7867142abc" },
            dag,
            digest,
        });
    });

    it("reads a run it has not loaded as an untitled run with no base", () => {
        const info = runInfoOf("r-2", undefined, undefined, undefined);
        expect(info).toMatchObject({ runId: "r-2", channelId: "", title: "Orchestrator run", project: "" });
        expect(info.base).toBeUndefined();
        expect(info.leadStarted).toBe(false);
    });
});

describe("mergeGateLine", () => {
    const gateRun = (holderState: string, tip: Partial<DagTaskDigest>): Pick<RunInfo, "dag" | "digest"> => ({
        dag: { tasks: [{ id: "t-2" }, { id: "t-4", state: holderState }] } as TaskGroup,
        digest: { tasks: [{ taskid: "t-2", ...tip }] } as DagStatusDigest,
    });

    it("reads a ready tip as merge ready", () => {
        expect(mergeGateLine(gateRun("done", { mergestate: "ready" }), "t-2")).toBe("merge ready");
    });

    it("names the holder and why a held tip waits", () => {
        const held = { mergestate: "held", mergeheldby: "t-4" };
        expect(mergeGateLine(gateRun("verifying", held), "t-2")).toBe("merge ready · waits on t-4's Verify");
        expect(mergeGateLine(gateRun("verify-failed", held), "t-2")).toBe("merge ready · waits on t-4's failed Verify");
        expect(mergeGateLine(gateRun("blocked-merge", held), "t-2")).toBe(
            "merge ready · waits on t-4's merge conflict"
        );
    });

    it("reads a held tip whose holder it cannot place as held", () => {
        expect(mergeGateLine(gateRun("done", { mergestate: "held", mergeheldby: "t-9" }), "t-2")).toBe(
            "merge ready · held"
        );
    });

    it("is undefined for any other state or a task the digest lacks", () => {
        expect(mergeGateLine(gateRun("done", { mergestate: "waiting" }), "t-2")).toBeUndefined();
        expect(mergeGateLine(gateRun("done", { mergestate: "merged" }), "t-2")).toBeUndefined();
        expect(mergeGateLine(gateRun("done", { mergestate: "ready" }), "t-9")).toBeUndefined();
        expect(mergeGateLine({ dag: undefined, digest: undefined }, "t-2")).toBeUndefined();
    });
});

describe("verifyFailLine", () => {
    const task = (verifyerror?: string) => ({ id: "t-1", verifyerror }) as TaskNode;

    it("prefers the digest's failure line", () => {
        const td = { taskid: "t-1", verifyfailline: "--- FAIL: TestAdd" } as DagTaskDigest;
        expect(verifyFailLine(task("exit 1: ✔ adds two positive numbers"), td)).toBe("--- FAIL: TestAdd");
    });

    it("falls back to the reason before the first colon, never the excerpt", () => {
        expect(verifyFailLine(task("exit 1: ✔ adds two positive numbers\nmore"), undefined)).toBe("exit 1");
        expect(verifyFailLine(task("timed out after 20m"), { taskid: "t-1" } as DagTaskDigest)).toBe(
            "timed out after 20m"
        );
    });

    it("is undefined with no verifyerror", () => {
        expect(verifyFailLine(task(undefined), undefined)).toBeUndefined();
        expect(verifyFailLine(task(""), undefined)).toBeUndefined();
    });
});

// 2026-11-13 Kael sync, cff274e28 (P11)
describe("ended verifier", () => {
    const run: RunInfo = {
        runId: "r1",
        channelId: "c",
        title: "",
        project: "p",
        dag: { tasks: [], final: { state: "passed", verifierrunid: "vr-1" } } as unknown as TaskGroup,
    };
    const noVerifier: RunInfo = { ...run, dag: { tasks: [], final: { state: "checking" } } as unknown as TaskGroup };

    it("gives the current verifier a stage role under an ended id", () => {
        const id = endedVerifierId("r1", "vr-1");
        expect(endedRoles({ r1: run })[id]).toEqual({ kind: "stage", leadRunId: "r1", stageRole: "verifier" });
        expect(isEndedWorkerId(id)).toBe(true);
        expect(Object.keys(endedRoles({ r1: noVerifier }))).toEqual([]);
    });

    it("finds the verifier run an ended id names, and none for another id", () => {
        expect(endedVerifierOf(run, endedVerifierId("r1", "vr-1"))).toBe("vr-1");
        expect(endedVerifierOf(run, endedVerifierId("r1", "vr-0"))).toBeUndefined();
        expect(endedVerifierOf(run, endedReviewerId("r1", "vr-1"))).toBeUndefined();
        expect(endedVerifierOf(noVerifier, endedVerifierId("r1", ""))).toBeUndefined();
    });

    it("reads it from its own run, named for the stage", () => {
        const child = { runtime: "claude", model: "claude-haiku-4-5", completedts: 7000 } as Run;
        expect(endedVerifierVM("r1", "vr-1", child, "C:/v.jsonl")).toEqual({
            id: endedVerifierId("r1", "vr-1"),
            name: stageLabel("verifier"),
            task: "",
            state: "idle",
            agent: "claude",
            model: modelLabel("claude-haiku-4-5"),
            idleSince: 7000,
            transcriptPath: "C:/v.jsonl",
            runId: "vr-1",
        });
    });

    it("opens the live verifier agent, else its ended transcript, else nothing without a verifier", () => {
        expect(verifierStepTarget(run, [{ id: "tab-v", runId: "vr-1" }])).toBe("tab-v");
        expect(verifierStepTarget(run, [{ id: "tab-old", runId: "vr-0" }])).toBe(endedVerifierId("r1", "vr-1"));
        expect(verifierStepTarget(run, [])).toBe(endedVerifierId("r1", "vr-1"));
        expect(verifierStepTarget(noVerifier, [{ id: "tab-v", runId: "vr-1" }])).toBeUndefined();
        expect(verifierStepTarget({ ...run, dag: undefined }, [])).toBeUndefined();
    });
});
