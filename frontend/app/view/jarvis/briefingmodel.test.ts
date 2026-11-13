// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import type { AgentVM } from "@/app/view/agents/agentsviewmodel";
import { describe, expect, it, vi } from "vitest";
import { EFFORT_FIXTURES } from "./briefingfixtures";
import {
    ackableRuns,
    ACTIVE_CAP,
    actOnChunk,
    buildAttentionQueue,
    capRegion,
    kindWord,
    mergeActiveWork,
    oldestWaitingTs,
    projectBriefing,
    queueAction,
    queueActions,
    queueKindLabel,
    queueOpenTarget,
    SHIPPED_CAP,
    summarizeAttentionQueue,
    waitingStrip,
    type AgentRow,
    type BlockerRow,
    type BriefingModelInput,
    type QueueRow,
    type RunRow,
} from "./briefingmodel";
import type { EffortCardModel } from "./effortmodel";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const T0 = 1_800_000_000_000;

const agent = (over: Partial<AgentVM>): AgentVM => ({
    id: "tab-1",
    name: "loom",
    task: "ship the briefing",
    state: "working",
    agent: "claude",
    project: "waveterm",
    activeMs: 5 * 60_000,
    ...over,
});

const workState = (projects: ProjectWork[]): WorkState => ({
    projects,
    sources: { runs: true, sessions: true, dossiers: true, efforts: true, attention: "volatile" },
});

const runItem = (over: Partial<ActiveWorkItem>): ActiveWorkItem => ({
    project: "/p/one",
    kind: "run",
    title: "ship ledger",
    detail: "status: executing",
    ts: T0 - DAY,
    navtarget: "run:r-1",
    ...over,
});

const input = (state: WorkState, agents: AgentVM[] = [], cursor = T0 - DAY): BriefingModelInput => ({
    state,
    agents,
    actualCursor: cursor,
    queryStartedAt: T0,
    sevenDaysAgo: T0 - 7 * DAY,
});

