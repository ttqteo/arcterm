import { describe, expect, it } from "vitest";
import type { AgentVM } from "./agentsviewmodel";
import type { Lineage, RunInfo } from "./runlineage";
import {
    canResume,
    cancelSurvivors,
    currentPhaseIndex,
    dagProgressLabel,
    defaultRunId,
    defaultView,
    finishedRunLabel,
    isOrchestrator,
    isTerminal,
    leadAsker,
    leadWorker,
    liveWorkers,
    phaseStateView,
    phaseProgressDots,
    phaseRailIds,
    phaseThread,
    phaseWorkers,
    planDirty,
    resolveActiveRunId,
    resolveArtifactPath,
    reviewGate,
    runComplete,
    runLiveWorkers,
    runRuntimeView,
    runStatusView,
    runTree,
    steerTarget,
} from "./runmodel";

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
        goal: "g",
        workspaceid: "w1",
        projectpath: "/p",
        status: "planning",
        phases: [],
        createdts: 1,
        ...over,
    };
}

describe("runStatusView", () => {
    it("maps awaiting-review to a review tone with a spaced label", () => {
        expect(runStatusView("awaiting-review")).toEqual({ label: "awaiting review", tone: "review" });
    });
    it("maps a dag's plan-review to a review tone", () => {
        expect(runStatusView("plan-review")).toEqual({ label: "reviewing plan", tone: "review" });
    });
    it("maps a dag's finalizing to verifying with a running tone", () => {
        expect(runStatusView("finalizing")).toEqual({ label: "verifying", tone: "running" });
    });
    it("maps executing to a running tone", () => {
        expect(runStatusView("executing").tone).toBe("running");
    });
    it("falls back to the raw status with a planning tone", () => {
        expect(runStatusView("weird")).toEqual({ label: "weird", tone: "planning" });
    });
    it("says where a done run's branch stands on its way back into its base", () => {
        expect(runStatusView("done", { state: "pending" })).toEqual({ label: "landing", tone: "running" });
        expect(runStatusView("done", { state: "held", reason: "dirty checkout" })).toEqual({
            label: "land held",
            tone: "blocked",
        });
        expect(runStatusView("done", { state: "landed" })).toEqual({ label: "landed", tone: "done" });
        expect(runStatusView("done")).toEqual({ label: "done", tone: "done" });
    });
});

describe("finishedRunLabel", () => {
    const info = (status?: string, land?: RunLand, dagStatus = "done"): RunInfo => ({
        runId: "r",
        channelId: "ch",
        title: "t",
        project: "p",
        status,
        land,
        dag: { status: dagStatus } as TaskGroup,
    });
    it("says the lead is wrapping up until it completes the run", () => {
        expect(finishedRunLabel(info("executing"))).toBe("lead wrapping up");
    });
    it("follows the land once the run is done", () => {
        expect(finishedRunLabel(info("done"))).toBe("run complete");
        expect(finishedRunLabel(info("done", { state: "pending" }))).toBe("landing");
        expect(finishedRunLabel(info("done", { state: "held" }))).toBe("land held");
        expect(finishedRunLabel(info("done", { state: "landed" }))).toBe("landed");
    });
    it("says a cancelled run is cancelled", () => {
        expect(finishedRunLabel(info("executing", undefined, "cancelled"))).toBe("run cancelled");
    });
});

