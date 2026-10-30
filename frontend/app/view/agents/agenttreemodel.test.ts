import { describe, expect, it } from "vitest";
import type { AgentVM } from "./agentsviewmodel";
import {
    agentsInCouncil,
    buildAgentTree,
    discussTogetherSeats,
    extendRow,
    foldCollapsedProjects,
    NO_ROW_SELECTION,
    pickedRowIds,
    seatableOf,
    selectableRowIds,
    selectOnly,
    stageOutcome,
    stageSubline,
    toggleRow,
    UNGROUPED_PROJECT,
    type AgentTreeRow,
} from "./agenttreemodel";
import type { BuilderCheckRecord } from "./brainstormmodel";
import { seatableAgents } from "./councilsetupmodel";
import { endedWorkerId, type Lineage, type RunInfo } from "./runlineage";

function vm(id: string, state: AgentVM["state"], path?: string): AgentVM {
    return { id, name: id, task: "", state, transcriptPath: path };
}

// transcript paths whose project segment (after "projects/") is the repo dir
const WAVE = "/home/u/.claude/projects/home-u-waveterm/abc.jsonl"; // -> "waveterm"
const LOOM = "/home/u/.claude/projects/home-u-loom/def.jsonl"; // -> "loom"

describe("buildAgentTree", () => {
    it("returns [] for no agents", () => {
        expect(buildAgentTree([], [])).toEqual([]);
    });

    it("emits one group header then its parents", () => {
        const agents = [vm("a", "working", WAVE), vm("b", "idle", WAVE)];
        const rows = buildAgentTree(agents, ["a", "b"]);
        expect(rows.map((r) => r.kind)).toEqual(["group", "parent", "parent"]);
        expect(rows[0]).toMatchObject({ kind: "group", project: "waveterm", count: 2, attn: 0 });
    });

    it("counts asking agents in the group's attn", () => {
        const agents = [vm("a", "asking", WAVE), vm("b", "working", WAVE)];
        const rows = buildAgentTree(agents, ["a", "b"]);
        expect(rows[0]).toMatchObject({ kind: "group", attn: 1 });
    });

    it("groups by project in first-seen order of `order`", () => {
        const agents = [vm("w", "working", WAVE), vm("l", "working", LOOM)];
        const rows = buildAgentTree(agents, ["l", "w"]); // loom first by order
        const groups = rows.filter((r) => r.kind === "group");
        expect(groups.map((g: any) => g.project)).toEqual(["loom", "waveterm"]);
    });

    it("orders parents within a group by `order`; ids absent from order sort last", () => {
        const agents = [vm("a", "working", WAVE), vm("b", "working", WAVE), vm("c", "working", WAVE)];
        const rows = buildAgentTree(agents, ["b", "a"]); // c missing
        const parents = rows.filter((r) => r.kind === "parent") as any[];
        expect(parents.map((p) => p.agent.id)).toEqual(["b", "a", "c"]);
    });

    it("falls back to UNGROUPED_PROJECT when no transcript path", () => {
        const rows = buildAgentTree([vm("a", "idle")], ["a"]);
        expect(rows[0]).toMatchObject({ kind: "group", project: UNGROUPED_PROJECT });
    });
});

describe("buildAgentTree with agents that wait on others", () => {
    const parents = (rows: AgentTreeRow[]) =>
        rows.flatMap((r) =>
            r.kind === "parent"
                ? [`${r.nested ? "  " : ""}${r.agent.id}${r.waitsFor ? ` (waits on ${r.waitsFor})` : ""}`]
                : []
        );

    it("nests each agent that waits under the agent it waits on, in order, and counts it once", () => {
        const agents = ["a", "b", "c", "d"].map((id) => vm(id, "idle", WAVE));
        const rows = buildAgentTree(
            agents,
            ["a", "b", "c", "d"],
            undefined,
            undefined,
            undefined,
            new Map([
                ["a", "c"],
                ["d", "c"],
            ])
        );
        expect(parents(rows)).toEqual(["b", "c", "  a", "  d"]);
        expect(rows[0]).toMatchObject({ kind: "group", count: 4 });
    });

    it("an agent waiting on one in another project stays in its own and says whom it waits on", () => {
        const agents = [vm("w", "idle", WAVE), vm("l", "working", LOOM)];
        const rows = buildAgentTree(agents, ["w", "l"], undefined, undefined, undefined, new Map([["w", "l"]]));
        expect(parents(rows)).toEqual(["w (waits on l)", "l"]);
    });

    it("nests one level: the head of a chain nests, the rest name whom they wait on, and a cycle nests no one", () => {
        const agents = ["a", "b", "c"].map((id) => vm(id, "idle", WAVE));
        const chain = new Map([
            ["a", "b"],
            ["b", "c"],
        ]);
        expect(parents(buildAgentTree(agents, ["a", "b", "c"], undefined, undefined, undefined, chain))).toEqual([
            "a (waits on b)",
            "c",
            "  b",
        ]);
        const cycle = new Map([
            ["a", "b"],
            ["b", "a"],
        ]);
        expect(parents(buildAgentTree(agents, ["a", "b", "c"], undefined, undefined, undefined, cycle))).toEqual([
            "a (waits on b)",
            "b (waits on a)",
            "c",
        ]);
    });

    it("a wait on an agent gone from the roster changes nothing", () => {
        const rows = buildAgentTree(
            [vm("a", "idle", WAVE)],
            ["a"],
            undefined,
            undefined,
            undefined,
            new Map([["a", "x"]])
        );
        expect(parents(rows)).toEqual(["a"]);
    });
});

