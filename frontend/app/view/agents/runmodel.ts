// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Pure derivations for the Channels Runs view: map a Run/RunPhase (backend types, mirrored via WOS)
// to the view's status pills, phase-node states, the current/gated phase, and the per-channel default
// view + run selection. No React, no jotai — unit-tested in runmodel.test.ts.

import type { AgentVM } from "./agentsviewmodel";
import { finalStageActivity, runProgress, type Lineage, type RunInfo } from "./runlineage";
import { runStage } from "./runstage";

export type RunStatusTone = "planning" | "review" | "running" | "blocked" | "done" | "failed" | "cancelled";

// a done run on its own branch is not in its base until the branch lands
function landView(land: RunLand): { label: string; tone: RunStatusTone } | undefined {
    switch (land.state) {
        case "pending":
            return { label: "landing", tone: "running" };
        case "held":
            return { label: "land held", tone: "blocked" };
        case "landed":
            return { label: "landed", tone: "done" };
    }
    return undefined;
}

/** Pure: what a run whose plan finished is still doing, in the one stage vocabulary (runstage.ts). The dag finishing
 *  is not the run finishing: its lead wraps up and completes it, and only then does a run on its own branch land. */
export function finishedRunLabel(run: Pick<RunInfo, "dag" | "status" | "land">): string {
    const s = runStage(run);
    return s.key === "wrapping-up" ? "Wrapping up · lead" : s.label;
}

/** Pure: a dag run's line in the Agents tree, the stage first so a cut line keeps it, and its tooltip. Every task
 *  done is not the run done: the final stage, the lead's wrap-up and the land still follow. */
export function dagProgressLabel(
    run: Pick<RunInfo, "dag" | "status" | "land" | "leadStarted">,
    leadless: boolean
): { text: string; title: string } {
    const same = (text: string) => ({ text, title: text });
    const { done, total } = runProgress(run.dag);
    const s = runStage(run);
    if (s.key === "final-check") {
        return same(`Final check · ${finalStageActivity(run.dag?.final) ?? "verifying the merged result"}`);
    }
    if (s.key === "cancelled") {
        // a cancelled run says how far it got
        return same(`Cancelled · ${done}/${total}`);
    }
    if (s.key === "land-held") {
        return same(s.needsYou ? "Land held · needs you" : "Land held");
    }
    if (s.key !== "working" && s.key !== "plan-review" && s.key !== "planning") {
        return same(finishedRunLabel(run));
    }
    const base = `${s.label} · ${done}/${total}`;
    if (leadless) {
        // a plan-path run gets its lead only at its first judgment event, so no lead yet is the normal case: the
        // tooltip says it, the line keeps its room for the count
        return { text: base, title: `${base} · ${run.leadStarted ? "lead closed" : "lead starts if needed"}` };
    }
    return same(base);
}

// runComplete is a run with nothing left to happen: landed, or done with nothing to land. a lead still wrapping up, a
// land in flight or held, and a cancelled run are not complete.
export function runComplete(run: Pick<RunInfo, "dag" | "status" | "land">): boolean {
    return runStage(run).complete;
}

export function runStatusView(status: string, land?: RunLand): { label: string; tone: RunStatusTone } {
    const landed = status === "done" && land != null ? landView(land) : undefined;
    if (landed) {
        return landed;
    }
    switch (status) {
        case "planning":
            return { label: "planning", tone: "planning" };
        case "awaiting-review":
            return { label: "awaiting review", tone: "review" };
        case "plan-review":
            return { label: "reviewing plan", tone: "review" };
        case "executing":
            return { label: "working", tone: "running" };
        case "finalizing":
            return { label: "final check", tone: "running" };
        case "blocked":
            return { label: "blocked", tone: "blocked" };
        case "done":
            return { label: "complete", tone: "done" };
        case "failed":
            return { label: "failed", tone: "failed" };
        case "cancelled":
            return { label: "cancelled", tone: "cancelled" };
        default:
            return { label: status, tone: "planning" };
    }
}

export interface RunRuntimeView {
    runtime: string;
    label: string;
    legacy: boolean;
    valid: boolean;
}

