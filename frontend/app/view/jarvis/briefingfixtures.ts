// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// DEV-only briefing fixtures: five load states a human and the CDP verify:ui harness can render
// without a backend. The `load` states are real WorkState shapes — the projection and the view must not
// special-case them — and the timestamps hang off a fixed `now` so the shots are deterministic. Compiled
// out of production builds (only reachable through the briefingFixtureAtom seam, which import.meta.env.DEV
// gates).
import type { AgentVM } from "@/app/view/agents/agentsviewmodel";
import type { BriefingLoadState } from "./briefingstore";

export type BriefingFixtureName = "normal" | "attention" | "empty" | "partial" | "failed";
export interface BriefingFixture {
    load: BriefingLoadState;
    agents: AgentVM[];
    // the waiting-on-you queue reads the live attention poll, not the snapshot, so a fixture has to
    // seed it separately or the queue is invisible in every fixture state.
    attention: AttentionItem[];
}

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.now();

// effort leg fixtures: shared by the briefing projection tests and the dev/CDP fixture states
// (non-UUID oids are fine here — these never flow through ParseORef server-side)
export const EFFORT_FIXTURES: EffortSummary[] = [
    {
        oref: "effort:scenario-gate",
        title: "Scenario gate clearance",
        status: "active",
        done: 2,
        total: 8,
        activechunk: "Phase 3",
        updatedts: NOW - DAY,
        chunks: [
            { label: "Phase 1", status: "done" },
            { label: "Phase 2", status: "done" },
            { label: "Phase 3", status: "active" },
            { label: "Phase 4", status: "deferred" },
            { label: "Phase 5", status: "blocked" },
            { label: "Phase 6", status: "skipped" },
            { label: "Phase 7", status: "pending" },
            { label: "Phase 8", status: "pending" },
        ],
    },
    {
        oref: "effort:reflux",
        title: "Reflux state-layer migration",
        status: "active",
        done: 0,
        total: 14,
        activechunk: "jotai store extraction",
        updatedts: NOW - 2 * DAY,
        chunks: Array.from({ length: 14 }, (_, i) => ({
            label: `slice ${i + 1}`,
            status: i === 0 ? "active" : "pending",
        })),
    },
];

const agents: AgentVM[] = [
    {
        id: "tab-direct",
        name: "loom",
        task: "polish the composer",
        state: "working",
        agent: "claude",
        project: "waveterm",
        activeMs: 4 * 60_000,
    },
];

const normalState: WorkState = {
    projects: [
        {
            project: "waveterm",
            active: [
                {
                    project: "waveterm",
                    kind: "run",
                    title: "Ship the landing briefing",
                    detail: "status: executing",
                    ts: NOW - 2 * DAY,
                    navtarget: "run:r-briefing-1",
                    workerorefs: ["tab:tab-run"],
                },
                {
                    project: "waveterm",
                    kind: "run",
                    title: "Port the usage charts",
                    detail: "status: blocked",
                    ts: NOW - 3 * DAY,
                    navtarget: "run:r-briefing-2",
                },
                {
                    project: "",
                    kind: "blocker",
                    title: "Unify the vault scope model",
                    detail: "needs decision on collection scoping",
                    ts: NOW - DAY,
                    navtarget: "task:d-briefing-1",
                },
            ],
            shipped: [
                {
                    project: "waveterm",
                    runoid: "r-briefing-shipped",
                    goal: "Memory recentralization",
                    summary: "vault is the single source of truth",
                    completedts: NOW - DAY,
                },
            ],
            events: [],
            delta: [
                {
                    ts: NOW - 2 * DAY,
                    kind: "run-created",
                    project: "waveterm",
                    title: "Ship the landing briefing",
                    detail: "status: executing",
                    navtarget: "run:r-briefing-1",
                },
                {
                    ts: NOW - DAY,
                    kind: "run-done",
                    project: "waveterm",
                    title: "Memory recentralization",
                    detail: "vault is the single source of truth",
                    navtarget: "run:r-briefing-shipped",
                },
                { ts: NOW - 3 * DAY, kind: "decision", title: "chose sqlite over a second store" },
            ],
        },
    ],
    sources: { runs: true, sessions: true, dossiers: true, efforts: true, attention: "volatile" },
    efforts: EFFORT_FIXTURES,
};

