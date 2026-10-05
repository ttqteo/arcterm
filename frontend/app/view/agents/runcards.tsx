// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The run body's attention/action card family — the gate/ask/blocked/starting/ship/cancel/triage
// pieces shared by the pipeline rail (PhaseRail) and the orchestrator body (OrchestratorBody).
// Extracted from runbody.tsx so RunBody keeps only the run-scoped live machinery. Presentational +
// action-dispatch only; all derivations come from runmodel.ts.

import { REGION_LABEL } from "@/app/view/jarvis/briefstyle";
import { cn, fireAndForget } from "@/util/util";
import { useAtomValue } from "jotai";
import { CircleAlert } from "lucide-react";
import { useState } from "react";
import type { AgentsViewModel } from "./agents";
import type { AgentVM } from "./agentsviewmodel";
import { AttentionBanner, AttentionCard } from "./attentioncard";
import { AskRow, jumpToAgent } from "./channelsprimitives";
import { PlanPreview } from "./planpreview";
import { cancellingRunIdsAtom, confirmCancelRun, resumeRun, stopRunWorker, stoppingWorkerIdsAtom } from "./runactions";
import { canResume, cancelSurvivors, resolveArtifactPath, runLiveWorkers, runTree } from "./runmodel";

// A run stored before slice 5c deleted the plan gate can still carry status awaiting-review. Nothing can
// approve it any more — the actions are gone — so this card explains the stall and shows the plan the run
// was parked on. Cancelling is the only thing left to do with it.
export function ReviewGateCard({ run, gateIdx }: { run: Run; gateIdx: number }) {
    const gatePhase = run.phases[gateIdx];
    const artifact = (gatePhase.artifacts ?? [])[0];
    return (
        <AttentionCard className="mt-3 max-w-[760px]">
            <AttentionBanner glyph="diamond" label="Parked at a review gate" meta={artifact ?? undefined} />
            <div className="px-3.5 py-2.5 text-[11.5px] text-ink-mid">
                This run stopped at a plan gate that no longer exists. Nothing will release it; cancel it, or start a
                new run from its plan.
            </div>
            {artifact ? <PlanPreview path={resolveArtifactPath(runTree(run), artifact)} /> : null}
        </AttentionCard>
    );
}

export function AskCard({ model, agent, kind }: { model: AgentsViewModel; agent: AgentVM; kind: "clarify" | "fork" }) {
    return (
        <AttentionCard className="mt-3 max-w-[760px]" glow>
            <AttentionBanner
                glyph="diamond"
                label={kind === "clarify" ? "Clarifying question" : "Escalated to you — a decision Jarvis can't make"}
            />
            <div className="px-3.5 py-3">
                <AskRow model={model} agent={agent} />
            </div>
        </AttentionCard>
    );
}

// The run's Cancel control: confirms before stopping live workers, and shows a transient "Cancelling…"
// (disabled) while the synchronous CancelRunCommand waits out each worker. `className` carries each call
// site's own styling; the disabled affordance is shared.
export function CancelRunButton({
    channelId,
    run,
    agents,
    model,
    className,
}: {
    channelId: string;
    run: Run;
    agents: AgentVM[];
    model: AgentsViewModel;
    className: string;
}) {
    const cancelling = useAtomValue(cancellingRunIdsAtom).has(run.id);
    const lineage = useAtomValue(model.lineageAtom);
    return (
        <button
            type="button"
            disabled={cancelling}
            onClick={() => confirmCancelRun(channelId, run.id, runLiveWorkers(run, agents, lineage).length)}
            className={`${className} disabled:opacity-60`}
        >
            {cancelling ? "Cancelling…" : "Cancel run"}
        </button>
    );
}