describe("briefing projection", () => {
    it("suppresses a live agent already represented by an active run, exactly by tab oref", () => {
        const state = workState([
            {
                project: "waveterm",
                active: [
                    runItem({ workerorefs: ["tab:a", "tab:b"] }),
                    runItem({ title: "other run", detail: "status: blocked", ts: T0 - 2 * DAY, navtarget: "run:r-2" }),
                ],
                shipped: [],
                events: [],
                delta: [],
            },
        ]);
        const roster = [
            agent({ id: "a", name: "run worker", state: "working" }),
            agent({ id: "x", name: "direct", state: "working", project: undefined }),
            agent({ id: "term", name: "shell", state: "working", kind: "terminal" }),
            agent({ id: "bg", name: "bg", state: "working", kind: "background" }),
            agent({ id: "idle", name: "idle", state: "idle" }),
        ];
        const m = projectBriefing(input(state, roster));
        // "a" and "b" are suppressed (in r-1's workerorefs); "x" remains a direct agent; terminal,
        // background and idle rows are excluded; pending-launch overlays (kind undefined) stay.
        expect(m.directAgents.map((a) => a.id)).toEqual(["x"]);
        expect(m.counts.agents).toBe(1);
        expect(m.counts.runs).toBe(2);
    });

    it("includes pending-launch overlays as direct agents", () => {
        const state = workState([]);
        const m = projectBriefing(input(state, [agent({ id: "p", state: "working", kind: undefined })]));
        expect(m.directAgents.map((a) => a.id)).toEqual(["p"]);
    });

    it("sorts runs blocked-first then ts-desc then oref, agents asking-first then started desc", () => {
        const state = workState([
            {
                project: "waveterm",
                active: [
                    runItem({
                        title: "newer executing",
                        ts: T0 - DAY,
                        navtarget: "run:r-b",
                        detail: "status: executing",
                    }),
                    runItem({ title: "blocked", ts: T0 - 3 * DAY, navtarget: "run:r-a", detail: "status: blocked" }),
                    runItem({
                        title: "older executing",
                        ts: T0 - 2 * DAY,
                        navtarget: "run:r-c",
                        detail: "status: executing",
                    }),
                ],
                shipped: [],
                events: [],
                delta: [],
            },
        ]);
        const m = projectBriefing(
            input(state, [
                agent({ id: "tab-1", name: "w1", state: "working", activeMs: 10 * 60_000 }),
                agent({ id: "tab-2", name: "a1", state: "asking", blockedMs: 60_000 }),
                agent({ id: "tab-3", name: "w2", state: "working", activeMs: 60_000 }),
            ])
        );
        expect(m.activeRuns.map((r) => r.oref)).toEqual(["run:r-a", "run:r-b", "run:r-c"]);
        // asking first; then startedTs desc — w1 started earlier than w2, so w2 comes first
        expect(m.directAgents.map((a) => a.id)).toEqual(["tab-2", "tab-3", "tab-1"]);
    });

    it("dates a direct agent by the fixed start of its state, not by an age that grows each tick", () => {
        const state = workState([]);
        const at = (activeMs: number) =>
            projectBriefing(input(state, [agent({ id: "t", state: "working", activeMs, stateSince: T0 - HOUR })]))
                .directAgents[0].startedTs;
        // two roster ticks a minute apart: the age grew, the start did not move
        expect(at(HOUR)).toBe(T0 - HOUR);
        expect(at(HOUR + 60_000)).toBe(T0 - HOUR);
    });

    it("windows delta to actualCursor and words events honestly", () => {
        const delta: TimelineEvent[] = [
            { ts: T0 - DAY, kind: "run-created", title: "g1", detail: "status: executing", navtarget: "run:r-1" },
            { ts: T0 - 2 * DAY, kind: "run-done", title: "g2", detail: "sealed", navtarget: "run:r-2" },
            { ts: T0 - 3 * DAY, kind: "decision", title: "chose sqlite" },
            {
                ts: T0 - 4 * DAY,
                kind: "dossier",
                title: "ship ledger",
                detail: "status: active",
                navtarget: "task:d-1",
            },
            { ts: T0 - 10 * DAY, kind: "run-created", title: "stale", detail: "", navtarget: "run:r-9" },
            { ts: T0 - 5 * DAY, kind: "session", title: "a session", detail: "pi m" },
        ];
        const m = projectBriefing(
            input(workState([{ project: "waveterm", active: [], shipped: [], events: delta, delta }]), [], T0 - 6 * DAY)
        );
        const kinds = m.delta.map((d) => d.kind);
        expect(kinds).not.toContain("session"); // session rows are excluded entirely
        expect(m.delta.map((d) => d.title)).not.toContain("stale"); // the 10-day-old one is outside the cursor window
        expect(m.delta.map((d) => d.wording)).toEqual([
            "Run started",
            "Run completed",
            "Decision recorded",
            "Record updated · current status: active",
        ]);
        expect(m.delta.find((d) => d.kind === "dossier")?.oref).toBe("task:d-1");
    });

    it("promotes in-window completions to New shipped rows and keeps older completions in delta", () => {
        const shipped: ShippedItem[] = [
            { project: "waveterm", runoid: "r-new", goal: "new work", summary: "sealed", completedts: T0 - DAY },
        ];
        const delta: TimelineEvent[] = [
            { ts: T0 - DAY, kind: "run-done", title: "new work", detail: "sealed", navtarget: "run:r-new" },
            { ts: T0 - DAY - HOUR, kind: "run-created", title: "new work", navtarget: "run:r-new" },
            { ts: T0 - 8 * DAY, kind: "run-done", title: "old work", detail: "sealed", navtarget: "run:r-old" },
            { ts: T0 - HOUR, kind: "run-created", title: "not yet shipped", navtarget: "run:r-z" },
        ];
        const m = projectBriefing(
            input(workState([{ project: "waveterm", active: [], shipped, events: delta, delta }]), [], T0 - 9 * DAY)
        );
        expect(m.shipped.map((s) => s.oref)).toEqual(["run:r-new"]);
        expect(m.shipped[0].fresh).toBe(true);
        // a shipped run's start and its completion both repeat its Shipped row; the old completion and a run that has
        // not shipped keep theirs, newest first
        expect(m.delta.map((d) => [d.kind, d.oref])).toEqual([
            ["run-created", "run:r-z"],
            ["run-done", "run:r-old"],
        ]);
    });

    it("carries a delta row's project and the initiative a run event belongs to", () => {
        const delta: TimelineEvent[] = [
            {
                ts: T0 - HOUR,
                kind: "run-created",
                project: "/p/one",
                title: "g",
                navtarget: "run:r-1",
                effortoid: "e-1",
            },
            { ts: T0 - 2 * HOUR, kind: "decision", title: "chose sqlite" },
        ];
        const m = projectBriefing(
            input(workState([{ project: "waveterm", active: [], shipped: [], events: delta, delta }]), [], T0 - 9 * DAY)
        );
        expect(m.delta.map((d) => [d.project, d.effortOid])).toEqual([
            ["/p/one", "e-1"],
            ["", ""],
        ]);
    });

    it("removes current attention items from delta rather than showing both", () => {
        const active: ActiveWorkItem[] = [
            {
                project: "/p/one",
                kind: "attention",
                title: "the ask bridge",
                detail: "Review: check the diff",
                ts: T0 - DAY,
                navtarget: "run:r-1",
            },
        ];
        const delta: TimelineEvent[] = [
            {
                ts: T0 - DAY,
                kind: "attention",
                title: "the ask bridge",
                detail: "Review: check the diff",
                navtarget: "run:r-1",
            },
        ];
        const m = projectBriefing(
            input(workState([{ project: "waveterm", active, shipped: [], events: delta, delta }]))
        );
        expect(m.delta).toHaveLength(0); // the snapshot's attention item deduped the delta event
        expect(m.activeRuns).toHaveLength(0); // attention is queue-only, never an active-work row
    });

    it("labels unscoped blockers and keeps their target", () => {
        const active: ActiveWorkItem[] = [
            {
                project: "",
                kind: "blocker",
                title: "ship ledger",
                detail: "needs decision on X",
                ts: T0 - DAY,
                navtarget: "task:d-1",
            },
        ];
        const m = projectBriefing(input(workState([{ project: "", active, shipped: [], events: [], delta: [] }])));
        expect(m.blockers).toHaveLength(1);
        expect(m.blockers[0].project).toBeNull(); // view renders "Unscoped record"
        expect(m.blockers[0].oref).toBe("task:d-1");
    });

    it("reports complete vs partial source health", () => {
        const complete = projectBriefing(input(workState([])));
        expect(complete.health.complete).toBe(true);
        const p = workState([]);
        p.sources = { runs: false, sessions: true, dossiers: true, efforts: true, attention: "volatile" };
        const m = projectBriefing(input(p));
        expect(m.health.complete).toBe(false);
        expect(m.health.missingLegs).toEqual(["Runs"]);
    });

    it("excludes shipped rows outside the seven-day window", () => {
        const shipped: ShippedItem[] = [
            { project: "waveterm", runoid: "r-new", goal: "new", summary: "", completedts: T0 - DAY },
            { project: "waveterm", runoid: "r-old", goal: "old", summary: "", completedts: T0 - 8 * DAY },
        ];
        const m = projectBriefing(
            input(workState([{ project: "waveterm", active: [], shipped, events: [], delta: [] }]))
        );
        expect(m.shipped.map((s) => s.oref)).toEqual(["run:r-new"]);
    });

    it("maps the runs that ended without shipping, across projects, windowed to seven days, newest first", () => {
        const ended = (project: string, runoid: string, completedts: number, mode?: string): EndedItem => ({
            project,
            runoid,
            goal: "goal " + runoid,
            status: "cancelled",
            ...(mode != null ? { mode } : {}),
            completedts,
        });
        const m = projectBriefing(
            input(
                workState([
                    {
                        project: "/p/one",
                        ended: [
                            ended("/p/one", "r-a", T0 - 3 * DAY, "orchestrator"),
                            ended("/p/one", "r-old", T0 - 8 * DAY),
                        ],
                    },
                    { project: "/p/two", ended: [ended("/p/two", "r-b", T0 - HOUR, "quick")] },
                ])
            )
        );
        expect(m.ended).toEqual([
            {
                oref: "run:r-b",
                oid: "r-b",
                goal: "goal r-b",
                project: "/p/two",
                status: "cancelled",
                mode: "quick",
                endedTs: T0 - HOUR,
            },
            {
                oref: "run:r-a",
                oid: "r-a",
                goal: "goal r-a",
                project: "/p/one",
                status: "cancelled",
                mode: "orchestrator",
                endedTs: T0 - 3 * DAY,
            },
        ]);
        expect(projectBriefing(input(workState([{ project: "/p/one" }]))).ended).toEqual([]);
    });

    it("projects efforts, non-archived only, and leaves the display window to the view", () => {
        const state = workState([{ project: "waveterm", active: [], shipped: [], events: [], delta: [] }]);
        state.efforts = EFFORT_FIXTURES;
        const m = projectBriefing(input(state));
        expect(m.efforts.map((e) => e.title)).toEqual(["Scenario gate clearance", "Reflux state-layer migration"]);
        // 10 efforts in, 9 projected (archived never counts), and the cap is what the region opens at
        const many = [
            ...EFFORT_FIXTURES,
            ...Array.from({ length: 8 }, (_, i) => ({
                oref: `effort:e${i}`,
                title: `effort ${i}`,
                status: i === 0 ? "archived" : "active",
                done: 0,
                total: 1,
                updatedts: T0 - i * HOUR,
                chunks: [{ label: "c", status: "pending" }],
            })),
        ] as WorkState["efforts"];
        const m2 = projectBriefing(input({ ...state, efforts: many }));
        expect(m2.efforts).toHaveLength(9);
        expect(m2.efforts.some((e) => e.title === "effort 0")).toBe(false); // archived excluded
        expect(capRegion(m2.efforts, 8, false)).toMatchObject({ more: 1 });
        expect(capRegion(m2.efforts, 8, true).rows).toHaveLength(9);
    });

    it("folds blocked chunks into the queue", () => {
        const state = workState([{ project: "waveterm", active: [], shipped: [], events: [], delta: [] }]);
        state.efforts = EFFORT_FIXTURES;
        const m = projectBriefing(input(state));
        const q = buildAttentionQueue({ attention: [], efforts: m.efforts });
        const row = q.find((r) => r.title === "Phase 5");
        expect(row?.kind).toBe("chunk blocked");
        expect(row?.detail).toBe("Scenario gate clearance");
        expect(row?.nav).toEqual({ kind: "effort", oref: "effort:scenario-gate" });
    });

    it("projects every delta row the window holds", () => {
        const events = Array.from({ length: 12 }, (_, i) => ({
            ts: T0 - i * HOUR,
            kind: "run-created",
            title: `r${i}`,
        })) as TimelineEvent[];
        const state = workState([{ project: "waveterm", active: [], shipped: [], events, delta: events }]);
        const m = projectBriefing(input(state));
        expect(m.delta).toHaveLength(12);
        expect(m.counts.delta).toBe(12); // the pill keeps the true count
    });

    it("orders the delta newest first across projects, so the project-less records do not all lead", () => {
        // the server sorts each project's events, and "(none)", where records sit, sorts before every path
        const none: TimelineEvent[] = [
            { ts: T0 - 2 * HOUR, kind: "dossier", title: "rec a", detail: "status: active", navtarget: "task:a" },
            { ts: T0 - 5 * HOUR, kind: "dossier", title: "rec b", detail: "status: active", navtarget: "task:b" },
        ];
        const one: TimelineEvent[] = [
            { ts: T0 - HOUR, kind: "run-created", project: "/p/one", title: "run 1", navtarget: "run:r-1" },
            { ts: T0 - 3 * HOUR, kind: "run-created", project: "/p/one", title: "run 2", navtarget: "run:r-2" },
        ];
        const state = workState([
            { project: "(none)", active: [], shipped: [], events: [], delta: none },
            { project: "/p/one", active: [], shipped: [], events: [], delta: one },
        ]);
        const m = projectBriefing(input(state));
        expect(m.delta.map((d) => d.title)).toEqual(["run 1", "rec a", "run 2", "rec b"]);
    });

    it("projects every active leg and shipped row, each capped on its own", () => {
        const active = Array.from({ length: 10 }, (_, i) =>
            runItem({ title: `run ${i}`, ts: T0 - i * HOUR, navtarget: `run:r-${i}` })
        );
        const shipped: ShippedItem[] = Array.from({ length: 10 }, (_, i) => ({
            project: "waveterm",
            runoid: `rs-${i}`,
            goal: `shipped ${i}`,
            summary: "",
            completedts: T0 - i * HOUR,
        }));
        const state = workState([{ project: "waveterm", active, shipped, events: [], delta: [] }]);
        const m = projectBriefing(input(state));
        expect(m.activeRuns).toHaveLength(10);
        expect(m.shipped).toHaveLength(10);
        expect(m.counts.runs).toBe(10);
        expect(m.counts.shipped).toBe(10);
        expect(capRegion(m.activeRuns, ACTIVE_CAP, false)).toMatchObject({ more: 2 });
        expect(capRegion(m.shipped, SHIPPED_CAP, false)).toMatchObject({ more: 7 });
    });
});