describe("dagProgressLabel", () => {
    const tasks = [{ state: "done" }, { state: "done" }, { state: "running" }];
    const info = (dagStatus: string, taskList = tasks, leadStarted?: boolean): RunInfo => ({
        runId: "r",
        channelId: "ch",
        title: "t",
        project: "p",
        status: "executing",
        leadStarted,
        dag: { status: dagStatus, tasks: taskList } as TaskGroup,
    });
    it("counts done tasks while the plan executes", () => {
        expect(dagProgressLabel(info("running"), false)).toBe("2/3 done");
    });
    it("does not read as done while the final stage verifies, even with every task done", () => {
        const allDone = [{ state: "done" }, { state: "done" }] as TaskGroup["tasks"];
        expect(dagProgressLabel(info("finalizing", allDone), false)).toBe("2/2 · verifying the merged result");
        expect(dagProgressLabel(info("finalizing", allDone), true)).toBe("2/2 · verifying the merged result");
    });
    it("names the final stage's running step", () => {
        const allDone = [{ state: "done" }, { state: "done" }] as TaskGroup["tasks"];
        const at = (final: FinalStage): RunInfo => {
            const run = info("finalizing", allDone);
            return { ...run, dag: { ...run.dag, final } as TaskGroup };
        };
        const cases: [FinalStage, string][] = [
            [{ state: "checking", round: 1 }, "2/2 · final: starting"],
            [{ state: "checking", round: 1, step: "tree" }, "2/2 · final: preparing the tree"],
            [{ state: "checking", round: 1, step: "check" }, "2/2 · final: running Check"],
            [{ state: "checking", round: 1, step: "verify" }, "2/2 · final: running Verify"],
            [
                { state: "checking", round: 1, step: "verify", verifierrunid: "v" },
                "2/2 · final: running Verify · verifier alongside",
            ],
            [{ state: "final", round: 1, step: "final", verifierrunid: "v" }, "2/2 · final: running Final"],
            [{ state: "verifying", round: 1 }, "2/2 · final: verifier reviewing"],
        ];
        for (const [final, want] of cases) {
            expect(dagProgressLabel(at(final), false)).toBe(want);
        }
    });
    it("says whether a leadless run's lead has started", () => {
        expect(dagProgressLabel(info("running"), true)).toBe("2/3 · lead starts if needed");
        expect(dagProgressLabel(info("running", tasks, true), true)).toBe("2/3 · lead closed");
    });
    it("hands a done dag to the finished-run label", () => {
        expect(dagProgressLabel(info("done"), false)).toBe("lead wrapping up");
    });
});

describe("runComplete", () => {
    const info = (status?: string, land?: RunLand, dagStatus = "done"): RunInfo => ({
        runId: "r",
        channelId: "ch",
        title: "t",
        project: "p",
        status,
        land,
        dag: { status: dagStatus } as TaskGroup,
    });
    it("is complete once the plan is done and the run landed, or had nothing to land", () => {
        expect(runComplete(info("done"))).toBe(true);
        expect(runComplete(info("done", { state: "landed" }))).toBe(true);
    });
    it("is not complete while a land is in flight or held", () => {
        expect(runComplete(info("done", { state: "pending" }))).toBe(false);
        expect(runComplete(info("done", { state: "held" }))).toBe(false);
    });
    it("is not complete while the lead is still wrapping up", () => {
        expect(runComplete(info("executing"))).toBe(false);
        expect(runComplete(info("finalizing"))).toBe(false);
    });
    // a human can land a run whose final stage failed: the dag stays blocked, but the run is over and in its base
    it("is complete once a run landed past a failed final stage, its dag still blocked", () => {
        expect(runComplete(info("done", { state: "landed" }, "blocked"))).toBe(true);
        expect(finishedRunLabel(info("done", { state: "landed" }, "blocked"))).toBe("landed");
        expect(runComplete(info("done", undefined, "blocked"))).toBe(false);
        expect(runComplete(info("done", { state: "held" }, "blocked"))).toBe(false);
    });
    it("is not complete when cancelled or still running", () => {
        expect(runComplete(info("done", undefined, "cancelled"))).toBe(false);
        expect(runComplete(info("cancelled"))).toBe(false);
        expect(runComplete(info("done", undefined, "running"))).toBe(false);
    });
    // no dag means the lead did the goal itself without workers: the run's own status and land are the only truth
    it("follows the run's own status and land without a dag", () => {
        const dagless = (status: string, land?: RunLand) => ({ ...info(status, land), dag: undefined });
        expect(runComplete(dagless("done", { state: "landed" }))).toBe(true);
        expect(runComplete(dagless("done"))).toBe(true);
        expect(runComplete(dagless("planning"))).toBe(false);
        expect(runComplete(dagless("done", { state: "pending" }))).toBe(false);
        expect(runComplete(dagless("cancelled"))).toBe(false);
    });
});