// Strict runtime derivation for a Run: only the persisted run.runtime and the harness catalog. A
// missing or empty runtime means a legacy Claude-only Run (Claude was its historical worker
// implementation); an explicit runtime names the catalog label. An unknown value renders visibly as
// invalid — never as Claude.
export function runRuntimeView(run: Run, harnesses: HarnessInfo[]): RunRuntimeView {
    if (run.runtime == null || run.runtime === "") {
        return { runtime: "claude", label: "Claude · legacy", legacy: true, valid: true };
    }
    const h = harnesses.find((x) => x.runtime === run.runtime);
    if (h == null) {
        return { runtime: run.runtime, label: `Unknown: ${run.runtime}`, legacy: false, valid: false };
    }
    return { runtime: h.runtime, label: h.label, legacy: false, valid: true };
}

export type PhaseTone = "pending" | "running" | "blocked" | "done" | "failed" | "skipped";

export function phaseStateView(state: string): { icon: string; label: string; tone: PhaseTone } {
    switch (state) {
        case "running":
            return { icon: "●", label: "running", tone: "running" };
        case "done":
            return { icon: "✓", label: "done", tone: "done" };
        case "blocked":
            return { icon: "!", label: "blocked", tone: "blocked" };
        case "failed":
            return { icon: "✕", label: "failed", tone: "failed" };
        case "skipped":
            return { icon: "–", label: "skipped", tone: "skipped" };
        default:
            return { icon: "○", label: "pending", tone: "pending" };
    }
}

// The gated phase awaiting approval — non-null only when the run is paused at a review gate. The engine
// halts after a gated phase completes (that phase is `done`, its successor still `pending`).
//
// The attention list's copy of this rule moved server-side (pkg/jarvis/attention.go reviewGateIdx). This
// one stays because the run-detail view needs it per-phase, not per-list: currentPhaseIndex focuses the
// gated phase and phaseThread draws that phase's gate card. Both take a Run and return view state, so
// neither can read the polled attention atom.
export function reviewGate(run: Run): { phaseIdx: number } | null {
    if (run.status !== "awaiting-review") {
        return null;
    }
    const phases = run.phases ?? [];
    // orchestrator: a held running phase resumes in place
    for (let i = 0; i < phases.length; i++) {
        if (phases[i].state === "running" && phases[i].held) {
            return { phaseIdx: i };
        }
    }
    // pipeline: a completed gate whose successor is still pending (or absent)
    for (let i = 0; i < phases.length; i++) {
        if (phases[i].gate && phases[i].state === "done") {
            const next = phases[i + 1];
            if (!next || next.state === "pending") {
                return { phaseIdx: i };
            }
        }
    }
    return null;
}

export function isOrchestrator(run: Run): boolean {
    return run.mode === "orchestrator";
}

// The phase the view focuses: the first running/blocked/failed phase, else the gated phase awaiting review,
// else the last non-skipped phase.
export function currentPhaseIndex(run: Run): number {
    const phases = run.phases ?? [];
    const active = phases.findIndex((p) => p.state === "running" || p.state === "blocked" || p.state === "failed");
    if (active >= 0) {
        return active;
    }
    const gate = reviewGate(run);
    if (gate) {
        return gate.phaseIdx;
    }
    for (let i = phases.length - 1; i >= 0; i--) {
        if (phases[i].state !== "skipped") {
            return i;
        }
    }
    return Math.max(0, phases.length - 1);
}

const TERMINAL = new Set(["done", "failed", "cancelled"]);

export function isTerminal(status: string): boolean {
    return TERMINAL.has(status);
}

export function defaultView(runsLen: number): "runs" | "chat" {
    return runsLen > 0 ? "runs" : "chat";
}

// Most-recent non-terminal run, so the user lands on live work. Undefined when nothing is live — a
// channel's default view is then the fresh-run state ("Start a run"), not the last finished run; a
// finished run only shows when the user picks it explicitly.
export function defaultRunId(runs: Run[] | undefined): string | undefined {
    const list = runs ?? [];
    if (list.length === 0) {
        return undefined;
    }
    const sorted = [...list].sort((a, b) => b.createdts - a.createdts);
    return sorted.find((r) => !isTerminal(r.status))?.id;
}

export function phaseWorkers(phase: RunPhase, agents: AgentVM[]): AgentVM[] {
    const out: AgentVM[] = [];
    for (const oref of phase.workerorefs ?? []) {
        if (!oref.startsWith("tab:")) {
            continue;
        }
        const found = agents.find((a) => a.id === oref.slice(4));
        if (found) {
            out.push(found);
        }
    }
    return out;
}