describe("unified active work", () => {
    const run = (over: Partial<RunRow> = {}): RunRow => ({
        oref: "run:r1",
        oid: "r1",
        goal: "run goal",
        project: "waveterm",
        status: "running",
        workerOrefs: [],
        mode: "quick",
        ts: T0 - 2 * HOUR,
        ...over,
    });
    const blocker = (over: Partial<BlockerRow> = {}): BlockerRow => ({
        oref: "task:b1",
        objective: "blocked thing",
        blockers: "waiting on x",
        project: "waveterm",
        ts: T0 - 2 * HOUR,
        ...over,
    });
    const agentRow = (over: Partial<AgentRow> = {}): AgentRow => ({
        oref: "agent:a1",
        id: "a1",
        name: "loom",
        task: "the task",
        runtime: "claude",
        project: "waveterm",
        state: "working",
        startedTs: T0 - 2 * HOUR,
        ...over,
    });

    it("interleaves kinds, needing-eyes first, then recency, then identity", () => {
        const rows = mergeActiveWork({
            activeRuns: [run({ ts: T0 - HOUR }), run({ oref: "run:r2", ts: T0 - 4 * HOUR, status: "blocked" })],
            blockers: [blocker({ ts: T0 - 2 * HOUR })],
            directAgents: [agentRow({ state: "asking", startedTs: T0 - 3 * HOUR })],
        });
        // needing-eyes (blocked run, blocker, asking agent) first, recency within tier:
        expect(rows.map((r) => r.kind)).toEqual(["blocker", "agent", "run", "run"]);
        // then the remaining run (1h ago) before… no — it is the only score-1 row here, so it is last.
        expect(rows[3].oref).toBe("run:r1");
        expect(rows[3].chip).toEqual({ label: "running", tone: "running" });
    });

    it("chips: blocked runs, asking agents, and only unscoped blockers", () => {
        const rows = mergeActiveWork({
            activeRuns: [run({ status: "blocked" })],
            blockers: [blocker({ project: null })],
            directAgents: [agentRow({ state: "asking" })],
        });
        expect(rows.find((r) => r.kind === "run")!.chip).toEqual({ label: "blocked", tone: "blocked" });
        expect(rows.find((r) => r.kind === "blocker")!.chip).toEqual({ label: "Unscoped record", tone: "muted" });
        expect(rows.find((r) => r.kind === "agent")!.chip).toEqual({ label: "asking", tone: "asking" });
    });

    it("carries name, meta, oref, and recency for each kind", () => {
        const rows = mergeActiveWork({
            activeRuns: [run({ project: "waveterm", status: "running" })],
            blockers: [blocker({ objective: "gate decision", blockers: "needs the spawn gate" })],
            directAgents: [agentRow({ state: "working", startedTs: T0 - 5 * HOUR })],
        });
        const byKind = Object.fromEntries(rows.map((r) => [r.kind, r]));
        expect(byKind.run!.name).toBe("run goal");
        expect(byKind.run!.meta).toBe("waveterm · running");
        expect(byKind.run!.oref).toBe("run:r1");
        expect(byKind.blocker!.name).toBe("gate decision");
        expect(byKind.blocker!.meta).toBe("needs the spawn gate");
        expect(byKind.agent!.name).toBe("loom · the task");
        expect(byKind.agent!.meta).toBe("claude · waveterm");
        expect(byKind.agent!.ts).toBe(T0 - 5 * HOUR);
    });

    it("names an agent once when its task is empty or repeats its name", () => {
        const names = (over: Partial<AgentRow>) =>
            mergeActiveWork({ activeRuns: [], blockers: [], directAgents: [agentRow(over)] })[0].name;
        expect(names({ name: "Màu mờ khó đọc", task: "Màu mờ khó đọc" })).toBe("Màu mờ khó đọc");
        expect(names({ task: "" })).toBe("loom");
        expect(names({ task: "  loom " })).toBe("loom");
        expect(names({ task: "the task" })).toBe("loom · the task");
    });

    it("keys a row by its identity alone, so a row arriving above does not re-key the rows below", () => {
        const runs = [run({ oref: "run:a", ts: T0 - HOUR }), run({ oref: "run:b", ts: T0 - 2 * HOUR })];
        const before = mergeActiveWork({ activeRuns: runs, blockers: [], directAgents: [] });
        const after = mergeActiveWork({
            activeRuns: [run({ oref: "run:new", ts: T0 }), ...runs],
            blockers: [],
            directAgents: [],
        });
        expect(before.map((r) => r.key)).toEqual(["run:run:a", "run:run:b"]);
        expect(after.map((r) => r.key)).toEqual(["run:run:new", "run:run:a", "run:run:b"]);
    });

    it("keeps one row per identity", () => {
        const rows = mergeActiveWork({
            activeRuns: [run({ oref: "run:a", ts: T0 }), run({ oref: "run:a", ts: T0 - HOUR })],
            blockers: [],
            directAgents: [],
        });
        expect(rows.map((r) => r.key)).toEqual(["run:run:a"]);
    });

    it("stays deterministic when timestamps collide", () => {
        const rows = mergeActiveWork({
            activeRuns: [run({ oref: "run:z", ts: T0 }), run({ oref: "run:a", ts: T0 })],
            blockers: [],
            directAgents: [],
        });
        expect(rows.map((r) => r.oref)).toEqual(["run:a", "run:z"]);
    });
});

