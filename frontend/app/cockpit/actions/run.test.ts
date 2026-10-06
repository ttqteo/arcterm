// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { RpcApi } from "@/app/store/wshclientapi";
import type { AgentsViewModel } from "@/app/view/agents/agents";
import type { AgentVM } from "@/app/view/agents/agentsviewmodel";
import type { Lineage, RunInfo } from "@/app/view/agents/runlineage";
import { atom, createStore } from "jotai";
import { describe, expect, it, vi } from "vitest";
import { allRunsAtom } from "../palette-data";
import { buildRunThing, RUN_KIND, type RunThing } from "./run";

function phase(over: Partial<RunPhase> = {}): RunPhase {
    return { kind: "execute", state: "pending", ...over };
}
function run(over: Partial<Run> = {}): Run {
    return {
        otype: "run",
        oid: "r1",
        version: 1,
        meta: {},
        id: "r1",
        goal: "Ship auth",
        workspaceid: "w1",
        projectpath: "/p",
        status: "executing",
        phases: [phase({ state: "running", workerorefs: ["tab:lead"] })],
        createdts: 1,
        ...over,
    };
}
function agent(id: string, over: Partial<AgentVM> = {}): AgentVM {
    return { id, name: id, task: "", state: "working", blockId: `b-${id}`, project: "arc", ...over } as AgentVM;
}
function info(over: Partial<RunInfo> = {}): RunInfo {
    return {
        runId: "r1",
        channelId: "c1",
        title: "Ship auth",
        project: "arc",
        dag: { oid: "D", runid: "r1", parallelism: 3, status: "running", tasks: [] } as TaskGroup,
        ...over,
    };
}
function lineage(runInfo?: RunInfo, roles: Lineage["roles"] = {}): Lineage {
    return { roles, runs: runInfo ? { [runInfo.runId]: runInfo } : {} };
}
function ev(kind: string, ts: number): RunEvent {
    return { id: `${kind}-${ts}`, runid: "r1", channelid: "c1", ts, kind } as RunEvent;
}

const orchestrator = (over: Partial<Run> = {}) => run({ mode: "orchestrator", dagoref: "D", ...over });
const lead = agent("lead", { runId: "r1" });

function thing(r: Run, agents: AgentVM[] = [lead], lin: Lineage = lineage(), extra = {}): RunThing {
    return buildRunThing({ channelId: "c1", run: r }, agents, lin, extra);
}
function applies(id: string, t: RunThing): boolean {
    const action = RUN_KIND.actions.find((a) => a.id === id);
    if (action == null) {
        throw new Error(`no action ${id}`);
    }
    return action.applies(t);
}
function options(id: string, t: RunThing) {
    const input = RUN_KIND.actions.find((a) => a.id === id)?.input;
    return input?.kind === "pick" ? input.options(t) : [];
}

describe("buildRunThing", () => {
    it("counts every live worker a cancel would stop, DAG task workers included", () => {
        const worker = agent("w1");
        const lin = lineage(info(), { w1: { kind: "worker", leadRunId: "r1", taskId: "t1" } });
        const t = thing(orchestrator(), [lead, worker, agent("idle", { state: "idle" })], lin);
        expect(t.liveCount).toBe(2);
        expect(t.info?.runId).toBe("r1");
    });
});

describe("RUN_KIND.entries", () => {
    it("lists every project's runs keyed run:<id> with the goal as title", () => {
        const store = createStore();
        store.set(allRunsAtom, [
            { channelId: "c1", run: run() },
            { channelId: "c2", run: run({ id: "r2", oid: "r2", goal: "" }) },
        ]);
        const model = { agentsAtom: atom([lead]), lineageAtom: atom(lineage()) } as unknown as AgentsViewModel;
        const entries = RUN_KIND.entries(store.get, model);
        expect(entries.map((e) => [e.key, e.title])).toEqual([
            ["run:r1", "Ship auth"],
            ["run:r2", "(untitled run)"],
        ]);
        expect(entries[1].thing.channelId).toBe("c2");
    });
});