describe("buildAgentTree with a builder check", () => {
    // the brainstorming agent's tab names its check's run (brainstorm:checkrun); the reviewer's tab is that run's
    const brainstorm = (state: BuilderCheckRecord["state"], runId = "chk-1"): AgentVM => ({
        ...vm("bs", "idle", WAVE),
        builderCheck: { state, ts: 1, runId },
    });
    const reviewer = (state: AgentVM["state"] = "working", path = WAVE): AgentVM => ({
        ...vm("rv", state, path),
        runId: "chk-1",
    });
    const shape = (rows: AgentTreeRow[]) =>
        rows.map((r) =>
            r.kind === "group"
                ? `group:${r.project}:${r.count}:${r.attn}:${r.running}`
                : r.kind === "check"
                  ? `  check:${r.agent.id}:${r.state}`
                  : `${r.kind}:${"agent" in r ? r.agent?.id : ""}`
        );

    it("nests the reviewer under the brainstorm that started it, wherever the roster orders it", () => {
        const rows = buildAgentTree(
            [reviewer(), vm("other", "idle", WAVE), brainstorm("reading")],
            ["rv", "other", "bs"]
        );
        expect(shape(rows)).toEqual(["group:waveterm:3:0:1", "parent:other", "parent:bs", "  check:rv:reading"]);
    });

    it("keeps the reviewer under the brainstorm after the check answers or fails", () => {
        for (const state of ["answered", "failed"] as const) {
            const rows = buildAgentTree([brainstorm(state), reviewer("idle")], ["bs", "rv"]);
            expect(shape(rows)).toEqual(["group:waveterm:2:0:0", "parent:bs", `  check:rv:${state}`]);
        }
    });

    it("gives the reviewer its own row once the brainstorm's tab is gone", () => {
        const rows = buildAgentTree([reviewer(), vm("other", "idle", WAVE)], ["rv", "other"]);
        expect(shape(rows)).toEqual(["group:waveterm:2:0:1", "parent:rv", "parent:other"]);
    });

    it("gives the reviewer its own row when the brainstorm's record names another check", () => {
        const rows = buildAgentTree([brainstorm("reading", "chk-2"), reviewer()], ["bs", "rv"]);
        expect(shape(rows)).toEqual(["group:waveterm:2:0:1", "parent:bs", "parent:rv"]);
    });

    it("counts the reviewer in the brainstorm's group, and in its attn while it asks", () => {
        const rows = buildAgentTree([brainstorm("reading"), reviewer("asking")], ["bs", "rv"]);
        expect(shape(rows)).toEqual(["group:waveterm:2:1:0", "parent:bs", "  check:rv:reading"]);
    });

    it("draws the reviewer in the brainstorm's group, leaving no group for its own project", () => {
        const rows = buildAgentTree([brainstorm("reading"), reviewer("working", LOOM)], ["rv", "bs"]);
        expect(shape(rows)).toEqual(["group:waveterm:2:0:1", "parent:bs", "  check:rv:reading"]);
    });

    it("leaves the reviewer its own row when the brainstorm's row is a run's", () => {
        const r: RunInfo = { runId: "run-1", channelId: "ch", title: "t", project: "waveterm" };
        const rows = buildAgentTree([brainstorm("reading"), reviewer()], ["bs", "rv"], {
            roles: { bs: { kind: "lead", runId: "run-1" } },
            runs: { "run-1": r },
        });
        expect(shape(rows)).toEqual(["group:waveterm:2:0:1", "lead:bs", "parent:rv"]);
    });

    it("keeps the reviewer right under its brainstorm when that agent itself nests under one it waits on", () => {
        const agents = [vm("a", "idle", WAVE), brainstorm("reading"), reviewer()];
        const rows = buildAgentTree(agents, ["a", "bs", "rv"], undefined, undefined, undefined, new Map([["bs", "a"]]));
        expect(shape(rows)).toEqual(["group:waveterm:3:0:1", "parent:a", "parent:bs", "  check:rv:reading"]);
        expect(rows[2]).toMatchObject({ kind: "parent", nested: true });
    });
});

describe("buildAgentTree with a brainstorm judge", () => {
    // the brainstorming agent's tab names its judge's run (brainstorm:judgerun) as it names its check's
    const brainstorm = (judge?: BuilderCheckRecord, check?: BuilderCheckRecord): AgentVM => ({
        ...vm("bs", "idle", WAVE),
        ...(judge ? { brainstormJudge: judge } : {}),
        ...(check ? { builderCheck: check } : {}),
    });
    const session = (id: string, runId: string, state: AgentVM["state"] = "working"): AgentVM => ({
        ...vm(id, state, WAVE),
        runId,
    });
    const shape = (rows: AgentTreeRow[]) =>
        rows.map((r) =>
            r.kind === "group"
                ? `group:${r.project}:${r.count}:${r.attn}`
                : r.kind === "check"
                  ? `  check:${r.agent.id}:${r.stageRole}:${r.state}`
                  : `${r.kind}:${"agent" in r ? r.agent?.id : ""}`
        );

    it("nests the judge's session under the agent whose record names its run, with the judge's role and state", () => {
        const rows = buildAgentTree(
            [session("jd", "jdg-1"), brainstorm({ state: "reading", ts: 1, runId: "jdg-1" })],
            ["jd", "bs"]
        );
        expect(shape(rows)).toEqual(["group:waveterm:2:0", "parent:bs", "  check:jd:brainstorm-judge:reading"]);
        for (const state of ["answered", "failed", "stopped"] as const) {
            const later = buildAgentTree(
                [brainstorm({ state, ts: 1, runId: "jdg-1" }), session("jd", "jdg-1", "idle")],
                ["bs", "jd"]
            );
            expect(shape(later)).toEqual(["group:waveterm:2:0", "parent:bs", `  check:jd:brainstorm-judge:${state}`]);
        }
    });

    it("nests both sessions under one agent that holds both records, each with its own role and state", () => {
        const rows = buildAgentTree(
            [
                session("rv", "chk-1"),
                session("jd", "jdg-1"),
                brainstorm({ state: "answered", ts: 1, runId: "jdg-1" }, { state: "reading", ts: 1, runId: "chk-1" }),
            ],
            ["rv", "jd", "bs"]
        );
        expect(shape(rows)).toEqual([
            "group:waveterm:3:0",
            "parent:bs",
            "  check:rv:builder-check:reading",
            "  check:jd:brainstorm-judge:answered",
        ]);
    });

    it("gives the judge's session a plain row once the brainstorming agent is gone", () => {
        const rows = buildAgentTree([session("jd", "jdg-1"), vm("other", "idle", WAVE)], ["jd", "other"]);
        expect(shape(rows)).toEqual(["group:waveterm:2:0", "parent:jd", "parent:other"]);
    });

    it("counts the judge in the agent's group, and in its attn while it asks", () => {
        const rows = buildAgentTree(
            [brainstorm({ state: "reading", ts: 1, runId: "jdg-1" }), session("jd", "jdg-1", "asking")],
            ["bs", "jd"]
        );
        expect(shape(rows)).toEqual(["group:waveterm:2:1", "parent:bs", "  check:jd:brainstorm-judge:reading"]);
    });
});