const attentionItem = (over: Partial<AttentionItem>): AttentionItem => ({
    kind: "dag-gate",
    key: "dag-gate:r1",
    channelid: "ch-1",
    channelname: "waveterm",
    runid: "r1",
    source: "ship the ledger",
    text: "Approve before Jarvis proceeds.",
    action: "Review",
    phaseidx: 2,
    waitingsince: T0 - HOUR,
    ...over,
});

describe("buildAttentionQueue", () => {
    const item = attentionItem;

    it("keeps the server's priority order rather than re-sorting on age", () => {
        const q = buildAttentionQueue({
            attention: [
                item({ key: "dag-gate:d1", kind: "dag-gate", waitingsince: T0 - HOUR }),
                item({ key: "ask:w1", kind: "ask", waitingsince: T0 - DAY }),
            ],
            efforts: [],
        });
        expect(q.map((r) => r.key)).toEqual(["dag-gate:d1", "ask:w1"]);
    });

    it("writes a label for every kind the server can emit", () => {
        const kinds = ["escalation", "ask", "dag-gate", "dag-blocked", "radar-triage"];
        const q = buildAttentionQueue({
            attention: kinds.map((k, i) => item({ kind: k, key: k + i })),
            efforts: [],
        });
        expect(q.map((r) => r.kind)).toEqual(["escalation", "ask", "dag gate", "dag blocked", "triage"]);
    });

    it("gives a dag-blocked row the error tone and the rest the asking tone", () => {
        const q = buildAttentionQueue({
            attention: [item({ kind: "dag-blocked", key: "d1" }), item({ kind: "ask", key: "a1" })],
            efforts: [],
        });
        expect(q.map((r) => r.tone)).toEqual(["error", "asking"]);
    });

    it("drops the action and nav on a standalone item with no channel to land on", () => {
        const q = buildAttentionQueue({
            attention: [item({ channelid: "", channelname: "", runid: "" })],
            efforts: [],
        });
        expect(q[0]!.action).toBeNull();
        expect(q[0]!.nav).toBeNull();
        expect(q[0]!.detail).toBe("ship the ledger"); // no "#channel" suffix to append
    });

    it("targets the run when the item names one, else the channel", () => {
        const q = buildAttentionQueue({
            attention: [item({ key: "with-run" }), item({ key: "no-run", runid: "" })],
            efforts: [],
        });
        expect(q[0]!.nav).toEqual({ kind: "channel", channelId: "ch-1", runId: "r1" });
        expect(q[1]!.nav).toEqual({ kind: "channel", channelId: "ch-1", runId: null });
    });

    it("carries the channel into the detail line and the age from waiting-since", () => {
        const q = buildAttentionQueue({ attention: [item({})], efforts: [] });
        expect(q[0]!.title).toBe("Approve before Jarvis proceeds.");
        expect(q[0]!.detail).toBe("ship the ledger · #waveterm");
        expect(q[0]!.ts).toBe(T0 - HOUR);
    });

    // the server un-rolled dag gates to one row per task; two tasks of one group must stay two rows.
    it("keeps two gated tasks of the same dag apart", () => {
        const q = buildAttentionQueue({
            attention: [
                item({ kind: "dag-gate", key: "dag-gate:d1:t-0", text: "Approve scaffold before the DAG proceeds." }),
                item({ kind: "dag-gate", key: "dag-gate:d1:t-1", text: "Approve migrate before the DAG proceeds." }),
            ],
            efforts: [],
        });
        expect(q.map((r) => r.key)).toEqual(["dag-gate:d1:t-0", "dag-gate:d1:t-1"]);
        expect(new Set(q.map((r) => r.title)).size).toBe(2);
    });

    it("addresses a triage row by its report rather than a channel", () => {
        const q = buildAttentionQueue({
            attention: [
                item({
                    kind: "radar-triage",
                    key: "radar:r-1",
                    channelid: "",
                    channelname: "",
                    runid: "",
                    source: "arc",
                    text: "4 findings need triage.",
                    action: "Triage",
                    oref: "radarreport:r-1",
                }),
            ],
            efforts: [],
        });
        expect(q[0]!.nav).toEqual({ kind: "radar", oref: "radarreport:r-1" });
        // the no-channel rule used to strip the action off any row without a channel, which would have
        // left the one row that DOES have a destination looking inert.
        expect(q[0]!.action).toBe("Triage");
        expect(q[0]!.detail).toBe("arc");
    });

    it("degrades a triage row with no report to static rather than inventing a target", () => {
        const q = buildAttentionQueue({
            attention: [item({ kind: "radar-triage", key: "radar:r-1", channelid: "", channelname: "", runid: "" })],
            efforts: [],
        });
        expect(q[0]!.nav).toBeNull();
        expect(q[0]!.action).toBeNull();
    });

    // a channel-backed item must not be re-routed just because a stray oref rode along.
    it("prefers the channel for any kind that is not triage", () => {
        const q = buildAttentionQueue({
            attention: [item({ kind: "dag-gate", oref: "radarreport:r-1" })],
            efforts: [],
        });
        expect(q[0]!.nav).toEqual({ kind: "channel", channelId: "ch-1", runId: "r1" });
    });

    // F8: the row carries the initiative, the derived why-line and the citations. The title is joined
    // here from the efforts the Brief already holds, so an initiative's name has one source.
    it("joins the initiative title from the efforts it already has and appends the chunk", () => {
        const q = buildAttentionQueue({
            attention: [item({ effortoid: "e-7", chunklabel: "rebase and squash" })],
            efforts: [{ oref: "effort:e-7", title: "Attention reliability", blockedChunks: [] } as EffortCardModel],
        });
        expect(q[0]!.attrib).toBe("Attention reliability · rebase and squash");
    });

    it("keeps the chunk when the effort is not one the Brief is holding", () => {
        const q = buildAttentionQueue({
            attention: [item({ effortoid: "gone", chunklabel: "backfill" })],
            efforts: [],
        });
        expect(q[0]!.attrib).toBe("backfill");
    });

    it("names no initiative for a run that is not attributed to one", () => {
        const q = buildAttentionQueue({ attention: [item({})], efforts: [] });
        expect(q[0]!.attrib).toBe("");
        expect(q[0]!.why).toBe("");
        expect(q[0]!.cites).toEqual([]);
    });

    it("passes the server's why-line and citations through unchanged", () => {
        const q = buildAttentionQueue({
            attention: [
                item({
                    why: "The plan phase finished — 1 of 2 done. The execute phase starts only when you approve.",
                    cites: ["docs/plans/auth.md", "pkg/auth/plan.go"],
                }),
            ],
            efforts: [],
        });
        expect(q[0]!.why).toBe(
            "The plan phase finished — 1 of 2 done. The execute phase starts only when you approve."
        );
        expect(q[0]!.cites).toEqual(["docs/plans/auth.md", "pkg/auth/plan.go"]);
    });

    it("still falls through to the raw wire kind for a kind it has never seen", () => {
        const q = buildAttentionQueue({ attention: [item({ kind: "some-future-kind", key: "f1" })], efforts: [] });
        expect(q[0]!.kind).toBe("some-future-kind");
    });

    it("puts blocked chunks after the wire rows and leaves them ageless", () => {
        const efforts = projectBriefing(
            input({
                projects: [{ project: "waveterm", active: [], shipped: [], events: [], delta: [] }],
                efforts: EFFORT_FIXTURES,
                sources: { runs: true, sessions: true, dossiers: true, efforts: true, attention: "volatile" },
            })
        ).efforts;
        const q = buildAttentionQueue({ attention: [item({})], efforts });
        expect(q.map((r) => r.kind)).toEqual(["dag gate", "chunk blocked"]);
        expect(q[1]!.ts).toBeNull();
    });
});