describe("phaseStateView", () => {
    it("maps running", () => {
        expect(phaseStateView("running")).toMatchObject({ label: "running", tone: "running" });
    });
    it("maps unknown to pending", () => {
        expect(phaseStateView("zzz").tone).toBe("pending");
    });
});

describe("currentPhaseIndex", () => {
    it("returns the first running phase", () => {
        expect(currentPhaseIndex(run({ phases: [phase({ state: "done" }), phase({ state: "running" }), phase()] }))).toBe(1);
    });
    it("returns the gated phase when awaiting review", () => {
        const r = run({
            status: "awaiting-review",
            phases: [phase({ state: "done" }), phase({ gate: true, state: "done" }), phase({ state: "pending" })],
        });
        expect(currentPhaseIndex(r)).toBe(1);
    });
    it("returns the last non-skipped phase otherwise", () => {
        expect(currentPhaseIndex(run({ status: "done", phases: [phase({ state: "done" }), phase({ state: "skipped" })] }))).toBe(0);
    });
});

describe("reviewGate", () => {
    it("is null unless the run is awaiting review", () => {
        expect(reviewGate(run({ status: "executing", phases: [phase({ gate: true, state: "done" }), phase()] }))).toBeNull();
    });
    it("returns the done gated phase whose successor is pending", () => {
        const r = run({
            status: "awaiting-review",
            phases: [phase({ state: "done" }), phase({ gate: true, state: "done" }), phase({ state: "pending" })],
        });
        expect(reviewGate(r)).toEqual({ phaseIdx: 1 });
    });
});

describe("isTerminal / defaultView / defaultRunId", () => {
    it("treats done/cancelled/failed as terminal", () => {
        expect(isTerminal("done")).toBe(true);
        expect(isTerminal("executing")).toBe(false);
    });
    it("defaultView is runs when there are runs", () => {
        expect(defaultView(1)).toBe("runs");
        expect(defaultView(0)).toBe("chat");
    });
    it("defaultRunId prefers the most-recent non-terminal run", () => {
        const runs = [run({ id: "a", createdts: 1, status: "done" }), run({ id: "b", createdts: 2, status: "executing" })];
        expect(defaultRunId(runs)).toBe("b");
    });
    // a finished run is never the default: a channel with nothing live lands on the fresh-run state,
    // and a finished run only shows once the user picks it explicitly.
    it("defaultRunId is undefined when all runs are terminal", () => {
        const runs = [run({ id: "a", createdts: 1, status: "done" }), run({ id: "b", createdts: 2, status: "cancelled" })];
        expect(defaultRunId(runs)).toBeUndefined();
    });
    it("defaultRunId is undefined for no runs", () => {
        expect(defaultRunId([])).toBeUndefined();
    });
});

function agent(over: Partial<AgentVM> = {}): AgentVM {
    return { id: "t1", name: "claude", state: "working", ...over } as AgentVM;
    // note: cast — AgentVM has many fields; tests only touch id/name/state/ask
}

describe("phaseWorkers", () => {
    it("resolves tab: orefs to live roster rows, dropping missing ones", () => {
        const p: RunPhase = { kind: "execute", state: "running", workerorefs: ["tab:t1", "tab:gone"] };
        const agents = [agent({ id: "t1" })];
        expect(phaseWorkers(p, agents).map((a) => a.id)).toEqual(["t1"]);
    });
    it("returns empty for no orefs", () => {
        expect(phaseWorkers({ kind: "execute", state: "pending" }, [])).toEqual([]);
    });
});