describe("buildAgentTree with run lineage", () => {
    const task = (id: string, state: string): TaskNode => ({ id, label: id, state }) as TaskNode;
    const run = (runId: string, tasks: TaskNode[], digest?: DagStatusDigest): RunInfo => ({
        runId,
        channelId: "ch",
        title: "Resource linking",
        project: "waveterm",
        dag: { oid: "dag-1", runid: runId, tasks } as TaskGroup,
        digest,
    });
    // a worker's own project is the engine's empty spawn name, so nesting must not depend on it
    const agent = (id: string, state: AgentVM["state"], project = "waveterm"): AgentVM => ({
        id,
        name: id,
        task: "",
        state,
        project,
        transcriptPath: project ? undefined : LOOM,
    });
    const lineage = (runs: RunInfo[], roles: Lineage["roles"]): Lineage => ({
        roles,
        runs: Object.fromEntries(runs.map((r) => [r.runId, r])),
    });
    const shape = (rows: AgentTreeRow[]) =>
        rows.map((r) => {
            switch (r.kind) {
                case "group":
                    return `group:${r.project}:${r.count}:${r.attn}`;
                case "worker":
                    return `${r.nested ? "  nested" : "worker"}:${r.task.id}:${r.agent?.id ?? "-"}${r.extras ? `:+${r.extras}${r.extrasOpen ? "v" : ">"}` : ""}`;
                case "done":
                    return `done:${r.count}${r.stages ? `+${r.stages}` : ""}${r.failed ? `!${r.failed}` : ""}:${r.open}`;
                case "queued":
                    return `${r.kind}:${r.count}:${r.open}`;
                case "parent":
                    return `parent:${r.agent.id}`;
                case "check":
                    return `check:${r.agent.id}:${r.state}`;
                case "stage":
                    return `stage:${r.stageRole}:${r.agent.id}${r.lens ? `@${r.lens}` : ""}${r.outcome ? `:${r.outcome}` : ""}`;
                case "final":
                    return `final:${r.agent?.id ?? "-"}`;
                default:
                    return `${r.kind}:${r.run.runId}:${r.live}`;
            }
        });

    it("keeps a row for a task whose worker's tab was reaped while its merge verifies", () => {
        const r = run("run-1", [
            task("t-1", "verifying"),
            task("t-2", "running"),
            task("t-3", "skipped"),
            task("t-4", "pending"),
        ]);
        const rows = buildAgentTree(
            [agent("lead", "working"), agent("w2", "working", "")],
            ["lead", "w2"],
            lineage([r], {
                lead: { kind: "lead", runId: "run-1" },
                w2: { kind: "worker", leadRunId: "run-1", taskId: "t-2" },
            })
        );
        // the verifying task is under way but has no session, so it is not counted as an agent
        expect(shape(rows)).toEqual([
            "group:waveterm:2:0",
            "lead:run-1:2",
            "worker:t-1:-",
            "worker:t-2:w2",
            "queued:1:false",
        ]);
    });

    it("nests the engine's stage sessions under their run, between its tasks and its queued fold", () => {
        const r = run("run-1", [task("t-1", "pending")]);
        const rows = buildAgentTree(
            [agent("lead", "idle"), agent("rev", "working", "")],
            ["rev", "lead"],
            lineage([r], {
                lead: { kind: "lead", runId: "run-1" },
                rev: { kind: "stage", leadRunId: "run-1", stageRole: "plan-reviewer" },
            })
        );
        expect(shape(rows)).toEqual([
            "group:waveterm:2:0",
            "lead:run-1:1",
            "stage:plan-reviewer:rev",
            "queued:1:false",
        ]);
    });

    it("places a stage session's run in its place when the lead is not in the roster", () => {
        const r = run("run-1", [task("t-1", "done")]);
        const rows = buildAgentTree(
            [agent("ver", "working", "")],
            ["ver"],
            lineage([r], { ver: { kind: "stage", leadRunId: "run-1", stageRole: "verifier" } })
        );
        expect(shape(rows)).toEqual(["group:waveterm:1:0", "run:run-1:1", "done:1:false", "stage:verifier:ver"]);
    });

    describe("a stage session with a verdict", () => {
        const stageAgent = (id: string, runId: string) => ({ ...agent(id, "idle", ""), runId });
        // run 6c7652be's shape: round 1's plan review failed, round 2's follow-up passed, the final verifier is judging
        const finishing = () => {
            const r = run("run-1", [task("t-1", "done"), task("t-2", "done")]);
            r.dag.planreview = {
                state: "passed",
                round: 2,
                reviewers: [{ lens: "followup", state: "passed", runid: "rv2" }],
            };
            r.dag.final = { state: "final", round: 1, verifierrunid: "ver" };
            const roles: Lineage["roles"] = {
                lead: { kind: "lead", runId: "run-1" },
                rev2: { kind: "stage", leadRunId: "run-1", stageRole: "plan-reviewer" },
                rev1: { kind: "stage", leadRunId: "run-1", stageRole: "plan-reviewer" },
                ver: { kind: "stage", leadRunId: "run-1", stageRole: "verifier" },
            };
            const agents = [
                agent("lead", "idle"),
                stageAgent("rev2", "rv2"),
                stageAgent("rev1", "rv1"),
                { ...stageAgent("ver", "ver"), state: "working" as const },
            ];
            return { r, roles, agents };
        };

        it("folds into the done fold, and only a stage still judging counts as live", () => {
            const { r, roles, agents } = finishing();
            const rows = buildAgentTree(agents, ["lead", "rev2", "rev1", "ver"], lineage([r], roles));
            expect(shape(rows)).toEqual(["group:waveterm:2:0", "lead:run-1:1", "done:2+2:false", "final:ver"]);
        });

        it("lists the plan reviews oldest round first, before the tasks, and a final verdict after them", () => {
            const { r, roles, agents } = finishing();
            r.dag.final = { state: "passed", round: 1, verifierrunid: "ver" };
            const folds = {
                collapsed: new Set<string>(),
                doneOpen: new Map([["run-1", 2]]),
                queuedOpen: new Set<string>(),
                extrasOpen: new Set<string>(),
            };
            const rows = buildAgentTree(agents, ["lead", "rev2", "rev1", "ver"], lineage([r], roles), folds);
            expect(shape(rows)).toEqual([
                "group:waveterm:1:0",
                "lead:run-1:0",
                "done:2+3:true",
                "stage:plan-reviewer:rev1:failed",
                "stage:plan-reviewer:rev2@followup:passed",
                "worker:t-1:-",
                "worker:t-2:-",
                "final:ver",
            ]);
        });

        it("reads an earlier final round's verifier as failed", () => {
            const r = run("run-1", [task("t-1", "done")]);
            r.dag.final = { state: "final", round: 2, verifierrunid: "ver2" };
            const rows = buildAgentTree(
                [stageAgent("ver1", "ver1"), { ...stageAgent("ver2", "ver2"), state: "working" as const }],
                ["ver1", "ver2"],
                lineage([r], {
                    ver1: { kind: "stage", leadRunId: "run-1", stageRole: "verifier" },
                    ver2: { kind: "stage", leadRunId: "run-1", stageRole: "verifier" },
                })
            );
            expect(shape(rows)).toEqual(["group:waveterm:1:0", "run:run-1:1", "done:1+1:false", "final:ver2"]);
        });

        it("marks the done fold failed while a failed plan review has no later round", () => {
            const r = run("run-1", [task("t-1", "pending")]);
            r.dag.planreview = {
                state: "failed",
                round: 1,
                reviewers: [{ lens: "full", state: "failed", runid: "rv1" }],
            };
            const roles: Lineage["roles"] = {
                lead: { kind: "lead", runId: "run-1" },
                rev1: { kind: "stage", leadRunId: "run-1", stageRole: "plan-reviewer" },
            };
            const agents = [agent("lead", "idle"), stageAgent("rev1", "rv1")];
            expect(shape(buildAgentTree(agents, ["lead", "rev1"], lineage([r], roles)))).toEqual([
                "group:waveterm:1:0",
                "lead:run-1:0",
                "done:0+1!1:false",
                "queued:1:false",
            ]);
            // the next round replaces it, so the fold no longer counts it failed
            r.dag.planreview = {
                state: "reviewing",
                round: 2,
                reviewers: [{ lens: "followup", state: "reviewing", runid: "rv2" }],
            };
            const next = [...agents, stageAgent("rev2", "rv2")];
            roles.rev2 = { kind: "stage", leadRunId: "run-1", stageRole: "plan-reviewer" };
            expect(shape(buildAgentTree(next, ["lead", "rev1", "rev2"], lineage([r], roles)))).toContain(
                "done:0+1:false"
            );
        });

        describe("a plan reviewer", () => {
            const reviewing = (round: number, reviewers: PlanReviewer[]) => {
                const r = run("run-1", [task("t-1", "pending")]);
                r.dag.planreview = { state: "reviewing", round, reviewers };
                return r;
            };
            const roundOne: PlanReviewer[] = [
                { lens: "full", state: "passed", runid: "rv-full" },
                { lens: "spec", state: "failed", runid: "rv-spec" },
                { lens: "order", state: "lost", runid: "rv-order" },
                { lens: "tests", state: "reviewing", runid: "rv-tests" },
                { lens: "final", state: "passed", runid: "rv-final" },
            ];

            it("reads its own verdict, a lost one as failed and one still reviewing as none", () => {
                const r = reviewing(1, roundOne);
                expect(roundOne.map((rv) => stageOutcome(r, "plan-reviewer", rv.runid))).toEqual([
                    "passed",
                    "failed",
                    "failed",
                    undefined,
                    "passed",
                ]);
            });

            it("reads a round-1 reviewer as failed in round 2, whatever its own verdict was", () => {
                const r = reviewing(2, [{ lens: "followup", state: "reviewing", runid: "rv-followup" }]);
                expect(stageOutcome(r, "plan-reviewer", "rv-full")).toBe("failed");
                expect(stageOutcome(r, "plan-reviewer", "rv-followup")).toBeUndefined();
            });

            it("names its lens on its row", () => {
                const r = reviewing(1, roundOne);
                const ids = ["lead", "full", "spec"];
                const rows = buildAgentTree(
                    [agent("lead", "idle"), stageAgent("full", "rv-full"), stageAgent("spec", "rv-spec")],
                    ids,
                    lineage([r], {
                        lead: { kind: "lead", runId: "run-1" },
                        full: { kind: "stage", leadRunId: "run-1", stageRole: "plan-reviewer" },
                        spec: { kind: "stage", leadRunId: "run-1", stageRole: "plan-reviewer" },
                    }),
                    {
                        collapsed: new Set<string>(),
                        doneOpen: new Map([["run-1", 0]]),
                        queuedOpen: new Set<string>(),
                        extrasOpen: new Set<string>(),
                    }
                );
                expect(shape(rows).filter((s) => s.startsWith("stage:"))).toEqual([
                    "stage:plan-reviewer:spec@spec:failed",
                    "stage:plan-reviewer:full@full:passed",
                ]);
            });
        });

        it("stays live while the dag has no verdict for it", () => {
            const r = run("run-1", [task("t-1", "pending")]);
            r.dag.planreview = { state: "reviewing", round: 1 };
            const rows = buildAgentTree(
                [agent("lead", "idle"), stageAgent("rev1", "rv1")],
                ["lead", "rev1"],
                lineage([r], {
                    lead: { kind: "lead", runId: "run-1" },
                    rev1: { kind: "stage", leadRunId: "run-1", stageRole: "plan-reviewer" },
                })
            );
            expect(shape(rows)).toEqual([
                "group:waveterm:2:0",
                "lead:run-1:1",
                "stage:plan-reviewer:rev1",
                "queued:1:false",
            ]);
        });
    });

    // a land resolver gives no verdict on the dag: its run's land says how it went
    describe("a land resolver session", () => {
        const roles: Lineage["roles"] = {
            lead: { kind: "lead", runId: "run-1" },
            res: { kind: "stage", leadRunId: "run-1", stageRole: "land-resolver" },
        };
        const resolver = (state: AgentVM["state"]) => ({ ...agent("res", state, ""), runId: "rs1" });
        const landing = (land: RunLand | undefined) => {
            const r = run("run-1", [task("t-1", "done")]);
            r.land = land;
            return r;
        };
        const doneOpen = {
            collapsed: new Set<string>(),
            doneOpen: new Map([["run-1", 1]]),
            queuedOpen: new Set<string>(),
            extrasOpen: new Set<string>(),
        };

        it("is at work while its land is resolving it, and counts toward the run's live", () => {
            const r = landing({ state: "resolving", resolver: "rs1", resolvertried: true });
            const rows = buildAgentTree(
                [agent("lead", "idle"), resolver("working")],
                ["lead", "res"],
                lineage([r], roles)
            );
            expect(shape(rows)).toEqual([
                "group:waveterm:2:0",
                "lead:run-1:1",
                "done:1:false",
                "stage:land-resolver:res",
            ]);
        });

        it("is a failed stage in the done fold once its land is held for a human", () => {
            const r = landing({ state: "held", resolvertried: true, conflicts: ["CHANGELOG.md"] });
            const rows = buildAgentTree(
                [agent("lead", "idle"), resolver("idle")],
                ["lead", "res"],
                lineage([r], roles),
                doneOpen
            );
            expect(shape(rows)).toEqual([
                "group:waveterm:1:0",
                "lead:run-1:0",
                "done:1+1:true",
                "worker:t-1:-",
                "stage:land-resolver:res:failed",
            ]);
        });

        it.each(["queued", "pending", "landed"])("is a passed stage once its land is %s", (state) => {
            const r = landing({ state, resolvertried: true });
            const rows = buildAgentTree(
                [agent("lead", "idle"), resolver("idle")],
                ["lead", "res"],
                lineage([r], roles),
                doneOpen
            );
            expect(shape(rows)).toEqual([
                "group:waveterm:1:0",
                "lead:run-1:0",
                "done:1+1:true",
                "worker:t-1:-",
                "stage:land-resolver:res:passed",
            ]);
        });

        it("reads its outcome from the land, whatever round the final stage is on", () => {
            const outcome = (land: RunLand | undefined, runId: string | undefined = "rs1") => {
                const r = landing(land);
                r.dag.final = { state: "final", round: 2, verifierrunid: "ver2" };
                return stageOutcome(r, "land-resolver", runId);
            };
            expect(outcome({ state: "resolving", resolver: "rs1", resolvertried: true })).toBeUndefined();
            expect(outcome({ state: "held", resolvertried: true })).toBe("failed");
            expect(outcome({ state: "queued", resolvertried: true })).toBe("passed");
            expect(outcome({ state: "pending", resolvertried: true })).toBe("passed");
            expect(outcome({ state: "landed", resolvertried: true })).toBe("passed");
        });

        it("reads a resolver the land no longer names as failed, and one it cannot read as at work", () => {
            const r = landing({ state: "resolving", resolver: "rs2", resolvertried: true });
            expect(stageOutcome(r, "land-resolver", "rs1")).toBe("failed");
            expect(stageOutcome(landing(undefined), "land-resolver", "rs1")).toBeUndefined();
            expect(stageOutcome(landing({ state: "landed" }), "land-resolver", undefined)).toBeUndefined();
        });

        it("leaves a plan reviewer and a verifier reading the dag, whatever the land says", () => {
            const r = landing({ state: "queued", resolvertried: true });
            r.dag.planreview = {
                state: "failed",
                round: 1,
                reviewers: [{ lens: "full", state: "failed", runid: "rv1" }],
            };
            r.dag.final = { state: "passed", round: 1, verifierrunid: "ver" };
            expect(stageOutcome(r, "plan-reviewer", "rv1")).toBe("failed");
            expect(stageOutcome(r, "verifier", "ver")).toBe("passed");
        });
    });

    describe("the final stage's row", () => {
        const LEAD: Lineage["roles"] = { lead: { kind: "lead", runId: "run-1" } };
        const VERIFIER: Lineage["roles"][string] = { kind: "stage", leadRunId: "run-1", stageRole: "verifier" };
        const verifierAgent = (id: string, state: AgentVM["state"] = "working") => ({
            ...agent(id, state, ""),
            runId: id,
        });
        const openDone = (count: number) => ({
            collapsed: new Set<string>(),
            doneOpen: new Map([["run-1", count]]),
            queuedOpen: new Set<string>(),
            extrasOpen: new Set<string>(),
        });
        const staged = (tasks: TaskNode[], status: string, final?: FinalStage) => {
            const r = run("run-1", tasks);
            r.dag.status = status;
            r.dag.final = final;
            return r;
        };
        const tree = (r: RunInfo, verifiers: string[] = [], folds?: ReturnType<typeof openDone>, focusId?: string) =>
            shape(
                buildAgentTree(
                    [agent("lead", "idle"), ...verifiers.map((id) => verifierAgent(id))],
                    ["lead", ...verifiers],
                    lineage([r], { ...LEAD, ...Object.fromEntries(verifiers.map((id) => [id, VERIFIER])) }),
                    folds,
                    focusId
                )
            );

        it("is absent while tasks run and the stage has no state", () => {
            const r = staged([task("t-1", "done"), task("t-2", "running")], "running");
            expect(tree(r)).toEqual(["group:waveterm:1:0", "lead:run-1:1", "done:1:false", "worker:t-2:-"]);
        });

        it("is there once the dag is finalizing, before any verifier session", () => {
            const r = staged([task("t-1", "done")], "finalizing", { state: "checking", round: 1, step: "tree" });
            // the stage is live for its lead, and no agent for the group
            expect(tree(r)).toEqual(["group:waveterm:1:0", "lead:run-1:1", "done:1:false", "final:-"]);
        });

        it("is the current round's verifier session once that is in the roster, with no second row", () => {
            const r = staged([task("t-1", "done")], "finalizing", {
                state: "verifying",
                round: 1,
                verifierrunid: "v1",
            });
            const rows = tree(r, ["v1"]);
            expect(rows).toEqual(["group:waveterm:2:0", "lead:run-1:1", "done:1:false", "final:v1"]);
            expect(rows.filter((s) => s.startsWith("final:") || s.startsWith("stage:"))).toHaveLength(1);
        });

        it("leaves an earlier round's verifier tab a failed stage row beside it", () => {
            const r = staged([task("t-1", "done")], "finalizing", {
                state: "verifying",
                round: 2,
                verifierrunid: "v2",
            });
            expect(tree(r, ["v1", "v2"], openDone(1))).toEqual([
                "group:waveterm:2:0",
                "lead:run-1:1",
                "done:1+1:true",
                "worker:t-1:-",
                "stage:verifier:v1:failed",
                "final:v2",
            ]);
        });

        it("folds into the finished group once passed, and is counted there", () => {
            const r = staged([task("t-1", "done")], "done", { state: "passed", round: 1 });
            expect(tree(r)).toEqual(["group:waveterm:1:0", "lead:run-1:0", "done:1+1:false"]);
            expect(tree(r, [], openDone(1))).toEqual([
                "group:waveterm:1:0",
                "lead:run-1:0",
                "done:1+1:true",
                "worker:t-1:-",
                "final:-",
            ]);
        });

        it("keeps the finished group open while the passed row is the one being read", () => {
            const r = staged([task("t-1", "done")], "done", { state: "passed", round: 1 });
            expect(tree(r, [], undefined, "final:run-1")).toContain("final:-");
        });

        it("stays out of the fold, and is not live, when failed or unverified", () => {
            for (const state of ["failed", "unverified"]) {
                const r = staged([task("t-1", "done")], "finalizing", { state, round: 1 });
                expect(tree(r)).toEqual(["group:waveterm:1:0", "lead:run-1:0", "done:1:false", "final:-"]);
            }
        });

        it("has a row while a fix round is under way, after the fix tasks and not live", () => {
            const r = staged([task("t-1", "done"), task("t-2", "running"), task("t-3", "pending")], "running", {
                state: "",
                round: 2,
            });
            expect(tree(r)).toEqual([
                "group:waveterm:1:0",
                "lead:run-1:1",
                "done:1:false",
                "worker:t-2:-",
                "final:-",
                "queued:1:false",
            ]);
        });

        it("counts toward the lead's live only while the stage runs", () => {
            const live = (final: FinalStage) =>
                tree(staged([task("t-1", "done")], "finalizing", final)).find((s) => s.startsWith("lead:"));
            expect(live({ state: "checking", round: 1 })).toBe("lead:run-1:1");
            expect(live({ state: "final", round: 1 })).toBe("lead:run-1:1");
            expect(live({ state: "verifying", round: 1 })).toBe("lead:run-1:1");
            expect(live({ state: "", round: 1 })).toBe("lead:run-1:0");
            expect(live({ state: "failed", round: 1 })).toBe("lead:run-1:0");
            expect(live({ state: "passed", round: 1 })).toBe("lead:run-1:0");
        });
    });

    it("nests the done fold, then live workers in plan order, then a closed queued fold under their lead", () => {
        const r = run("run-1", [
            task("t-1", "done"),
            task("t-2", "running"),
            task("t-3", "running"),
            task("t-4", "pending"),
        ]);
        const agents = [
            agent("w3", "working", ""),
            agent("lead", "working"),
            agent("solo", "idle"),
            agent("w2", "working", ""),
        ];
        const rows = buildAgentTree(
            agents,
            ["w3", "lead", "solo", "w2"],
            lineage([r], {
                lead: { kind: "lead", runId: "run-1" },
                w2: { kind: "worker", leadRunId: "run-1", taskId: "t-2" },
                w3: { kind: "worker", leadRunId: "run-1", taskId: "t-3" },
            })
        );
        expect(shape(rows)).toEqual([
            "group:waveterm:4:0",
            "lead:run-1:2",
            "done:1:false",
            "worker:t-2:w2",
            "worker:t-3:w3",
            "queued:1:false",
            "parent:solo",
        ]);
    });

    it("lists queued tasks when their fold is open", () => {
        const r = run("run-1", [task("t-1", "running"), task("t-2", "pending"), task("t-3", "ready")]);
        const rows = buildAgentTree(
            [agent("lead", "working"), agent("w1", "working", "")],
            ["lead", "w1"],
            lineage([r], {
                lead: { kind: "lead", runId: "run-1" },
                w1: { kind: "worker", leadRunId: "run-1", taskId: "t-1" },
            }),
            { collapsed: new Set(), doneOpen: new Map(), queuedOpen: new Set(["run-1"]), extrasOpen: new Set() }
        );
        expect(shape(rows)).toEqual([
            "group:waveterm:2:0",
            "lead:run-1:1",
            "worker:t-1:w1",
            "queued:2:true",
            "worker:t-2:-",
            "worker:t-3:-",
        ]);
    });

    it("lists done workers when their fold is open, including ones whose session is gone", () => {
        const r = run("run-1", [{ ...task("t-1", "done"), runid: "w1-run" }, task("t-2", "done")]);
        const rows = buildAgentTree(
            [agent("lead", "idle"), { ...agent("w1", "idle", ""), runId: "w1-run" }],
            ["lead", "w1"],
            lineage([r], {
                lead: { kind: "lead", runId: "run-1" },
                w1: { kind: "worker", leadRunId: "run-1", taskId: "t-1" },
            }),
            { collapsed: new Set(), doneOpen: new Map([["run-1", 2]]), queuedOpen: new Set(), extrasOpen: new Set() }
        );
        expect(shape(rows)).toEqual(["group:waveterm:1:0", "lead:run-1:0", "done:2:true", "worker:t-1:w1", "worker:t-2:-"]);
    });

    describe("a done fold opened before a task landed", () => {
        // opened at one done task; t-2 has landed since, and t-3 is still running
        const landed = (focusId?: string) =>
            buildAgentTree(
                [agent("lead", "working"), agent("w3", "working", "")],
                ["lead", "w3"],
                lineage([run("run-1", [task("t-1", "done"), task("t-2", "done"), task("t-3", "running")])], {
                    lead: { kind: "lead", runId: "run-1" },
                    w3: { kind: "worker", leadRunId: "run-1", taskId: "t-3" },
                }),
                {
                    collapsed: new Set(),
                    doneOpen: new Map([["run-1", 1]]),
                    queuedOpen: new Set(),
                    extrasOpen: new Set(),
                },
                focusId
            );

        it("closes, so the landing does not push the live workers down", () => {
            expect(shape(landed())).toEqual(["group:waveterm:2:0", "lead:run-1:1", "done:2:false", "worker:t-3:w3"]);
        });

        it("stays open while the focus is one of its workers", () => {
            expect(shape(landed(endedWorkerId("run-1", "t-1")))).toEqual([
                "group:waveterm:2:0",
                "lead:run-1:1",
                "done:2:true",
                "worker:t-1:-",
                "worker:t-2:-",
                "worker:t-3:w3",
            ]);
        });
    });

    it("hides a collapsed run's workers but still counts them", () => {
        const r = run("run-1", [task("t-1", "running")]);
        const rows = buildAgentTree(
            [agent("lead", "working"), agent("w1", "working", "")],
            ["lead", "w1"],
            lineage([r], {
                lead: { kind: "lead", runId: "run-1" },
                w1: { kind: "worker", leadRunId: "run-1", taskId: "t-1" },
            }),
            { collapsed: new Set(["run-1"]), doneOpen: new Map(), queuedOpen: new Set(), extrasOpen: new Set() }
        );
        expect(shape(rows)).toEqual(["group:waveterm:2:0", "lead:run-1:1"]);
    });

    it("puts a run with no lead in the roster where its first worker would be, in the run's project", () => {
        const r = { ...run("run-2", [task("t-1", "running"), task("t-2", "running")]), project: "accept-ask" };
        const rows = buildAgentTree(
            [agent("solo", "idle"), agent("g2", "working", ""), agent("g1", "working", "")],
            ["solo", "g2", "g1"],
            lineage([r], {
                g1: { kind: "worker", leadRunId: "run-2", taskId: "t-1" },
                g2: { kind: "worker", leadRunId: "run-2", taskId: "t-2" },
            })
        );
        expect(shape(rows)).toEqual([
            "group:waveterm:1:0",
            "parent:solo",
            "group:accept-ask:2:0",
            "run:run-2:2",
            "worker:t-1:g1",
            "worker:t-2:g2",
        ]);
    });

    it("counts a worker as needing you only when the human holds its question", () => {
        const digest = {
            tasks: [
                { taskid: "t-1", waitreason: "lead-ask" },
                { taskid: "t-2", waitreason: "ask" },
            ],
        } as DagStatusDigest;
        const r = run("run-1", [task("t-1", "running"), task("t-2", "running")], digest);
        const rows = buildAgentTree(
            [agent("lead", "working"), agent("w1", "asking", ""), agent("w2", "asking", "")],
            ["lead", "w1", "w2"],
            lineage([r], {
                lead: { kind: "lead", runId: "run-1" },
                w1: { kind: "worker", leadRunId: "run-1", taskId: "t-1" },
                w2: { kind: "worker", leadRunId: "run-1", taskId: "t-2" },
            })
        );
        expect(rows[0]).toMatchObject({ kind: "group", count: 3, attn: 1 });
    });

    it("folds a tab left on a task by an earlier attempt under the task's current worker, closed", () => {
        const r = run("run-1", [{ id: "t-1", label: "t-1", state: "running", runid: "new-run" } as TaskNode]);
        const rows = buildAgentTree(
            [
                agent("lead", "working"),
                { ...agent("old", "idle", ""), runId: "old-run" },
                { ...agent("new", "working", ""), runId: "new-run" },
            ],
            ["lead", "old", "new"],
            lineage([r], {
                lead: { kind: "lead", runId: "run-1" },
                old: { kind: "worker", leadRunId: "run-1", taskId: "t-1" },
                new: { kind: "worker", leadRunId: "run-1", taskId: "t-1" },
            })
        );
        expect(shape(rows)).toEqual(["group:waveterm:2:0", "lead:run-1:1", "worker:t-1:new:+1>"]);
    });

    const reviewing = () =>
        run("run-1", [
            { id: "t-1", label: "t-1", state: "reviewing", runid: "work-run", reviewrunid: "review-run" } as TaskNode,
        ]);
    const reviewRoles = {
        lead: { kind: "lead", runId: "run-1" },
        worker: { kind: "worker", leadRunId: "run-1", taskId: "t-1" },
        reviewer: { kind: "worker", leadRunId: "run-1", taskId: "t-1" },
    } as const;

    it("keeps a task's row on its worker while a reviewer judges it, the reviewer folded beneath", () => {
        const rows = buildAgentTree(
            [
                agent("lead", "working"),
                { ...agent("reviewer", "working", ""), runId: "review-run" },
                { ...agent("worker", "idle", ""), runId: "work-run" },
            ],
            ["lead", "reviewer", "worker"],
            lineage([reviewing()], reviewRoles)
        );
        expect(shape(rows)).toEqual(["group:waveterm:2:0", "lead:run-1:1", "worker:t-1:worker:+1>"]);
    });

    it("lists the reviewer one level down when the task's fold is open", () => {
        const rows = buildAgentTree(
            [
                agent("lead", "working"),
                { ...agent("reviewer", "working", ""), runId: "review-run" },
                { ...agent("worker", "idle", ""), runId: "work-run" },
            ],
            ["lead", "reviewer", "worker"],
            lineage([reviewing()], reviewRoles),
            { collapsed: new Set(), doneOpen: new Map(), queuedOpen: new Set(), extrasOpen: new Set(["run-1:t-1"]) }
        );
        expect(shape(rows)).toEqual([
            "group:waveterm:2:0",
            "lead:run-1:1",
            "worker:t-1:worker:+1v",
            "  nested:t-1:reviewer",
        ]);
    });

    it("opens the fold on its own when a tab in it is asking", () => {
        const rows = buildAgentTree(
            [
                agent("lead", "working"),
                { ...agent("reviewer", "asking", ""), runId: "review-run" },
                { ...agent("worker", "idle", ""), runId: "work-run" },
            ],
            ["lead", "reviewer", "worker"],
            lineage([reviewing()], reviewRoles)
        );
        expect(shape(rows)).toEqual([
            "group:waveterm:2:1",
            "lead:run-1:1",
            "worker:t-1:worker:+1v",
            "  nested:t-1:reviewer",
        ]);
    });

    it("folds a finished reviewer's tab under its done task's ended worker", () => {
        const r = run("run-1", [{ id: "t-1", label: "t-1", state: "done", runid: "work-run" } as TaskNode]);
        const rows = buildAgentTree(
            [{ ...agent("reviewer", "idle", ""), runId: "review-run" }, agent("lead", "idle")],
            ["reviewer", "lead"],
            lineage([r], {
                lead: { kind: "lead", runId: "run-1" },
                reviewer: { kind: "worker", leadRunId: "run-1", taskId: "t-1" },
            }),
            { collapsed: new Set(), doneOpen: new Map([["run-1", 1]]), queuedOpen: new Set(), extrasOpen: new Set() }
        );
        expect(shape(rows)).toEqual(["group:waveterm:1:0", "lead:run-1:0", "done:1:true", "worker:t-1:-:+1>"]);
    });

    it("keeps an agent whose run is not loaded as a plain row", () => {
        const rows = buildAgentTree(
            [agent("w1", "working")],
            ["w1"],
            lineage([], { w1: { kind: "worker", leadRunId: "gone", taskId: "t-1" } })
        );
        expect(shape(rows)).toEqual(["group:waveterm:1:0", "parent:w1"]);
    });
});