// Partial-failure surface: on a *cancelled* run whose owned workers are still alive (the bulk kill missed
// one, or a resync revived it), the run must not read as a clean cancel. Renders nothing unless there are
// survivors; otherwise an error-toned card listing each survivor with Take control + a per-worker Stop.
// Derived from the live roster (cancelSurvivors), so a survivor that exits or is stopped drops out.
export function CancelSurvivorsCard({
    model,
    channelId,
    run,
    agents,
}: {
    model: AgentsViewModel;
    channelId: string;
    run: Run;
    agents: AgentVM[];
}) {
    const stopping = useAtomValue(stoppingWorkerIdsAtom);
    const survivors = cancelSurvivors(run, agents);
    if (survivors.length === 0) {
        return null;
    }
    const n = survivors.length === 1 ? "1 worker" : `${survivors.length} workers`;
    return (
        <div className="relative mt-3 max-w-[760px] overflow-hidden rounded-lg border border-error/40 bg-error/10 px-4 py-3">
            <div className="mb-2 flex items-center gap-2">
                <CircleAlert size={13} aria-hidden className="flex-none text-error" />
                <span className={cn(REGION_LABEL, "text-error")}>Cancelled · {n} still running</span>
            </div>
            <p className="mb-3 text-[12.5px] leading-[1.5] text-secondary">
                These workers didn't stop when the run was cancelled. Stop each to finish cancelling, or take control to
                inspect it.
            </p>
            <div className="flex flex-col gap-2">
                {survivors.map((w) => {
                    const busy = stopping.has(w.id);
                    return (
                        <div key={w.id} className="flex items-center gap-2">
                            <span className="min-w-0 flex-1 truncate text-[12.5px] font-semibold text-secondary">
                                {w.name}
                            </span>
                            <button
                                type="button"
                                onClick={() => jumpToAgent(model, w.id)}
                                className="flex-none rounded border border-edge-mid px-3 py-1.5 text-[11.5px] font-semibold text-secondary hover:border-edge-strong"
                            >
                                Take control
                            </button>
                            <button
                                type="button"
                                disabled={busy}
                                onClick={() => fireAndForget(() => stopRunWorker(channelId, run.id, `tab:${w.id}`))}
                                className="flex-none rounded border border-error/50 px-3 py-1.5 text-[11.5px] font-semibold text-error hover:bg-error/10 disabled:opacity-60"
                            >
                                {busy ? "Stopping…" : "Stop"}
                            </button>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

export function BlockedCard({
    model,
    channelId,
    run,
    phaseIdx,
    worker,
    agents,
}: {
    model: AgentsViewModel;
    channelId: string;
    run: Run;
    phaseIdx: number;
    worker?: AgentVM;
    agents: AgentVM[];
}) {
    const [resuming, setResuming] = useState(false);
    const [resumeError, setResumeError] = useState<string | null>(null);
    const resumable = canResume(run, phaseIdx);
    const onResume = () =>
        fireAndForget(async () => {
            setResuming(true);
            setResumeError(null);
            try {
                await resumeRun(channelId, run.id, phaseIdx);
            } catch (e) {
                setResumeError(e instanceof Error ? e.message : String(e));
            } finally {
                setResuming(false);
            }
        });
    return (
        <div className="relative mt-3 max-w-[760px] overflow-hidden rounded-lg border border-error/40 bg-error/10 px-4 py-3">
            <div className="mb-2 flex items-center gap-2">
                <span className="text-[12px] font-bold text-error">!</span>
                <span className="text-[9px] font-semibold uppercase tracking-[.08em] text-error">
                    Blocked · worker stopped
                </span>
            </div>
            <p className="mb-3 text-[12.5px] leading-[1.5] text-secondary">
                The worker for this phase stopped before completing it: the app restarted, or its process exited.{" "}
                {resumable
                    ? "Resume it in its own session, take control to inspect it, or cancel the run."
                    : "Take control to inspect it, or cancel the run."}
            </p>
            {resumeError ? <p className="mb-3 text-[12px] leading-[1.5] text-error">{resumeError}</p> : null}
            <div className="flex items-center gap-2">
                {resumable ? (
                    <button
                        type="button"
                        disabled={resuming}
                        onClick={onResume}
                        className="rounded border border-edge-mid px-3 py-2 text-[12px] font-semibold text-primary hover:border-edge-strong disabled:opacity-60"
                    >
                        {resuming ? "Resuming…" : "Resume"}
                    </button>
                ) : null}
                {worker ? (
                    <button
                        type="button"
                        onClick={() => jumpToAgent(model, worker.id)}
                        className="rounded border border-edge-mid px-3 py-2 text-[12px] font-semibold text-secondary hover:border-edge-strong"
                    >
                        Take control
                    </button>
                ) : null}
                <div className="flex-1" />
                <CancelRunButton
                    channelId={channelId}
                    run={run}
                    agents={agents}
                    model={model}
                    className="rounded border border-edge-mid px-3 py-2 text-[12px] font-semibold text-muted hover:border-error hover:text-error"
                />
            </div>
        </div>
    );
}

// A just-spawned worker whose tab exists but hasn't reported its first status yet. Shown instead of the
// alarming "worker exited" card during the brief boot window; it flips to a live worker row on first status.
export function StartingCard() {
    return (
        <div className="mt-2.5 inline-flex items-center gap-2 rounded-[9px] border border-edge-mid bg-background px-3 py-2">
            <span className="h-[7px] w-[7px] flex-none pulse-soft rounded-full bg-asking" />
            <span className="text-[12px] text-secondary">Worker starting…</span>
        </div>
    );
}

// The adaptive lead's announced quick-vs-plan call for an orchestrate phase (non-blocking; recorded
// via `wsh jarvis triage`). Informational — quick reads as go-ahead (success), plan as deliberate (asking).
export function TriageChip({ triage }: { triage: PhaseTriage }) {
    const quick = triage.verdict === "quick";
    const tone = quick ? "text-success border-success/40 bg-success/10" : "text-asking border-asking/40 bg-warning/10";
    return (
        <div className={"mt-2 inline-flex max-w-[760px] items-center gap-2 rounded border px-2.5 py-1.5 " + tone}>
            <span className="text-[9px] font-semibold uppercase tracking-[.08em]">
                Triage · {triage.verdict}
            </span>
            {triage.note ? <span className="text-[11.5px] leading-[1.4] text-secondary">{triage.note}</span> : null}
        </div>
    );
}

export function ShipMarker() {
    return (
        <div className="mt-2 inline-flex items-center gap-2 rounded-[9px] border border-success/30 bg-success/10 px-3 py-2">
            <span className="text-[12px] text-success">✓</span>
            <span className="text-[12px] font-semibold text-secondary">Done · all phases complete</span>
        </div>
    );
}
