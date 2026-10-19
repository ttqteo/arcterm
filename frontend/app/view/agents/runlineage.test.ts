// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import type { AgentVM } from "./agentsviewmodel";
import { finalStageId } from "./finalstage";
import {
    agentProject,
    endedRoles,
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
    runAgentsOf,
    runEngineBusy,
    runFocusAgent,
    runProgress,
    runRoleOf,
    runTitle,
    stageLabel,
    taskAgentOf,
    taskElapsed,
    taskStateLabel,
    unmetDeps,
    workerAsk,
    workerSubtext,
    type Lineage,
} from "./runlineage";

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
            "t-2 · asked the lead · 6m"
        );
        expect(workerSubtext({ taskId: "t-3", ask: { owner: "you" }, lane: "C", age: "3m" })).toBe(
            "t-3 · asks you · 3m"
        );
        expect(workerSubtext({ taskId: "t-2", lane: "B", age: "6m" })).toBe("t-2 · lane B · 6m");
        expect(workerSubtext({ taskId: "t-2", age: "6m" })).toBe("t-2 · 6m");
        expect(workerSubtext({ taskId: "t-1", lane: "A", age: "", outcome: "landed" })).toBe("t-1 · lane A · landed");
        expect(workerSubtext({ taskId: "t-4", lane: "A", age: "", waits: ["t-2", "t-3"] })).toBe(
            "t-4 · lane A · waits on t-2, t-3"
        );
        expect(workerSubtext({ taskId: "t-4", lane: "A", age: "", waits: [] })).toBe("t-4 · lane A · queued");
        expect(formatLeft(59_000)).toBe("<1m left");
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