describe("stageSubline", () => {
    it("says the verdict and the age, not the role the title already names", () => {
        expect(stageSubline("passed", "14m")).toBe("passed · 14m");
    });
    it("says a builder check's own word for its state in the verdict's place", () => {
        expect(stageSubline("reading", "2m")).toBe("reading · 2m");
    });
    it("is just the age while the stage is judging", () => {
        expect(stageSubline(undefined, "2m")).toBe("2m");
    });
});

describe("foldCollapsedProjects", () => {
    // waveterm: a (idle), b (asking); loom: c (idle)
    const rows = buildAgentTree(
        [vm("a", "idle", WAVE), vm("b", "asking", WAVE), vm("c", "idle", LOOM)],
        ["a", "b", "c"]
    );
    it("keeps every row when nothing is collapsed", () => {
        expect(foldCollapsedProjects(rows, new Set())).toEqual(rows);
    });
    it("drops a collapsed project's body but keeps its group row and its attention", () => {
        const out = foldCollapsedProjects(rows, new Set(["waveterm"]));
        expect(out.map((r) => (r.kind === "group" ? `g:${r.project}` : r.kind))).toEqual([
            "g:waveterm",
            "g:loom",
            "parent",
        ]);
        expect(out[0]).toMatchObject({ kind: "group", project: "waveterm", count: 2, attn: 1 });
    });
});