describe("phaseThread", () => {
    const base = (over: Partial<Run>) =>
        ({ id: "r", goal: "g", workspaceid: "w", projectpath: "/p", status: "executing", phases: [], createdts: 1, ...over }) as Run;

    it("shows an ask (fork on execute) when a worker is asking", () => {
        const run = base({ phases: [{ kind: "execute", state: "running", workerorefs: ["tab:t1"] }] });
        const agents = [agent({ id: "t1", state: "asking" })];
        const t = phaseThread(run, 0, agents);
        expect(t.showAsk).toBe(true);
        expect(t.askKind).toBe("fork");
        expect(t.askAgent?.id).toBe("t1");
        expect(t.showWorkers).toBe(false); // suppressed while asking
    });
    it("labels a brainstorm-phase ask as clarify", () => {
        const run = base({ phases: [{ kind: "brainstorm", state: "running", workerorefs: ["tab:t1"] }] });
        const agents = [agent({ id: "t1", state: "asking" })];
        expect(phaseThread(run, 0, agents).askKind).toBe("clarify");
    });
    it("shows execute worker rows when running and not asking", () => {
        const run = base({ phases: [{ kind: "execute", state: "running", workerorefs: ["tab:t1"] }] });
        const agents = [agent({ id: "t1", state: "working" })];
        const t = phaseThread(run, 0, agents);
        expect(t.showWorkers).toBe(true);
        expect(t.showAsk).toBe(false);
    });
    it("shows the context-clear boundary for a started freshctx phase", () => {
        const run = base({ phases: [{ kind: "execute", state: "running", freshctx: true, workerorefs: ["tab:t1"] }] });
        expect(phaseThread(run, 0, [agent({ id: "t1" })]).showBoundary).toBe(true);
    });
    it("does not show the boundary for a pending freshctx phase", () => {
        const run = base({ phases: [{ kind: "execute", state: "pending", freshctx: true }] });
        expect(phaseThread(run, 0, []).showBoundary).toBe(false);
    });
    it("shows blocked when a running phase's recorded worker is gone", () => {
        const run = base({ phases: [{ kind: "execute", state: "running", workerorefs: ["tab:gone"] }] });
        expect(phaseThread(run, 0, []).showBlocked).toBe(true);
    });
    it("shows blocked for a failed phase: its worker stopped before completing it", () => {
        const run = base({
            status: "blocked",
            phases: [
                { kind: "execute", state: "failed", workerorefs: ["tab:t1"] },
                { kind: "execute", state: "pending" },
            ],
        });
        expect(phaseThread(run, 0, [], new Set(["t1"])).showBlocked).toBe(true);
        expect(currentPhaseIndex(run)).toBe(0);
    });
    it("shows starting (not blocked) while a recorded worker's tab exists but has not reported status", () => {
        const run = base({ phases: [{ kind: "execute", state: "running", workerorefs: ["tab:t1"] }] });
        // t1 is a live session (spawned tab) but not yet in the status-bearing roster
        const t = phaseThread(run, 0, [], new Set(["t1"]));
        expect(t.showStarting).toBe(true);
        expect(t.showBlocked).toBe(false);
    });
    it("shows blocked (not starting) when the recorded worker's tab no longer exists", () => {
        const run = base({ phases: [{ kind: "execute", state: "running", workerorefs: ["tab:t1"] }] });
        const t = phaseThread(run, 0, [], new Set());
        expect(t.showBlocked).toBe(true);
        expect(t.showStarting).toBe(false);
    });
    it("prefers the live worker over starting once it reports status", () => {
        const run = base({ phases: [{ kind: "execute", state: "running", workerorefs: ["tab:t1"] }] });
        const t = phaseThread(run, 0, [agent({ id: "t1", state: "working" })], new Set(["t1"]));
        expect(t.showWorkers).toBe(true);
        expect(t.showStarting).toBe(false);
        expect(t.showBlocked).toBe(false);
    });
    it("shows the gate card only on the gated phase", () => {
        const run = base({
            status: "awaiting-review",
            phases: [{ kind: "plan", gate: true, state: "done" }, { kind: "execute", state: "pending" }],
        });
        expect(phaseThread(run, 0, []).showGate).toBe(true);
        expect(phaseThread(run, 1, []).showGate).toBe(false);
    });
    it("shows ship on the last phase when the run is done", () => {
        const run = base({ status: "done", phases: [{ kind: "execute", state: "done" }] });
        expect(phaseThread(run, 0, []).showShip).toBe(true);
    });
});