describe("a blocked chunk's waiting row", () => {
    const withDetail = (
        oref: string,
        title: string,
        blocked: Record<string, { since: number | null; needs: string }>
    ) =>
        ({
            oref,
            title,
            blockedChunks: Object.keys(blocked),
            blockedDetail: blocked,
        }) as unknown as EffortCardModel;

    it("says what it needs, how long it has waited, and carries the chunk its buttons act on", () => {
        const latest = { ts: T0 - HOUR, text: "the blocker is gone on DEV", chunk: "Phase 5" };
        const efforts = [
            {
                ...withDetail("effort:e-1", "Gate", {
                    "Phase 5": { since: T0 - 3 * DAY, needs: "needs: SRE sign-off" },
                }),
                blockedDetail: { "Phase 5": { since: T0 - 3 * DAY, needs: "needs: SRE sign-off", latest } },
            } as EffortCardModel,
        ];
        const [row] = buildAttentionQueue({ attention: [], efforts });
        expect(row).toMatchObject({
            kind: "chunk blocked",
            title: "Phase 5",
            detail: "Gate",
            ts: T0 - 3 * DAY,
            why: "needs: SRE sign-off",
            wireKind: "chunk-blocked",
            chunk: { effortOref: "effort:e-1", label: "Phase 5", needs: "needs: SRE sign-off", latest },
        });
    });

    it("puts blocked chunks and records after the wire rows, oldest first, unaged last", () => {
        const q = buildAttentionQueue({
            attention: [attentionItem({ kind: "ask", key: "ask:new", text: "the ask", waitingsince: T0 - HOUR })],
            efforts: [
                withDetail("effort:a", "A", {
                    "a-2d": { since: T0 - 2 * DAY, needs: "" },
                    "a-unaged": { since: null, needs: "" },
                }),
                withDetail("effort:b", "B", { "b-22d": { since: T0 - 22 * DAY, needs: "" } }),
            ],
            blockers: [{ oref: "task:r", objective: "rec-14d", blockers: "", project: null, ts: T0 - 14 * DAY }],
        });
        expect(q.map((r) => r.title)).toEqual(["the ask", "b-22d", "rec-14d", "a-2d", "a-unaged"]);
    });

    it("offers Unblock and Done in place of Open, and a wire row keeps its one button", () => {
        const [chunk] = buildAttentionQueue({
            attention: [],
            efforts: [withDetail("effort:a", "A", { c: { since: null, needs: "" } })],
        });
        expect(queueActions(chunk).map((a) => [a.label, a.kind])).toEqual([
            ["Unblock", "unblock-chunk"],
            ["Done", "done-chunk"],
        ]);
        const [ask] = buildAttentionQueue({ attention: [attentionItem({ kind: "ask", key: "a" })], efforts: [] });
        expect(queueActions(ask).map((a) => a.label)).toEqual(["Open"]);
    });
});