describe("row multi-selection", () => {
    // five agent rows, a to e, in the order drawn
    const rows = ["a", "b", "c", "d", "e"];

    it("selectableRowIds takes a plain agent's and a lead's row, in order, and nothing else", () => {
        const tree = buildAgentTree(
            [vm("a", "idle", WAVE), vm("lead", "working", WAVE), vm("w", "working", WAVE), vm("c", "idle", LOOM)],
            ["a", "lead", "w", "c"],
            {
                runs: { r1: { runId: "r1", channelId: "ch", project: "waveterm", title: "run" } as RunInfo },
                roles: { lead: { kind: "lead", runId: "r1" }, w: { kind: "worker", leadRunId: "r1", taskId: "t1" } },
            } as unknown as Lineage
        );
        expect(selectableRowIds(tree)).toEqual(["a", "lead", "c"]);
        expect(selectableRowIds([{ kind: "terminal" }, { kind: "group" }, { kind: "parent" }])).toEqual([]);
    });

    it("a plain click selects one row, clears the rest and is the anchor", () => {
        expect(selectOnly("c")).toEqual({ ids: [], anchor: "c" });
        expect(NO_ROW_SELECTION).toEqual({ ids: [], anchor: null });
    });

    describe("Ctrl/Cmd+click", () => {
        it("starts from the focused agent's row, so the second row makes two", () => {
            const sel = toggleRow(selectOnly("a"), "c", "a", rows);
            expect(sel).toEqual({ ids: ["a", "c"], anchor: "c" });
        });

        it("starts from the row alone when nothing is focused, or the focus is no agent row", () => {
            expect(toggleRow(NO_ROW_SELECTION, "b", null, rows)).toEqual({ ids: ["b"], anchor: "b" });
            expect(toggleRow(NO_ROW_SELECTION, "b", "a-terminal", rows)).toEqual({ ids: ["b"], anchor: "b" });
        });

        it("adds a row in the order picked, and takes a picked row off again", () => {
            let sel = toggleRow(NO_ROW_SELECTION, "d", "d", rows);
            sel = toggleRow(sel, "a", "d", rows);
            sel = toggleRow(sel, "c", "d", rows);
            expect(sel.ids).toEqual(["d", "a", "c"]);
            sel = toggleRow(sel, "a", "d", rows);
            expect(sel).toEqual({ ids: ["d", "c"], anchor: "a" });
        });

        it("does not seed the focused agent again once it was toggled off", () => {
            let sel = toggleRow(selectOnly("a"), "b", "a", rows); // a, b
            sel = toggleRow(sel, "a", "a", rows); // b
            expect(sel.ids).toEqual(["b"]);
            sel = toggleRow(sel, "b", "a", rows); // none
            expect(sel.ids).toEqual([]);
            // empty again: the focus row seeds the next pick, as the first time
            expect(toggleRow(sel, "c", "a", rows).ids).toEqual(["a", "c"]);
        });

        it("leaves a row that is no agent row alone, and drops picked rows that are gone", () => {
            const sel = { ids: ["a", "x"], anchor: "a" };
            expect(toggleRow(sel, "terminal-1", "a", rows)).toBe(sel);
            expect(toggleRow(sel, "c", "a", rows).ids).toEqual(["a", "c"]);
        });
    });

    describe("Shift+click", () => {
        it("takes the rows from the last clicked row through the clicked one, in the order drawn", () => {
            expect(extendRow(selectOnly("b"), "d", "b", rows)).toEqual({ ids: ["b", "c", "d"], anchor: "b" });
            // upwards too
            expect(extendRow(selectOnly("d"), "b", "d", rows)).toEqual({ ids: ["b", "c", "d"], anchor: "d" });
        });

        it("keeps the anchor, so the next one ranges from the same row and replaces the last range", () => {
            let sel = extendRow(selectOnly("b"), "e", "b", rows);
            expect(sel.ids).toEqual(["b", "c", "d", "e"]);
            sel = extendRow(sel, "c", "b", rows);
            expect(sel).toEqual({ ids: ["b", "c"], anchor: "b" });
        });

        it("ranges from the last Ctrl/Cmd+clicked row", () => {
            const sel = toggleRow(selectOnly("a"), "c", "a", rows); // a, c; anchor c
            expect(extendRow(sel, "e", "a", rows).ids).toEqual(["c", "d", "e"]);
        });

        it("falls back to the focused agent when the anchor is gone, and to the row itself when neither is there", () => {
            expect(extendRow({ ids: [], anchor: "x" }, "c", "a", rows).ids).toEqual(["a", "b", "c"]);
            expect(extendRow(NO_ROW_SELECTION, "c", null, rows)).toEqual({ ids: ["c"], anchor: "c" });
        });

        it("leaves a row that is no agent row alone", () => {
            const sel = selectOnly("a");
            expect(extendRow(sel, "terminal-1", "a", rows)).toBe(sel);
        });
    });

    describe("pickedRowIds", () => {
        it("is the multi-selection's rows that are still in the tree", () => {
            expect(pickedRowIds({ ids: ["c", "x", "a"], anchor: "a" }, "b", rows)).toEqual(["c", "a"]);
        });
        it("is the focused agent alone with no multi-selection, and nothing when that is no agent row", () => {
            expect(pickedRowIds(NO_ROW_SELECTION, "b", rows)).toEqual(["b"]);
            expect(pickedRowIds(selectOnly("c"), "b", rows)).toEqual(["b"]);
            expect(pickedRowIds(NO_ROW_SELECTION, "terminal-1", rows)).toEqual([]);
            expect(pickedRowIds(NO_ROW_SELECTION, undefined, rows)).toEqual([]);
        });
        it("falls back to the focused agent when every picked row has gone", () => {
            expect(pickedRowIds({ ids: ["x", "y"], anchor: "x" }, "b", rows)).toEqual(["b"]);
        });
    });
});

