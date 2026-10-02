import { describe, expect, it } from "vitest";
import type { AgentVM } from "./agentsviewmodel";
import {
    buildAgentTree,
    foldCollapsedProjects,
    stageSubline,
    treeAgentCount,
    UNGROUPED_PROJECT,
    type AgentTreeRow,
} from "./agenttreemodel";
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
                    return `done:${r.count}${r.stages ? `+${r.stages}` : ""}:${r.open}`;
                case "queued":
                    return `${r.kind}:${r.count}:${r.open}`;
                case "parent":
                    return `parent:${r.agent.id}`;
                case "stage":
                    return `stage:${r.stageRole}:${r.agent.id}${r.outcome ? `:${r.outcome}` : ""}`;
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
        // run 6c7652be's shape: round 1's plan review failed, round 2's was accepted, the final verifier is judging
        const finishing = () => {
            const r = run("run-1", [task("t-1", "done"), task("t-2", "done")]);
            r.dag.planreview = { state: "accepted", round: 2, runid: "rv2" };
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
            expect(shape(rows)).toEqual(["group:waveterm:2:0", "lead:run-1:1", "done:2+2:false", "stage:verifier:ver"]);
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
                "stage:plan-reviewer:rev2:accepted",
                "worker:t-1:-",
                "worker:t-2:-",
                "stage:verifier:ver:passed",
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
            expect(shape(rows)).toEqual(["group:waveterm:1:0", "run:run-1:1", "done:1+1:false", "stage:verifier:ver2"]);
        });

        it("stays live while the dag has no verdict for it", () => {
            const r = run("run-1", [task("t-1", "pending")]);
            r.dag.planreview = { state: "reviewing", round: 1, runid: "rv1" };
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
        // a queued task has no session, so it is not counted as an agent
        expect(treeAgentCount(rows)).toBe(4);
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
        // the header's total agrees with the group's, so a done worker's open session is counted in neither
        expect(treeAgentCount(rows)).toBe(1);
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