// Live workers with a roster row whose state is not idle (an exited worker reports idle via the backend
// backstop; a torn-down one has no row at all), read from the run's own phases. Deduped by id across
// phases. Phase workers only: an engine run's DAG tasks are child runs the phases never list — see
// runLiveWorkers for the count a cancel confirmation needs.
export function liveWorkers(run: Run, agents: AgentVM[]): AgentVM[] {
    const out: AgentVM[] = [];
    for (const phase of run.phases ?? []) {
        for (const w of phaseWorkers(phase, agents)) {
            if (w.state !== "idle" && !out.some((o) => o.id === w.id)) {
                out.push(w);
            }
        }
    }
    return out;
}

// Every live worker a cancel would stop: the run's own phase workers and, on an engine run, the workers of its
// DAG tasks. Those are child runs, which the phases never list, and a lead is idle between wakes, so a
// phase-only count read 0 mid-run and Cancel stopped everything without asking. Gates the cancel
// confirmation and sizes its copy.
export function runLiveWorkers(run: Run, agents: AgentVM[], lineage: Lineage): AgentVM[] {
    const out = liveWorkers(run, agents);
    for (const a of agents) {
        const role = lineage.roles[a.id];
        if (
            role?.kind === "worker" &&
            role.leadRunId === run.id &&
            a.state !== "idle" &&
            !out.some((o) => o.id === a.id)
        ) {
            out.push(a);
        }
    }
    return out;
}

// The run's own worker waiting on the human: the lead, or a quick run's one worker. A DAG task's question
// goes to the lead first (the child-ask card), never through the run's own ask card.
export function leadAsker(run: Run, agents: AgentVM[]): AgentVM | undefined {
    return liveWorkers(run, agents).find((w) => w.state === "asking");
}

// Live workers still running under a *cancelled* run — the survivors the partial-failure surface warns
// about. Empty for any non-cancelled run (a running run's live workers are normal, not survivors).
// Derived from the roster via liveWorkers, so it tracks reality: a survivor that later exits drops out; a
// resync-revived one reappears. No persisted survivor state.
export function cancelSurvivors(run: Run, agents: AgentVM[]): AgentVM[] {
    return run.status === "cancelled" ? liveWorkers(run, agents) : [];
}

export interface PhaseThread {
    showAsk: boolean;
    askKind: "clarify" | "fork" | null;
    askAgent?: AgentVM;
    showBoundary: boolean;
    showWorkers: boolean;
    showGate: boolean;
    showStarting: boolean;
    showBlocked: boolean;
    showShip: boolean;
}

// The recorded worker tab ids for a phase (the "tab:" orefs, unprefixed).
export function recordedWorkerTabs(phase: RunPhase): string[] {
    return (phase.workerorefs ?? []).filter((o) => o.startsWith("tab:")).map((o) => o.slice(4));
}

// Which threaded elements a phase renders. Ask (live worker awaiting the human) is a clarify on a
// brainstorm phase, a fork otherwise, and it suppresses the plain worker rows. A recorded worker with no
// status-bearing roster row is either *starting* (its tab still exists — spawned, not yet reported) or
// *gone* (its tab no longer exists → the "worker exited" blocked card). liveTabIds is the set of tab ids
// that currently exist as sessions (roster + plain terminals); pass it to make that distinction — without
// it, a recorded-but-unreported worker reads as gone. Ship = the last phase done on a finished run.
export function phaseThread(run: Run, idx: number, agents: AgentVM[], liveTabIds?: Set<string>): PhaseThread {
    const phases = run.phases ?? [];
    const phase = phases[idx];
    const workers = phaseWorkers(phase, agents);
    const asker = workers.find((w) => w.state === "asking");
    const startedFresh = phase.state !== "pending" && phase.state !== "skipped";
    const recorded = recordedWorkerTabs(phase);
    const unreported = recorded.length > 0 && workers.length === 0;
    const starting = unreported && liveTabIds != null && recorded.some((id) => liveTabIds.has(id));
    const recordedButGone = unreported && !starting;
    return {
        showAsk: !!asker,
        askKind: asker ? (phase.kind === "brainstorm" ? "clarify" : "fork") : null,
        askAgent: asker,
        showBoundary: !!phase.freshctx && startedFresh,
        showWorkers: phase.state === "running" && workers.length > 0 && !asker,
        showGate: reviewGate(run)?.phaseIdx === idx,
        showStarting: phase.state === "running" && starting,
        // failed: the phase's worker stopped (the app restarted, or its process exited) before completing it
        showBlocked:
            phase.state === "blocked" || phase.state === "failed" || (phase.state === "running" && recordedButGone),
        showShip: idx === phases.length - 1 && phase.state === "done" && run.status === "done",
    };
}