describe("Unblock and Done on a blocked chunk's row", () => {
    const [blocked] = buildAttentionQueue({
        attention: [],
        efforts: [
            {
                oref: "effort:e1",
                title: "Nav rail",
                blockedChunks: ["S6 soak"],
                blockedDetail: { "S6 soak": { since: T0 - DAY, needs: "needs: a DEV soak" } },
            } as unknown as EffortCardModel,
        ],
    });
    const fakeDeps = (fail = false) => ({
        setChunkStatus: vi.fn(() => (fail ? Promise.reject(new Error("refused")) : Promise.resolve())),
        undo: { notify: vi.fn(), error: vi.fn() },
    });

    it("unblocks to pending, and its undo blocks it again with what it needs", async () => {
        const deps = fakeDeps();
        await actOnChunk(deps, blocked, "unblock-chunk");
        expect(deps.setChunkStatus).toHaveBeenCalledWith("effort:e1", "S6 soak", "pending");
        const [text, undo] = deps.undo.notify.mock.calls[0] as unknown as [string, () => void];
        expect(text).toBe("Unblocked · S6 soak");
        undo();
        expect(deps.setChunkStatus).toHaveBeenLastCalledWith("effort:e1", "S6 soak", "blocked", "needs: a DEV soak");
    });

    it("marks done, and its undo blocks it again too", async () => {
        const deps = fakeDeps();
        await actOnChunk(deps, blocked, "done-chunk");
        expect(deps.setChunkStatus).toHaveBeenCalledWith("effort:e1", "S6 soak", "done");
        const [text, undo] = deps.undo.notify.mock.calls[0] as unknown as [string, () => void];
        expect(text).toBe("Done · S6 soak");
        undo();
        expect(deps.setChunkStatus).toHaveBeenLastCalledWith("effort:e1", "S6 soak", "blocked", "needs: a DEV soak");
    });

    it("blocks it again with no note when it recorded none", async () => {
        const deps = fakeDeps();
        await actOnChunk(deps, { ...blocked, chunk: { ...blocked.chunk!, needs: "" } }, "unblock-chunk");
        (deps.undo.notify.mock.calls[0] as unknown as [string, () => void])[1]();
        expect(deps.setChunkStatus).toHaveBeenLastCalledWith("effort:e1", "S6 soak", "blocked", undefined);
    });

    it("shows a refused write instead of a success toast, and does nothing for a row that is no chunk", async () => {
        const deps = fakeDeps(true);
        await actOnChunk(deps, blocked, "done-chunk");
        expect(deps.undo.error).toHaveBeenCalledWith("refused");
        expect(deps.undo.notify).not.toHaveBeenCalled();
        const idle = fakeDeps();
        await actOnChunk(idle, { ...blocked, chunk: undefined }, "done-chunk");
        expect(idle.setChunkStatus).not.toHaveBeenCalled();
    });
});

describe("summarizeAttentionQueue", () => {
    const chunks = (oref: string, n: number) =>
        ({
            oref,
            title: oref,
            blockedChunks: Array.from({ length: n }, (_, i) => `c${i}`),
            blockedDetail: Object.fromEntries(
                Array.from({ length: n }, (_, i) => [`c${i}`, { since: T0 - (i + 1) * DAY, needs: "" }])
            ),
        }) as unknown as EffortCardModel;

    it("is empty for an empty queue", () => {
        expect(summarizeAttentionQueue([], T0)).toBe("");
    });

    it("counts each kind once and names the oldest wait", () => {
        const queue = buildAttentionQueue({
            attention: [
                attentionItem({ kind: "ask", key: "a1", waitingsince: T0 - DAY }),
                attentionItem({ kind: "ask", key: "a2", waitingsince: T0 - HOUR }),
            ],
            efforts: [],
        });
        expect(summarizeAttentionQueue(queue, T0)).toBe("2 asks · oldest 1d");
        expect(summarizeAttentionQueue(queue.slice(0, 1), T0)).toBe("ask · oldest 1d");
    });

    it("counts blocked chunks once and names how many initiatives they span", () => {
        const queue = buildAttentionQueue({ attention: [], efforts: [chunks("effort:a", 7), chunks("effort:b", 3)] });
        expect(summarizeAttentionQueue(queue, T0)).toBe("10 blocked · 2 initiatives · oldest 7d");
        // oldest first, so the first row of the two lists is the 7-day-old one
        expect(summarizeAttentionQueue(queue.slice(0, 1), T0)).toBe("blocked · 1 initiative · oldest 7d");
    });
});

describe("oldestWaitingTs", () => {
    it("is the longest wait, ignoring rows that do not know theirs", () => {
        const queue = buildAttentionQueue({
            attention: [
                attentionItem({ kind: "dag-gate", key: "g1", waitingsince: 0 }),
                attentionItem({ kind: "ask", key: "a1", waitingsince: T0 - HOUR }),
                attentionItem({ kind: "radar-triage", key: "radar:two", waitingsince: T0 - DAY }),
            ],
            efforts: [],
        });
        expect(oldestWaitingTs(queue)).toBe(T0 - DAY);
        expect(oldestWaitingTs(queue.slice(0, 1))).toBeNull();
        expect(oldestWaitingTs([])).toBeNull();
    });
});