describe("resolveActiveRunId", () => {
    it("keeps the current id when still visible", () => {
        expect(resolveActiveRunId([run({ id: "a" }), run({ id: "b" })], "b")).toBe("b");
    });
    it("falls back to the default when the current id is gone", () => {
        expect(resolveActiveRunId([run({ id: "a", createdts: 5, status: "executing" })], "b")).toBe("a");
    });
    it("returns undefined when nothing is visible", () => {
        expect(resolveActiveRunId([], "b")).toBeUndefined();
    });
});

describe("phaseProgressDots", () => {
    it("maps each phase to its tone in order", () => {
        const r = run({ phases: [phase({ state: "done" }), phase({ state: "running" }), phase({ state: "pending" })] });
        expect(phaseProgressDots(r)).toEqual(["done", "running", "pending"]);
    });
    it("is empty for a run with no phases", () => {
        expect(phaseProgressDots(run({ phases: [] }))).toEqual([]);
    });
});

describe("phaseRailIds", () => {
    it("returns one stable id per phase", () => {
        expect(phaseRailIds(run({ phases: [phase(), phase(), phase()] }))).toEqual(["p0", "p1", "p2"]);
    });
    it("is empty for no phases", () => {
        expect(phaseRailIds(run({ phases: [] }))).toEqual([]);
    });
});

describe("leadWorker", () => {
    it("returns the first worker of the current phase", () => {
        const r = run({
            status: "executing",
            phases: [phase({ state: "running", workerorefs: ["tab:t1"] })],
        });
        expect(leadWorker(r, [agent({ id: "t1" })])?.id).toBe("t1");
    });
    it("returns undefined when the current phase has no live worker", () => {
        const r = run({ status: "executing", phases: [phase({ state: "running" })] });
        expect(leadWorker(r, [])).toBeUndefined();
    });
    it("still resolves the lead on a terminal run (not terminal-gated)", () => {
        const r = run({
            status: "done",
            phases: [phase({ state: "done", workerorefs: ["tab:t1"] })],
        });
        expect(leadWorker(r, [agent({ id: "t1" })])?.id).toBe("t1");
    });
});

describe("steerTarget (regression after refactor)", () => {
    it("returns undefined on a terminal run even though a worker exists", () => {
        const r = run({
            status: "done",
            phases: [phase({ state: "done", workerorefs: ["tab:t1"] })],
        });
        expect(steerTarget(r, [agent({ id: "t1" })])).toBeUndefined();
    });
    it("returns the current phase worker on a live run", () => {
        const r = run({
            status: "executing",
            phases: [phase({ state: "running", workerorefs: ["tab:t1"] })],
        });
        expect(steerTarget(r, [agent({ id: "t1" })])?.id).toBe("t1");
    });
});

describe("planDirty", () => {
    it("is false when edited equals saved", () => {
        expect(planDirty("abc", "abc")).toBe(false);
    });
    it("is true when edited differs from saved", () => {
        expect(planDirty("abc x", "abc")).toBe(true);
    });
});

// a run landing on its own branch works in that tree: its lead writes artifacts there, and its changes are there
describe("runTree", () => {
    it("is the landing tree when the run has one, else the project", () => {
        expect(runTree({ projectpath: "/p" } as Run)).toBe("/p");
        expect(runTree({ projectpath: "/p", landpath: "/p/.waveterm/worktrees/r" } as Run)).toBe(
            "/p/.waveterm/worktrees/r"
        );
    });
});

describe("resolveArtifactPath", () => {
    it("passes an absolute POSIX artifact through", () => {
        expect(resolveArtifactPath("/home/proj", "/etc/plan.md")).toBe("/etc/plan.md");
    });
    it("passes an absolute Windows artifact through", () => {
        expect(resolveArtifactPath("C:\\proj", "D:\\plans\\plan.md")).toBe("D:\\plans\\plan.md");
    });
    it("joins a relative artifact under the project path", () => {
        expect(resolveArtifactPath("/home/proj", "docs/plan.md")).toBe("/home/proj/docs/plan.md");
    });
    it("collapses a trailing separator on the base to a single join separator", () => {
        expect(resolveArtifactPath("/home/proj/", "docs/plan.md")).toBe("/home/proj/docs/plan.md");
    });
    it("joins under a Windows project path (mixed separators read fine)", () => {
        expect(resolveArtifactPath("C:\\proj", "docs/plan.md")).toBe("C:\\proj/docs/plan.md");
    });
});