// the runtimes whose worker reopens its own session on Resume; an empty runtime is a legacy claude run
const RESUMABLE_RUNTIMES = ["", "claude", "pi"];

// Whether a phase's stopped worker can be resumed in its own session. Mirrors the backend's refusals, so the
// button shows only where the resume can go through: not a dag run (the engine restarts those), a failed
// phase, and a session to reopen.
export function canResume(run: Run, idx: number): boolean {
    return (
        !run.dagoref &&
        run.phases?.[idx]?.state === "failed" &&
        !!run.sessionid &&
        RESUMABLE_RUNTIMES.includes(run.runtime ?? "")
    );
}

// True when the plan editor holds unsaved changes; Approve must flush these first so no edit is lost.
export function planDirty(edited: string, saved: string): boolean {
    return edited !== saved;
}

// The run id to select given the currently-visible tabs: keep the current selection if it is still
// visible, else land on the default (most-recent non-terminal). A finished run therefore only shows
// while explicitly selected — the default view of a channel with nothing live is the fresh-run state.
// NOTE: undefined does NOT mean "no run" — it means "pick one for me", and with a live run present it
// picks that one. Callers wanting an explicit new-run state need their own flag (composingRunAtom); this
// comment used to claim the opposite, which is how "＋ New run" shipped as a no-op.
export function resolveActiveRunId(visibleRuns: Run[], current: string | undefined): string | undefined {
    if (current && visibleRuns.some((r) => r.id === current)) {
        return current;
    }
    return defaultRunId(visibleRuns);
}

// One tone per phase, for a run tab's compact progress dots.
export function phaseProgressDots(run: Run): PhaseTone[] {
    return (run.phases ?? []).map((p) => phaseStateView(p.state).tone);
}

// Stable per-phase ids for the shared no-cascade entrance guard: a newly-appended phase animates in,
// a run switch/first mount is silent (the guard treats a new scope id as already-present).
export function phaseRailIds(run: Run): string[] {
    return (run.phases ?? []).map((_, i) => `p${i}`);
}

// The lead worker of the run's current phase (orchestrator: the single long-lived lead; pipeline: the
// current phase's worker). Undefined when that phase has no live worker. Not terminal-gated so a
// finished run can still surface its last lead's transcript.
export function leadWorker(run: Run, agents: AgentVM[]): AgentVM | undefined {
    const phase = (run.phases ?? [])[currentPhaseIndex(run)];
    if (!phase) {
        return undefined;
    }
    return phaseWorkers(phase, agents)[0];
}

// The worker a Steer targets: the current phase's lead. Undefined on a terminal run (Steer is
// hidden/disabled there) or when that phase has no live worker.
export function steerTarget(run: Run, agents: AgentVM[]): AgentVM | undefined {
    if (isTerminal(run.status)) {
        return undefined;
    }
    return leadWorker(run, agents);
}

// the tree a run works in: its own wave/<runId> tree when its lanes land there, else the project checkout.
// Mirrors jarvis.LandPath.
export function runTree(run: Pick<Run, "projectpath" | "landpath">): string {
    return run.landpath || run.projectpath;
}

// Resolve a phase artifact (normally a project-relative path, occasionally absolute) to a full path
// for FileReadCommand. Absolute paths pass through (POSIX /…, Windows X:\… / X:/…); a relative path
// joins under projectPath with a single separator. A Windows projectPath joined to a POSIX-relative
// artifact yields a mixed-separator path, which the file backend reads fine.
export function resolveArtifactPath(projectPath: string, artifact: string): string {
    if (/^([/\\]|[a-zA-Z]:[/\\])/.test(artifact)) {
        return artifact;
    }
    const base = projectPath.replace(/[/\\]+$/, "");
    const rel = artifact.replace(/^[/\\]+/, "");
    return `${base}/${rel}`;
}