describe("capRegion", () => {
    const rows = Array.from({ length: 5 }, (_, i) => ({ id: i }));

    it("shows the window and reports what it hid", () => {
        expect(capRegion(rows, 3, false)).toEqual({ rows: rows.slice(0, 3), more: 2 });
    });

    it("shows everything and hides nothing once the region is expanded", () => {
        expect(capRegion(rows, 3, true)).toEqual({ rows, more: 0 });
    });

    // the count has to come off the slice, not off the cap: a region shorter than its window hid nothing
    it("reports no overflow for a region that never reached its cap", () => {
        expect(capRegion(rows, 9, false)).toEqual({ rows, more: 0 });
    });
});

describe("the Waiting strip", () => {
    it("shows the most urgent item inline and no rows while Show all is shut", () => {
        expect(waitingStrip(["a", "b", "c"], false)).toEqual({ head: "a", rows: [] });
    });
    it("opens every item as a row, in the queue's order, with Show all", () => {
        expect(waitingStrip(["a", "b", "c"], true)).toEqual({ head: "a", rows: ["a", "b", "c"] });
    });
    it("has no strip with nothing waiting", () => {
        expect(waitingStrip([], true)).toEqual({ head: null, rows: [] });
    });
});

// The queue is the one region whose rows are INERT without this: the decision a row waits on is resolved by
// the run body, so a row that cannot open its run cannot be acted on at all.
describe("queueOpenTarget", () => {
    it("opens a run's own sheet, carrying the run so the sheet lands on it rather than the channel's default", () => {
        expect(queueOpenTarget({ kind: "channel", channelId: "c1", runId: "r1" })).toEqual({
            kind: "channel",
            channelId: "c1",
            runId: "r1",
        });
    });

    it("opens a channel with no run named, which is the launcher", () => {
        expect(queueOpenTarget({ kind: "channel", channelId: "c1", runId: null })).toEqual({
            kind: "channel",
            channelId: "c1",
            runId: null,
        });
    });

    // a triage row and a blocked chunk are the two kinds addressed by oref instead of by channel; both have
    // their own surface, and routing them through the same router is what stops a second one existing.
    it.each([
        { kind: "radar" as const, oref: "radarreport:rr1" },
        { kind: "effort" as const, oref: "effort:e1" },
        { kind: "council" as const, oref: "council:c1" },
    ])("routes $kind through its own oref", (nav) => {
        expect(queueOpenTarget(nav)).toEqual({ kind: "oref", oref: nav.oref });
    });

    it("leaves a standalone row with no destination inert", () => {
        expect(queueOpenTarget(null)).toBeNull();
    });
});

describe("design queue wording", () => {
    const q = (over: Partial<QueueRow>): QueueRow =>
        ({
            key: "k" + Math.random(),
            kind: "dag gate",
            wireKind: "dag-gate",
            title: "t",
            source: "s",
            detail: "",
            ts: null,
            action: "Review",
            nav: null,
            tone: "asking",
            attrib: "",
            why: "",
            cites: [],
            channelId: "c1",
            runId: "r1",
            taskId: "",
            retry: false,
            ...over,
        }) as QueueRow;
    // a kind with no word of its own used to read "blocked", so an unverified run sat beside a stuck task as its twin
    it("gives every wire kind its own word", () => {
        expect(
            ["run-unverified", "run-land-held", "run-queue-blocked", "learn-proposal"].map((wireKind) =>
                queueKindLabel(q({ wireKind }))
            )
        ).toEqual(["unverified", "held", "not started", "rule"]);
    });
    it("maps each wire kind to its in-place action", () => {
        expect(queueAction(q({ wireKind: "dag-gate", taskId: "t-3" }))).toEqual({
            label: "Approve",
            kind: "approve-dag",
        });
        expect(queueAction(q({ wireKind: "dag-gate", taskId: "" }))).toEqual({ label: "Open", kind: "open" });
        expect(queueAction(q({ wireKind: "dag-blocked", taskId: "t-4", retry: true }))).toEqual({
            label: "Retry",
            kind: "retry-dag",
        });
        expect(queueAction(q({ wireKind: "dag-blocked", taskId: "t-2", retry: false }))).toEqual({
            label: "Open",
            kind: "open",
        });
        expect(queueAction(q({ wireKind: "ask" }))).toEqual({ label: "Open", kind: "open" });
        expect(queueAction(q({ wireKind: "run-unverified" }))).toEqual({ label: "Accept", kind: "ack-run" });
        expect(queueAction(q({ wireKind: "run-unverified", runId: null }))).toEqual({ label: "Open", kind: "open" });
        expect(queueAction(q({ wireKind: "run-land-held" }))).toEqual({ label: "Land again", kind: "land-run" });
        expect(queueAction(q({ wireKind: "run-land-held", runId: null }))).toEqual({ label: "Open", kind: "open" });
    });
    it("accepts all only the rows whose own button is Accept", () => {
        const rows = [
            q({ wireKind: "run-unverified", channelId: "c1", runId: "r1" }),
            q({ wireKind: "dag-gate", runId: "r2" }),
            q({ wireKind: "run-unverified", runId: null }),
            q({ wireKind: "run-unverified", channelId: "", runId: "r4" }),
            q({ wireKind: "run-unverified", channelId: "c5", runId: "r5" }),
        ];
        expect(ackableRuns(rows)).toEqual([
            { channelId: "c1", runId: "r1" },
            { channelId: "c5", runId: "r5" },
        ]);
    });
    it("a blocked queue entry starts now in place, from the queue id its item carries", () => {
        const [row] = buildAttentionQueue({
            attention: [
                attentionItem({
                    kind: "run-queue-blocked",
                    key: "run-queue-blocked:q-1a2b",
                    channelid: "",
                    channelname: "",
                    runid: "",
                    queueid: "q-1a2b",
                    source: "Learned additions",
                    text: "Did not start: Rail was held: dirty",
                    action: "Start",
                }),
            ],
            efforts: [],
        });
        expect(row.kind).toBe("not started");
        expect(row.queueId).toBe("q-1a2b");
        expect(row.nav).toBeNull();
        expect(queueAction(row)).toEqual({ label: "Start now", kind: "start-queued" });
        expect(queueAction({ ...row, queueId: undefined })).toEqual({ label: "Open", kind: "open" });
    });
    it("a record blocker joins the queue as blocked and opens its record", () => {
        const rows = buildAttentionQueue({
            attention: [],
            efforts: [],
            blockers: [{ oref: "task:d1", objective: "Clear the gate", blockers: "waits on SRE", project: "p", ts: 5 }],
        });
        expect(rows).toHaveLength(1);
        expect(queueKindLabel(rows[0])).toBe("blocked");
        expect(rows[0].nav).toEqual({ kind: "record", oref: "task:d1" });
        expect(queueOpenTarget(rows[0].nav)).toEqual({ kind: "oref", oref: "task:d1" });
    });
});