describe("run actions", () => {
    it("open in Jarvis always applies", () => {
        expect(applies("run:open", thing(run({ status: "done" }), []))).toBe(true);
    });

    it("the DAG opens only with a dag", () => {
        expect(applies("run:dag", thing(orchestrator(), [lead], lineage(info())))).toBe(true);
        expect(applies("run:dag", thing(orchestrator(), [lead], lineage(info({ dag: undefined }))))).toBe(false);
        expect(applies("run:dag", thing(orchestrator()))).toBe(false);
    });

    it("the diff opens where the run sheet offers it: a done run's parsed report or sealed evidence", () => {
        const evidence = { addtotal: 1, deltotal: 0 } as RunEvidence;
        expect(applies("run:diff", thing(run({ status: "done", evidence })))).toBe(true);
        expect(applies("run:diff", thing(run({ status: "done" })))).toBe(false);
        expect(applies("run:diff", thing(run({ evidence })))).toBe(false);
    });

    it("the lead's terminal opens for a live orchestrator's lead", () => {
        expect(applies("run:lead-terminal", thing(orchestrator()))).toBe(true);
        expect(applies("run:lead-terminal", thing(orchestrator({ status: "done" })))).toBe(false);
        expect(applies("run:lead-terminal", thing(run()))).toBe(false);
    });

    it("the lead takes a message while a live lead has a terminal", () => {
        expect(applies("run:message", thing(orchestrator()))).toBe(true);
        expect(applies("run:message", thing(orchestrator({ status: "cancelled" })))).toBe(false);
        expect(applies("run:message", thing(orchestrator(), [agent("lead", { blockId: "" })]))).toBe(false);
    });

    it("workers at once adjusts an unfinished engine run", () => {
        const lin = lineage(info());
        expect(applies("run:workers", thing(orchestrator(), [lead], lin))).toBe(true);
        const finished = lineage(info({ dag: { ...info().dag, status: "done" } }));
        expect(applies("run:workers", thing(orchestrator(), [lead], finished))).toBe(false);
        expect(applies("run:workers", thing(orchestrator()))).toBe(false);
        expect(options("run:workers", thing(orchestrator(), [lead], lin)).map((o) => o.value)).toEqual([
            "1",
            "2",
            "3",
            "4",
            "5",
            "6",
            "7",
            "8",
        ]);
    });

    it("relaunch applies only while the lead is down", () => {
        const down = { events: [ev("lead-wake-failed", 10)] };
        expect(applies("run:relaunch", thing(orchestrator(), [lead], lineage(), down))).toBe(true);
        const back = { events: [ev("lead-wake-failed", 10), ev("lead-launched", 20)] };
        expect(applies("run:relaunch", thing(orchestrator(), [lead], lineage(), back))).toBe(false);
        expect(applies("run:relaunch", thing(orchestrator()))).toBe(false);
    });

    it("a refused relaunch or workers change rejects, so the palette shows it for runs off the grid", async () => {
        const action = (id: string) => RUN_KIND.actions.find((a) => a.id === id);
        vi.spyOn(RpcApi, "DagActionCommand").mockRejectedValueOnce(new Error("lead is live"));
        await expect(action("run:relaunch").run(thing(orchestrator()), { model: null }, undefined)).rejects.toThrow(
            /lead is live/
        );
        vi.spyOn(RpcApi, "SetRunSettingsCommand").mockRejectedValueOnce(new Error("run finished"));
        const lin = lineage(info());
        await expect(
            action("run:workers").run(thing(orchestrator(), [lead], lin), { model: null }, "2")
        ).rejects.toThrow(/run finished/);
    });

    it("stop a worker lists a cancelled run's survivors", () => {
        const cancelled = orchestrator({ status: "cancelled" });
        expect(applies("run:stop-worker", thing(cancelled))).toBe(true);
        expect(options("run:stop-worker", thing(cancelled))).toEqual([{ value: "lead", label: "lead" }]);
        expect(applies("run:stop-worker", thing(orchestrator()))).toBe(false);
        expect(applies("run:stop-worker", thing(cancelled, [agent("lead", { state: "idle" })]))).toBe(false);
    });

    it("cancel applies to a live run not already cancelling", () => {
        expect(applies("run:cancel", thing(run()))).toBe(true);
        expect(applies("run:cancel", thing(run({ status: "done" })))).toBe(false);
        expect(applies("run:cancel", thing(run(), [lead], lineage(), { cancelling: true }))).toBe(false);
    });

    it("resume applies only to a failed phase with a session to reopen", () => {
        const failed = run({
            sessionid: "s1",
            runtime: "claude",
            phases: [phase({ state: "failed", workerorefs: ["tab:lead"] })],
        });
        expect(applies("run:resume", thing(failed))).toBe(true);
        expect(applies("run:resume", thing({ ...failed, sessionid: "" }))).toBe(false);
        expect(applies("run:resume", thing({ ...failed, dagoref: "D" }))).toBe(false);
        expect(applies("run:resume", thing(run()))).toBe(false);
    });

    it("ending the final stage applies while it runs", () => {
        const final = lineage(info({ dag: { ...info().dag, final: { state: "verifying" } as FinalStage } }));
        expect(applies("run:end-final-unverified", thing(orchestrator(), [lead], final))).toBe(true);
        expect(applies("run:end-final-failed", thing(orchestrator(), [lead], final))).toBe(true);
        expect(applies("run:end-final-unverified", thing(orchestrator(), [lead], lineage(info())))).toBe(false);
        const cancelled = lineage(
            info({ dag: { ...info().dag, status: "cancelled", final: { state: "verifying" } as FinalStage } })
        );
        expect(applies("run:end-final-failed", thing(orchestrator(), [lead], cancelled))).toBe(false);
    });

    it("refuses to end the final stage without a reason", async () => {
        const action = RUN_KIND.actions.find((a) => a.id === "run:end-final-failed");
        await expect(action.run(thing(orchestrator()), { model: null }, "  ")).rejects.toThrow(/reason/);
    });
});