describe("Discuss together", () => {
    const roots = new Map([
        ["waveterm", "D:\\code\\waveterm"],
        ["loom", "/home/u/loom"],
    ]);
    // a live claude or pi agent in a project, holding 62.5% of a 1M window
    const live = (id: string, over: Partial<AgentVM> = {}): AgentVM => ({
        ...vm(id, "working"),
        agent: "claude",
        project: "waveterm",
        usage: { contextpct: 62.5, contextmax: 1_000_000 },
        ...over,
    });

    describe("seatableOf", () => {
        it("makes a seat of a claude or pi agent: its project's path, harness and the tokens in its context now", () => {
            expect(seatableOf(live("a"), roots)).toEqual({
                id: "a",
                name: "a",
                project: "D:\\code\\waveterm",
                harness: "claude",
                context: 625_000,
            });
            expect(seatableOf(live("p", { agent: "pi", project: "loom", usage: { contextpct: 21 } }), roots)).toEqual({
                id: "p",
                name: "p",
                project: "/home/u/loom",
                harness: "pi",
                // no window size known: the context cannot be priced
                context: 0,
            });
        });

        it("refuses a terminal, a background agent and any other harness", () => {
            expect(seatableOf(live("t", { kind: "terminal" }), roots)).toBeNull();
            expect(seatableOf(live("b", { kind: "background" }), roots)).toBeNull();
            expect(seatableOf(live("c", { agent: "codex" }), roots)).toBeNull();
            expect(seatableOf(live("o", { agent: "opencode" }), roots)).toBeNull();
            expect(seatableOf(live("n", { agent: undefined }), roots)).toBeNull();
        });

        it("takes where the agent runs when its project is not registered, and refuses one with no path at all", () => {
            expect(seatableOf(live("a", { project: "elsewhere", cwd: "/work/x" }), roots)?.project).toBe("/work/x");
            expect(seatableOf(live("a", { project: "elsewhere" }), roots)).toBeNull();
            expect(seatableOf(live("a", { project: undefined }), roots)).toBeNull();
        });

        // one seat rule: Setup's seatableAgents, which the tree asks with no council project to fall back on
        it("seats what Setup's rule seats, with the same project path", () => {
            const registry = Object.fromEntries([...roots].map(([name, path]) => [name, { path }]));
            const cases = [
                live("reg"),
                live("cwd", { project: "elsewhere", cwd: "/work/x" }),
                live("both", { cwd: "/work/y" }),
                live("none", { project: "elsewhere" }),
                live("term", { kind: "terminal" }),
                // no project name of its own: the one its transcript sits under
                live("tp", { project: undefined, transcriptPath: "/home/u/.claude/projects/home-u-loom/def.jsonl" }),
            ];
            for (const a of cases) {
                const [setup] = seatableAgents([a], registry, "");
                expect(seatableOf(a, roots)).toEqual(setup?.project ? setup : null);
            }
            expect(seatableOf(cases[2], roots)?.project).toBe("D:\\code\\waveterm");
            expect(seatableOf(cases[5], roots)?.project).toBe("/home/u/loom");
        });
    });

    describe("discussTogetherSeats", () => {
        const agents = [
            live("a"),
            live("b", { agent: "pi", project: "loom" }),
            live("c", { agent: "codex" }),
            live("d"),
        ];

        it("is the picked agents' seats in the order picked, from two up", () => {
            expect(discussTogetherSeats(["b", "a"], agents, roots).map((s) => s.id)).toEqual(["b", "a"]);
            expect(discussTogetherSeats(["a", "b", "d"], agents, roots).map((s) => s.project)).toEqual([
                "D:\\code\\waveterm",
                "/home/u/loom",
                "D:\\code\\waveterm",
            ]);
        });

        it("is empty for one agent, whatever it is", () => {
            expect(discussTogetherSeats(["a"], agents, roots)).toEqual([]);
            expect(discussTogetherSeats([], agents, roots)).toEqual([]);
        });

        it("leaves out a picked agent that cannot sit in a council, and offers nothing when fewer than two can", () => {
            expect(discussTogetherSeats(["a", "c", "d"], agents, roots).map((s) => s.id)).toEqual(["a", "d"]);
            expect(discussTogetherSeats(["a", "c"], agents, roots)).toEqual([]);
        });

        it("skips an id that is not in the roster", () => {
            expect(discussTogetherSeats(["a", "gone", "b"], agents, roots).map((s) => s.id)).toEqual(["a", "b"]);
        });
    });
});

describe("agentsInCouncil", () => {
    const council = (state: Council["state"], ...agents: string[]): Council =>
        ({
            id: `c-${state}`,
            project: "/work/a",
            feature: "F",
            state,
            round: 1,
            experts: [
                { id: "security", name: "Security", brief: "b", model: "" },
                ...agents.map((a) => ({
                    id: `agent-${a}`,
                    name: a,
                    brief: "",
                    model: "",
                    agent: a,
                    harness: "claude",
                })),
            ],
        }) as unknown as Council;

    it("is the agents seated in a council that runs or waits on the person", () => {
        const ids = agentsInCouncil([council("running", "w", "u"), council("awaiting-you", "x")]);
        expect([...ids].sort()).toEqual(["u", "w", "x"]);
    });

    it("leaves out a queued council, an ended one and the role experts", () => {
        const ids = agentsInCouncil([
            council("queued", "q"),
            council("done", "d"),
            council("failed", "f"),
            council("stopped", "s"),
            council("not-run", "n"),
        ]);
        expect(ids.size).toBe(0);
    });

    it("is empty for a list not loaded yet", () => {
        expect(agentsInCouncil(null).size).toBe(0);
        expect(agentsInCouncil(undefined).size).toBe(0);
    });
});