describe("buildAttentionQueue: a chunk that came due", () => {
    const due = {
        kind: "chunk-due",
        key: "chunk-due:e1:re-measure:2026-10-20",
        source: "Nav rail",
        text: "re-measure",
        action: "Open",
        phaseidx: 0,
        waitingsince: 1000,
        oref: "effort:e1",
        effortoid: "e1",
        chunklabel: "re-measure",
        why: "Due 2026-10-20.",
    } as AttentionItem;
    it("opens its initiative and reads as due, with Work on in place", () => {
        const [row] = buildAttentionQueue({ attention: [due], efforts: [] });
        expect(row.nav).toEqual({ kind: "effort", oref: "effort:e1" });
        expect(row.action).toBe("Open");
        expect(row.attrib).toBe("");
        expect(queueKindLabel(row)).toBe("due");
        expect(queueAction(row)).toEqual({ label: "Work on", kind: "work-on" });
        expect(queueOpenTarget(row.nav)).toEqual({ kind: "oref", oref: "effort:e1" });
    });
    it("says Go to agent while an agent is open on its initiative, and only that initiative", () => {
        const on = buildAttentionQueue({
            attention: [due],
            efforts: [],
            roster: [agent({ id: "t7", effortId: "e1" })],
        });
        expect(queueAction(on[0])).toEqual({ label: "Go to agent", kind: "work-on" });
        const off = buildAttentionQueue({
            attention: [due],
            efforts: [],
            roster: [agent({ id: "t7", effortId: "e2" })],
        });
        expect(queueAction(off[0])).toEqual({ label: "Work on", kind: "work-on" });
    });
    it("stands for the chunk when it is also blocked", () => {
        const efforts = [
            { oref: "effort:e1", title: "Nav rail", blockedChunks: ["re-measure", "other"] } as EffortCardModel,
        ];
        const q = buildAttentionQueue({ attention: [due], efforts });
        expect(q.map((r) => [r.wireKind, r.title])).toEqual([
            ["chunk-due", "re-measure"],
            ["chunk-blocked", "other"],
        ]);
    });
});

describe("buildAttentionQueue: a plan to review", () => {
    const plan = {
        kind: "plan-review",
        key: "plan-review:e1",
        source: "Nav rail",
        text: "2 proposed",
        action: "Review",
        phaseidx: 0,
        waitingsince: 1000,
        oref: "effort:e1",
        effortoid: "e1",
        why: "An agent proposed these chunks. They count once you accept them.",
    } as AttentionItem;
    const efforts = [{ oref: "effort:e1", title: "Nav rail", blockedChunks: [] } as unknown as EffortCardModel];

    it("opens its initiative when no agent is open on it, and reads as a plan", () => {
        const [row] = buildAttentionQueue({ attention: [plan], efforts });
        expect(row.kind).toBe("plan");
        expect(row.nav).toEqual({ kind: "effort", oref: "effort:e1" });
        expect(row.action).toBe("Review");
        expect(row.attrib).toBe("");
        expect(row.detail).toBe("Nav rail");
        expect(queueKindLabel(row)).toBe("plan");
        expect(queueAction(row)).toEqual({ label: "Open", kind: "open" });
        expect(queueOpenTarget(row.nav)).toEqual({ kind: "oref", oref: "effort:e1" });
    });

    it("opens the agent open on its initiative", () => {
        const roster = [agent({ id: "t7", effortId: "e1", state: "idle" })];
        const [row] = buildAttentionQueue({ attention: [plan], efforts, roster });
        expect(row.nav).toEqual({ kind: "agent", oref: "agent:t7" });
        expect(queueOpenTarget(row.nav)).toEqual({ kind: "oref", oref: "agent:t7" });
    });

    it("ignores an agent on another initiative", () => {
        const roster = [agent({ id: "t7", effortId: "e2", state: "idle" })];
        const [row] = buildAttentionQueue({ attention: [plan], efforts, roster });
        expect(row.nav).toEqual({ kind: "effort", oref: "effort:e1" });
    });
});

describe("buildAttentionQueue: a council waiting on you", () => {
    const council = {
        kind: "council",
        key: "council:c1",
        source: "",
        text: "Council waiting on you: Rail apps",
        action: "Open",
        phaseidx: 0,
        waitingsince: 1000,
        oref: "council:c1",
    } as AttentionItem;

    it("is a row that opens its council, in the asking tone", () => {
        const [row] = buildAttentionQueue({ attention: [council], efforts: [] });
        expect(row.kind).toBe("Council");
        expect(row.title).toBe("Council waiting on you: Rail apps");
        expect(row.action).toBe("Open");
        expect(row.tone).toBe("asking");
        expect(row.nav).toEqual({ kind: "council", oref: "council:c1" });
        expect(queueKindLabel(row)).toBe("council");
        expect(queueAction(row)).toEqual({ label: "Open", kind: "open" });
        expect(queueOpenTarget(row.nav)).toEqual({ kind: "oref", oref: "council:c1" });
    });

    it("stays static when the server sent no oref", () => {
        const [row] = buildAttentionQueue({ attention: [{ ...council, oref: "" } as AttentionItem], efforts: [] });
        expect([row.action, row.nav]).toEqual([null, null]);
    });
});

describe("kindWord", () => {
    it("is the Brief's short kind for a wire kind", () => {
        expect(kindWord("ask")).toBe("ask");
        expect(kindWord("escalation")).toBe("ask");
        expect(kindWord("dag-gate")).toBe("gate");
        expect(kindWord("plan-review")).toBe("plan");
        expect(kindWord("learn-proposal")).toBe("rule");
        expect(kindWord("council")).toBe("council");
        expect(kindWord("dag-blocked", true)).toBe("failed");
        expect(kindWord("dag-blocked")).toBe("blocked");
    });
});