const attentionState: WorkState = {
    projects: [
        {
            project: "waveterm",
            active: [
                ...(normalState.projects[0].active ?? []),
                {
                    project: "waveterm",
                    kind: "attention",
                    title: "the ask bridge",
                    detail: "Review: check the diff",
                    ts: NOW - DAY,
                    navtarget: "run:r-briefing-1",
                },
            ],
            shipped: normalState.projects[0].shipped,
            events: [],
            delta: [
                ...(normalState.projects[0].delta ?? []),
                {
                    ts: NOW - DAY,
                    kind: "attention",
                    title: "the ask bridge",
                    detail: "Review: check the diff",
                    navtarget: "run:r-briefing-1",
                },
            ],
        },
    ],
    sources: { runs: true, sessions: true, dossiers: true, efforts: true, attention: "volatile" },
    efforts: EFFORT_FIXTURES,
};

const partialState: WorkState = {
    projects: normalState.projects,
    sources: { runs: false, sessions: true, dossiers: true, efforts: true, attention: "volatile" },
};

const emptyState: WorkState = {
    projects: [],
    sources: { runs: true, sessions: true, dossiers: true, efforts: true, attention: "volatile" },
};

const loaded = (state: WorkState): BriefingLoadState => ({
    snapshot: { state, queryStartedAt: NOW, actualCursor: NOW - 7 * DAY, complete: true },
    loading: false,
    error: null,
});

// one of each shape the queue can take: a gate with a run to land on, an escalation, and a
// dag-blocked row carrying the error tone. The attribution, why-line and citations are written the way
// pkg/jarvis/attention.go composes them for these shapes — a fixture whose why-line no server would
// emit would verify a row the app cannot actually produce.
const attentionItems: AttentionItem[] = [
    {
        kind: "dag-gate",
        key: "dag-gate:g-briefing-1:t-2",
        taskid: "t-2",
        channelid: "ch-briefing",
        channelname: "waveterm",
        runid: "r-briefing-1",
        source: "the ask bridge",
        text: "Approve the encoder before the DAG proceeds.",
        action: "Review",
        phaseidx: 1,
        waitingsince: NOW - DAY,
        effortoid: "scenario-gate",
        chunklabel: "Phase 3",
        why: "2 of 4 tasks done. Everything downstream stays queued until this one is released.",
        cites: ["docs/superpowers/plans/ask-bridge.md", "pkg/agentask/encode.go"],
    },
    {
        kind: "escalation",
        key: "esc:m-1",
        channelid: "ch-briefing",
        channelname: "waveterm",
        runid: "r-briefing-1",
        source: "frontend-e2e",
        text: "Confirm the CDP port override before I keep going.",
        action: "Decide",
        phaseidx: 0,
        waitingsince: NOW - 2 * 60 * 1000,
        effortoid: "scenario-gate",
        chunklabel: "Phase 3",
        why: "Jarvis escalated this instead of answering it; frontend-e2e is paused until it is decided.",
    },
    {
        kind: "dag-blocked",
        key: "dag-blocked:g-1",
        channelid: "ch-briefing",
        channelname: "waveterm",
        runid: "r-briefing-2",
        source: "usage charts",
        text: "3 consecutive failures — decide retry/skip.",
        action: "Review",
        phaseidx: 0,
        waitingsince: NOW - DAY,
        why: "5 of 9 tasks done. The group stays stopped until you retry or skip.",
    },
];

export const BRIEFING_FIXTURES: Record<BriefingFixtureName, BriefingFixture> = {
    normal: { load: loaded(normalState), agents, attention: [] },
    attention: { load: loaded(attentionState), agents, attention: attentionItems },
    empty: { load: loaded(emptyState), agents, attention: [] },
    partial: { load: loaded(partialState), agents, attention: [] },
    failed: { load: { snapshot: null, loading: false, error: "fixture failure" }, agents: [], attention: [] },
};