describe("liveWorkers", () => {
    it("returns recorded workers whose roster row is not idle, deduped across phases", () => {
        const r = run({
            phases: [
                { kind: "plan", state: "done", workerorefs: ["tab:a"] },
                { kind: "execute", state: "running", workerorefs: ["tab:b", "tab:c"] },
                { kind: "custom", state: "running", workerorefs: ["tab:b"] }, // b recurs → must dedup, not repeat
            ],
        });
        const agents = [
            agent({ id: "a", state: "idle" }),
            agent({ id: "b", state: "working" }),
            agent({ id: "c", state: "asking" }),
        ];
        expect(liveWorkers(r, agents).map((w) => w.id)).toEqual(["b", "c"]);
    });
    it("is empty when every recorded worker is idle or gone (blocked · worker exited)", () => {
        const r = run({ phases: [{ kind: "execute", state: "running", workerorefs: ["tab:a", "tab:gone"] }] });
        expect(liveWorkers(r, [agent({ id: "a", state: "idle" })])).toEqual([]);
    });
});

describe("cancelSurvivors", () => {
    it("returns live workers of a cancelled run, deduped across phases", () => {
        const r = run({
            status: "cancelled",
            phases: [
                { kind: "execute", state: "skipped", workerorefs: ["tab:a", "tab:b"] },
                { kind: "custom", state: "skipped", workerorefs: ["tab:b"] },
            ],
        });
        const agents = [agent({ id: "a", state: "working" }), agent({ id: "b", state: "asking" })];
        expect(cancelSurvivors(r, agents).map((w) => w.id)).toEqual(["a", "b"]);
    });
    it("excludes idle (already-exited) workers", () => {
        const r = run({ status: "cancelled", phases: [{ kind: "execute", state: "skipped", workerorefs: ["tab:a"] }] });
        expect(cancelSurvivors(r, [agent({ id: "a", state: "idle" })])).toEqual([]);
    });
    it("is empty for a non-cancelled run even with live workers", () => {
        const r = run({ status: "executing", phases: [{ kind: "execute", state: "running", workerorefs: ["tab:a"] }] });
        expect(cancelSurvivors(r, [agent({ id: "a", state: "working" })])).toEqual([]);
    });
});

describe("orchestrator derivations", () => {
    function orchHeldRun(): Run {
        return {
            id: "r1", goal: "g", mode: "orchestrator", status: "awaiting-review",
            phases: [{ kind: "orchestrate", state: "running", gate: true, held: true }],
            createdts: 1, workspaceid: "w", projectpath: "/p",
        } as unknown as Run;
    }

    it("reviewGate matches a held orchestrator phase", () => {
        expect(reviewGate(orchHeldRun())).toEqual({ phaseIdx: 0 });
    });

    it("isOrchestrator reads the mode", () => {
        expect(isOrchestrator(orchHeldRun())).toBe(true);
        expect(isOrchestrator({ mode: "pipeline" } as unknown as Run)).toBe(false);
        expect(isOrchestrator({} as unknown as Run)).toBe(false);
    });

});

const runtimeHarnesses: HarnessInfo[] = [
    { runtime: "claude", label: "Claude Code", installed: true, consultcapable: true, runworkercapable: true, leadcapable: true },
    { runtime: "codex", label: "Codex", installed: true, consultcapable: true, runworkercapable: true, leadcapable: false },
    { runtime: "opencode", label: "OpenCode", installed: true, consultcapable: true, runworkercapable: true, leadcapable: false },
];

describe("runRuntimeView", () => {
    it("labels an empty runtime as legacy Claude", () => {
        expect(runRuntimeView({ runtime: "" } as Run, runtimeHarnesses)).toEqual({
            runtime: "claude",
            label: "Claude · legacy",
            legacy: true,
            valid: true,
        });
    });
    it("labels an explicit runtime from the catalog", () => {
        expect(runRuntimeView({ runtime: "opencode" } as Run, runtimeHarnesses)).toMatchObject({
            label: "OpenCode",
            legacy: false,
            valid: true,
        });
    });
    it("renders an unknown runtime visibly invalid, never as Claude", () => {
        expect(runRuntimeView({ runtime: "mystery" } as Run, runtimeHarnesses)).toMatchObject({
            label: "Unknown: mystery",
            valid: false,
        });
    });
});

describe("runLiveWorkers", () => {
    const owner = () =>
        run({
            id: "owner",
            oid: "owner",
            status: "executing",
            phases: [{ kind: "orchestrate", state: "running", workerorefs: ["tab:lead"] }],
        });
    const lineage: Lineage = {
        roles: {
            lead: { kind: "lead", runId: "owner" },
            w1: { kind: "worker", leadRunId: "owner", taskId: "t-1" },
            w2: { kind: "worker", leadRunId: "owner", taskId: "t-2" },
            w3: { kind: "worker", leadRunId: "owner", taskId: "t-3" },
            other: { kind: "worker", leadRunId: "another-run", taskId: "t-1" },
        },
        runs: {},
    };
    it("counts an engine run's DAG workers while its lead is idle between wakes", () => {
        const agents = [
            agent({ id: "lead", state: "idle" }),
            agent({ id: "w1", state: "working" }),
            agent({ id: "w2", state: "asking" }),
            agent({ id: "w3", state: "idle" }),
            agent({ id: "other", state: "working" }),
        ];
        expect(runLiveWorkers(owner(), agents, lineage).map((w) => w.id)).toEqual(["w1", "w2"]);
    });
    it("lists a live lead once, ahead of its workers", () => {
        const agents = [agent({ id: "lead", state: "working" }), agent({ id: "w1", state: "working" })];
        expect(runLiveWorkers(owner(), agents, lineage).map((w) => w.id)).toEqual(["lead", "w1"]);
    });
    it("is the phase workers alone for a run with no DAG", () => {
        const r = run({ phases: [{ kind: "execute", state: "running", workerorefs: ["tab:a"] }] });
        const agents = [agent({ id: "a", state: "working" })];
        expect(runLiveWorkers(r, agents, { roles: {}, runs: {} }).map((w) => w.id)).toEqual(["a"]);
    });
});

describe("leadAsker", () => {
    it("is the run's own asking worker; a DAG worker's question goes to its lead first", () => {
        const r = run({ phases: [{ kind: "orchestrate", state: "running", workerorefs: ["tab:lead"] }] });
        expect(leadAsker(r, [agent({ id: "lead", state: "asking" }), agent({ id: "w1", state: "asking" })])?.id).toBe(
            "lead"
        );
        expect(
            leadAsker(r, [agent({ id: "lead", state: "working" }), agent({ id: "w1", state: "asking" })])
        ).toBeUndefined();
    });
});

describe("canResume", () => {
    const failed = (over: Partial<Run>) =>
        ({
            id: "r",
            goal: "g",
            workspaceid: "w",
            projectpath: "/p",
            status: "blocked",
            runtime: "claude",
            sessionid: "s-1",
            phases: [{ kind: "execute", state: "failed", workerorefs: ["tab:t1"] }],
            createdts: 1,
            ...over,
        }) as Run;

    it("offers Resume on a failed phase of a claude, pi or legacy run with a session", () => {
        expect(canResume(failed({}), 0)).toBe(true);
        expect(canResume(failed({ runtime: "pi" }), 0)).toBe(true);
        expect(canResume(failed({ runtime: undefined }), 0)).toBe(true);
    });

    it("hides Resume where the backend would refuse it", () => {
        expect(canResume(failed({ sessionid: undefined }), 0)).toBe(false);
        expect(canResume(failed({ runtime: "codex" }), 0)).toBe(false);
        expect(canResume(failed({ dagoref: "dag:1" }), 0)).toBe(false);
        expect(canResume(failed({ phases: [{ kind: "execute", state: "blocked" }] }), 0)).toBe(false);
        expect(canResume(failed({}), 3)).toBe(false);
    });
});
