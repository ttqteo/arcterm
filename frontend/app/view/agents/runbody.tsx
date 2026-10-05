// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The run body: the inner render of a single selected run — header (status + goal), rollup, compact
// stepper, phase rail (pipeline) or orchestrator body, and the gate/ask/blocked/ship/cancel cards.
// Extracted out of RunsView so the merged Channels surface can own the surrounding chrome (run strip,
// two-face composer, profile drawer, context panel) while reusing the phase-rail internals unchanged.
// RunBody owns the run-scoped live machinery: the liveness clock, the transcript streams for the run's
// running-phase workers (what makes the rail narrate live), and the phase-rail entrance guard. Given a
// selected `run` as a prop; steering is the merged surface's composer Talk face, so the body hides the
// old inline Steer affordance (hideSteer). See runmodel.ts for all derivations. The gate/ask/blocked/
// starting/ship/cancel/triage card family lives in runcards.tsx.

import { useSettle } from "@/app/element/motionhooks";
import { cardVariants, computeEntrances, initialEntranceState } from "@/app/element/motiontokens";
import { globalStore } from "@/app/store/jotaiStore";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { STAGE_BAND_INSET, STAGE_GUTTER, STAGE_PROSE, STAGE_SCROLLER } from "@/app/view/jarvis/stagemeasure";
import { cn, fireAndForget } from "@/util/util";
import { useAtomValue } from "jotai";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { openDagLive } from "../orchestrate/dagmodalstate";
import { DagOverview } from "../orchestrate/dagoverview";
import type { AgentsViewModel } from "./agents";
import { streamableTranscriptAgents, type AgentVM } from "./agentsviewmodel";
import { AmbientTags } from "./ambientviews";
import { steerWorker } from "./channelactions";
import { jumpToAgent } from "./channelsprimitives";
import { runAtom } from "./channelsstore";
import { ChildAskCard } from "./childaskcard";
import { ComposerShell } from "./composer-shell";
import { harnessesAtom } from "./harnessstore";
import { InlineMarkdown } from "./inlinemarkdown";
import { MarkdownMessage } from "./markdownmessage";
import {
    AskCard,
    BlockedCard,
    CancelRunButton,
    CancelSurvivorsCard,
    ReviewGateCard,
    ShipMarker,
    StartingCard,
    TriageChip,
} from "./runcards";
import { needsEvidenceSeal } from "./runcompletion";
import { RunCompletion } from "./runcompletionsurface";
import { RunTimeline } from "./runtimelineview";
import {
    cancelSurvivors,
    currentPhaseIndex,
    isOrchestrator,
    isTerminal,
    leadWorker,
    phaseRailIds,
    phaseStateView,
    phaseThread,
    phaseWorkers,
    recordedWorkerTabs,
    runRuntimeView,
    runStatusView,
    steerTarget,
} from "./runmodel";
import { PhaseHistory, RunRollup, RunWorkerCard } from "./runworkercard";
import { sessionSidebarViewModelAtom } from "./session-models/sessionsidebarmodel";
import type { SubagentState } from "./session-models/sessionviewmodel";
import { flattenVisualOrder } from "./session-models/sessionviewmodel";
import { JumpToLatestPill, useStickToBottom } from "./sticktobottom";
import { focusSubagentAtom, subagentsByIdAtom } from "./subagentsstore";
import { useSubagentTracking } from "./subagenttracking";
import { useCardStreams } from "./usecardstreams";

export const TONE_CLASS: Record<string, string> = {
    planning: "text-muted",
    review: "text-asking",
    running: "text-success",
    blocked: "text-error",
    done: "text-success",
    failed: "text-error",
    cancelled: "text-muted",
};

export const PHASE_TONE_CLASS: Record<string, string> = {
    pending: "text-muted",
    running: "text-success",
    blocked: "text-error",
    done: "text-success",
    failed: "text-error",
    skipped: "text-muted",
};

function StatusPill({ status, land, survivorCount = 0 }: { status: string; land?: RunLand; survivorCount?: number }) {
    const base = runStatusView(status, land);
    const label = survivorCount > 0 ? `${base.label} · ${survivorCount} still running` : base.label;
    const toneClass = survivorCount > 0 ? TONE_CLASS.blocked : (TONE_CLASS[base.tone] ?? "text-muted");
    return (
        <span
            className={
                "inline-flex items-center gap-1.5 text-[9px] font-semibold uppercase tabular-nums tracking-[.08em] " +
                toneClass
            }
        >
            <span className="h-1.5 w-1.5 rounded-full bg-current" />
            {label}
        </span>
    );
}

export function CompactStepper({ run, expanded, onToggle }: { run: Run; expanded: boolean; onToggle: () => void }) {
    return (
        <div className="mb-4 flex items-center gap-3 rounded-[11px] border border-border bg-background px-3.5 py-2.5">
            <button type="button" onClick={onToggle} className="w-3.5 flex-none text-[11px] text-muted">
                {expanded ? "▾" : "▸"}
            </button>
            <span className="flex-none text-[9px] font-semibold uppercase tracking-[.1em] text-muted">
                Playbook
            </span>
            <div className="relative flex flex-1 justify-between">
                {(run.phases ?? []).map((p, i) => {
                    const v = phaseStateView(p.state);
                    return (
                        <div key={i} className="flex flex-1 flex-col items-center gap-1.5 text-center">
                            <div
                                className={
                                    "flex h-[18px] w-[18px] flex-none items-center justify-center rounded-full border border-current text-xxxs font-bold " +
                                    (PHASE_TONE_CLASS[v.tone] ?? "text-muted")
                                }
                            >
                                {v.icon}
                            </div>
                            <span className="whitespace-nowrap text-[9px] font-semibold text-secondary">{p.kind}</span>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

// The run header (status + goal) and, unless hidden, the old inline Steer affordance shared by the
// pipeline rail body and the orchestrator body. Steer state is owned by the caller and passed down so it
// resets on run switch. The steer target is the current phase's lead (steerTarget); the button is
// disabled when there is none (terminal run / no live worker). The merged surface passes hideSteer — its
// composer Talk face replaces the inline Steer affordance entirely.
export function RunHeader({
    run,
    agents,
    channel,
    steering,
    steerDraft,
    setSteerDraft,
    onSteerToggle,
    onSteerClose,
    hideSteer,
}: {
    run: Run;
    agents: AgentVM[];
    channel: Channel;
    steering: boolean;
    steerDraft: string;
    setSteerDraft: (s: string) => void;
    onSteerToggle: () => void;
    onSteerClose: () => void;
    hideSteer?: boolean;
}) {
    const target = steerTarget(run, agents);
    const [goalExpanded, setGoalExpanded] = useState(false);
    const runtimeHarnesses = useAtomValue(harnessesAtom);
    const runtimeView = runRuntimeView(run, runtimeHarnesses);
    return (
        <>
            <div className="mb-4 flex items-start gap-3">
                <div className="min-w-0 flex-1">
                    <div className="mb-1.5 flex items-center gap-2">
                        <StatusPill
                            status={run.status}
                            land={run.land}
                            survivorCount={cancelSurvivors(run, agents).length}
                        />
                        <span
                            data-testid="run-runtime"
                            data-run-legacy={runtimeView.legacy ? "true" : "false"}
                            className="inline-flex items-center gap-1.5 text-[9px] font-semibold uppercase tracking-[.08em] text-muted"
                        >
                            <span className="h-1.5 w-1.5 rounded-full bg-current opacity-60" />
                            {runtimeView.label}
                        </span>
                        <AmbientTags oref={`run:${run.id}`} />
                    </div>
                    {/* the collapsed goal is a two-line heading and takes the width; expanded it becomes real
                        prose (markdown, paragraphs) and caps at a reading measure */}
                    <div
                        onClick={() => setGoalExpanded((v) => !v)}
                        title={goalExpanded ? "Collapse" : "Expand"}
                        className="w-full cursor-pointer text-[19px] font-bold leading-tight tracking-[-0.01em] text-primary hover:opacity-90"
                    >
                        {goalExpanded ? (
                            <MarkdownMessage
                                text={run.goal}
                                className={cn(STAGE_PROSE, "text-[15px] font-semibold leading-snug text-primary")}
                            />
                        ) : (
                            <div className="line-clamp-2">
                                <InlineMarkdown text={run.goal} />
                            </div>
                        )}
                    </div>
                </div>
                <div className="flex flex-none gap-1.5">
                    {run.dagoref ? (
                        <button
                            type="button"
                            onClick={() => openDagLive(channel.oid, run.id, "dag:" + run.dagoref)}
                            title="Open the engine task DAG for this run"
                            className="cursor-pointer rounded border border-accent/50 px-2.5 py-1.5 text-[11.5px] font-semibold text-accent-soft hover:border-accent"
                        >
                            Open DAG
                        </button>
                    ) : null}
                </div>
                {!hideSteer ? (
                    <div className="flex flex-none gap-1.5">
                        <button
                            type="button"
                            disabled={!target}
                            onClick={onSteerToggle}
                            className="rounded border border-edge-mid px-2.5 py-1.5 text-[11.5px] font-semibold text-secondary hover:border-edge-strong disabled:opacity-40"
                        >
                            Steer
                        </button>
                    </div>
                ) : null}
            </div>
            {!hideSteer && steering && target ? (
                <div className="mb-4 max-w-[760px]">
                    <ComposerShell
                        value={steerDraft}
                        onChange={setSteerDraft}
                        autoFocus
                        placeholder={`Steer ${target.name}…`}
                        sendLabel="Steer ⏎"
                        onSubmit={() => {
                            const text = steerDraft.trim();
                            if (!target || !text) {
                                return;
                            }
                            setSteerDraft("");
                            onSteerClose();
                            fireAndForget(() =>
                                steerWorker({
                                    channelId: channel.oid,
                                    workerORef: `tab:${target.id}`,
                                    agents,
                                    text,
                                })
                            );
                        }}
                    />
                </div>
            ) : null}
        </>
    );
}

// dispatched-agent state -> text tone class (dot + state pill share it via bg-current / text-*)
const SUB_TONE_CLASS: Record<SubagentState, string> = {
    working: "text-accent",
    success: "text-success",
    failure: "text-error",
    done: "text-muted",
};

// Live Task-tool subagents an orchestrator lead has dispatched, rendered as rich rows beneath its
// transcript. Reads the disk-backed subagent store (populated by useSubagentTracking); renders nothing
// until the lead spawns any. A row with a transcript is clickable and opens that child's live interior
// on the agent surface — the same path the Agents tab uses (focusSubagentAtom + jumpToAgent). Finished
// children are kept (a run wants the whole fan-out as history, not just what is still live).
function DispatchedAgents({ model, leadId }: { model: AgentsViewModel; leadId: string }) {
    const subs = useAtomValue(subagentsByIdAtom)[leadId] ?? [];
    if (subs.length === 0) {
        return null;
    }
    const openChild = (s: (typeof subs)[number]) => {
        if (!s.transcriptPath) {
            return;
        }
        globalStore.set(focusSubagentAtom, {
            parentId: leadId,
            agentId: s.id,
            transcriptPath: s.transcriptPath,
            label: s.type || "subagent",
        });
        jumpToAgent(model, leadId);
    };
    return (
        <div className="mt-3 overflow-hidden rounded-[10px] border border-edge-mid bg-background">
            <div className="flex items-center gap-2 border-b border-edge-mid px-3 py-2">
                <span className="text-xxxs font-bold uppercase tracking-[0.1em] text-muted">Dispatched</span>
                <span className="text-[10px] tabular-nums text-secondary">{subs.length}</span>
            </div>
            <div className="sc max-h-[220px] overflow-y-auto py-1">
                {subs.map((s) => {
                    const tone = SUB_TONE_CLASS[s.state] ?? "text-muted";
                    return (
                        <div
                            key={s.id}
                            onClick={() => openChild(s)}
                            className={
                                "flex items-center gap-2.5 px-3 py-1.5 " +
                                (s.transcriptPath ? "cursor-pointer hover:bg-surface-hover" : "")
                            }
                        >
                            <span className="text-[11px] font-semibold text-edge-strong">↳</span>
                            <span
                                className={
                                    "h-2 w-2 flex-none rounded-full bg-current " +
                                    tone +
                                    (s.state === "working" ? " pulse-dot" : "")
                                }
                            />
                            <div className="min-w-0 flex-1">
                                <div className="truncate text-[11.5px] font-semibold text-secondary">
                                    {s.type || "subagent"}
                                </div>
                                {s.model ? (
                                    <div className="truncate font-mono text-[9.5px] text-muted">{s.model}</div>
                                ) : null}
                            </div>
                            <span className={"shrink-0 whitespace-nowrap text-[9.5px] font-medium " + tone}>
                                {s.state}
                            </span>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

// RunExecutionOverview is the run's execution overview (spec 6.1) placed in the body. The dag read lives
// here rather than at the call site so the hook is unconditional: a run without a dag never mounts this.
//
// It renders nothing while the plan gate is still up — the gate card above is already showing the whole
// decomposition, and the engine has not moved yet, so an overview there would only restate the shape.
function RunExecutionOverview({
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
    const dagOref = "dag:" + run.dagoref;
    return <DagOverview channelId={channelId} runId={run.id} dagOref={dagOref} model={model} agents={agents} />;
}

// Dedicated body for an orchestrator run: one long-lived lead in one phase. A flex-fill column so the
// lead transcript grows to the viewport (RunWorkerCard fill), with its dispatched subagents beneath it.
// Reuses the same header/gate/ask/blocked/ship/cancel pieces as the pipeline rail — only the layout is
// orchestrator-specific. Not wrapped in the surface's scroll container: the transcript owns scrolling.
export function OrchestratorBody({
    model,
    channel,
    agents,
    run,
    now,
    liveTabIds,
    steering,
    steerDraft,
    setSteerDraft,
    onSteerToggle,
    onSteerClose,
    hideSteer,
}: {
    model: AgentsViewModel;
    channel: Channel;
    agents: AgentVM[];
    run: Run;
    now: number;
    liveTabIds: Set<string>;
    steering: boolean;
    steerDraft: string;
    setSteerDraft: (s: string) => void;
    onSteerToggle: () => void;
    onSteerClose: () => void;
    hideSteer?: boolean;
}) {
    const idx = currentPhaseIndex(run);
    const thread = phaseThread(run, idx, agents, liveTabIds);
    const lead = leadWorker(run, agents);
    // populate subagentsByIdAtom[lead] for DispatchedAgents (as PhaseRail does for pipeline)
    useSubagentTracking(lead ? [lead] : []);
    return (
        // the lead's transcript scrolls inside RunWorkerCard, so this column carries a scrollbar of its own
        // only when what sits above the transcript outgrows it (a questions card in the Brief's short sheet,
        // which painted over the settings below) — it reserves the same 10px the scrolling bodies lose to
        // theirs, or its measure centres 5px right of every other band on the Stage.
        <div className={cn(STAGE_BAND_INSET, "sc flex min-h-0 flex-1 flex-col overflow-y-auto")}>
            <div className={cn(STAGE_GUTTER, "flex min-h-0 flex-1 flex-col pb-3 pt-5")}>
                <RunHeader
                    run={run}
                    agents={agents}
                    channel={channel}
                    steering={steering}
                    steerDraft={steerDraft}
                    setSteerDraft={setSteerDraft}
                    onSteerToggle={onSteerToggle}
                    onSteerClose={onSteerClose}
                    hideSteer={hideSteer}
                />
                {/* below the header, not in its row: a flex sibling of the title squeezed it into a column */}
                {run.dagoref ? <ChildAskCard channelId={channel.oid} runId={run.id} /> : null}
                <RunTimeline channel={channel} run={run} />
                <CancelSurvivorsCard model={model} channelId={channel.oid} run={run} agents={agents} />
                {thread.showGate ? <ReviewGateCard run={run} gateIdx={idx} /> : null}
                {thread.showAsk && thread.askAgent && thread.askKind ? (
                    <AskCard model={model} agent={thread.askAgent} kind={thread.askKind} />
                ) : null}
                {/* above the lead card, not inside it: since S5b a plan-path run has no lead until the
                    first judgment event, and this is the only thing that says what the engine is doing
                    while there is none */}
                {run.dagoref ? (
                    <RunExecutionOverview model={model} channelId={channel.oid} run={run} agents={agents} />
                ) : null}
                {thread.showWorkers && lead ? (
                    <div className="mt-3 flex min-h-0 flex-1 flex-col">
                        <RunWorkerCard model={model} agent={lead} now={now} fill />
                        <DispatchedAgents model={model} leadId={lead.id} />
                    </div>
                ) : null}
                {thread.showStarting ? <StartingCard /> : null}
                {thread.showBlocked ? (
                    <BlockedCard
                        model={model}
                        channelId={channel.oid}
                        run={run}
                        phaseIdx={idx}
                        worker={lead}
                        agents={agents}
                    />
                ) : null}
                {thread.showShip ? <ShipMarker /> : null}
                {!isTerminal(run.status) ? (
                    <CancelRunButton
                        channelId={channel.oid}
                        run={run}
                        agents={agents}
                        model={model}
                        className="mt-4 flex-none self-start rounded border border-edge-mid px-3 py-1.5 text-[11.5px] font-semibold text-muted hover:border-error hover:text-error"
                    />
                ) : null}
            </div>
        </div>
    );
}

// The phase-rail node (icon disc + connector). Plays a one-shot settle when the phase completes.
// idx drives the data-phase-id attribute so the run timeline's focus-phase click can scroll to the
// rail node (the worker card renders immediately below it).
function PhaseNode({ tone, icon, done, notLast, idx }: { tone: string; icon: string; done: boolean; notLast: boolean; idx: number }) {
    const settling = useSettle(done);
    return (
        <div data-phase-id={idx} className="flex w-9 flex-none flex-col items-center">
            <div
                className={
                    "flex h-9 w-9 flex-none items-center justify-center rounded-[10px] border border-current text-[14px] font-bold " +
                    (PHASE_TONE_CLASS[tone] ?? "text-muted") +
                    (settling ? " animate-[settle_0.5s_ease-out] motion-reduce:animate-none" : "")
                }
            >
                {icon}
            </div>
            {notLast ? <div className="my-1 min-h-[22px] w-0.5 flex-1 bg-edge-mid" /> : null}
        </div>
    );
}

export function PhaseRail({
    model,
    run,
    agents,
    channelId,
    liveTabIds,
    now,
    entranceIds,
}: {
    model: AgentsViewModel;
    run: Run;
    agents: AgentVM[];
    channelId: string;
    liveTabIds: Set<string>;
    now: number;
    entranceIds: Set<string>;
}) {
    const phases = run.phases ?? [];
    const trackedWorkers = isOrchestrator(run) ? phases.flatMap((p) => phaseWorkers(p, agents)) : [];
    useSubagentTracking(trackedWorkers);
    return (
        <AnimatePresence initial={false}>
            {phases.map((p, i) => {
                const v = phaseStateView(p.state);
                const thread = phaseThread(run, i, agents, liveTabIds);
                const workers = phaseWorkers(p, agents);
                const notLast = i < phases.length - 1;
                return (
                    <motion.div
                        key={i}
                        layout
                        variants={cardVariants}
                        initial={entranceIds.has(`p${i}`) ? "initial" : false}
                        animate="animate"
                    >
                        {thread.showBoundary ? (
                            <div className="my-2 flex items-center gap-3">
                                <div className="h-px flex-1 bg-[repeating-linear-gradient(90deg,var(--color-edge-mid)_0_5px,transparent_5px_10px)]" />
                                <span className="text-[9.5px] font-semibold text-muted">
                                    context cleared → fresh worker
                                </span>
                                <div className="h-px flex-1 bg-[repeating-linear-gradient(90deg,var(--color-edge-mid)_0_5px,transparent_5px_10px)]" />
                            </div>
                        ) : null}
                        <div className="flex gap-4">
                            <PhaseNode tone={v.tone} icon={v.icon} done={p.state === "done"} notLast={notLast} idx={i} />
                            <div className="min-w-0 flex-1 pb-4">
                                <div className="flex items-center gap-2">
                                    <span className="text-[14px] font-bold text-primary">{p.kind}</span>
                                    <span
                                        className={
                                            "text-[9px] font-semibold uppercase tracking-[.06em] " +
                                            (PHASE_TONE_CLASS[v.tone] ?? "text-muted")
                                        }
                                    >
                                        {v.label}
                                    </span>
                                </div>
                                {p.skill ? (
                                    <div className="mt-0.5 font-mono text-[11px] text-muted">{p.skill}</div>
                                ) : null}
                                {p.triage ? <TriageChip triage={p.triage} /> : null}
                                {(p.artifacts ?? []).map((art) => (
                                    <div
                                        key={art}
                                        className="mt-2 inline-flex items-center gap-1.5 rounded-[7px] border border-border bg-background px-2.5 py-1"
                                    >
                                        <span className="text-[11px] text-muted">▸</span>
                                        <span className="font-mono text-[11px] text-secondary">{art}</span>
                                    </div>
                                ))}
                                {thread.showWorkers ? (
                                    <div className="mt-2.5 flex flex-col gap-2">
                                        {workers.map((w) => (
                                            <RunWorkerCard key={w.id} model={model} agent={w} now={now} />
                                        ))}
                                    </div>
                                ) : null}
                                {p.state === "done" ? <PhaseHistory tabIds={recordedWorkerTabs(p)} /> : null}
                                {thread.showGate ? <ReviewGateCard run={run} gateIdx={i} /> : null}
                                {thread.showAsk && thread.askAgent && thread.askKind ? (
                                    <AskCard model={model} agent={thread.askAgent} kind={thread.askKind} />
                                ) : null}
                                {thread.showStarting ? <StartingCard /> : null}
                                {thread.showBlocked ? (
                                    <BlockedCard
                                        model={model}
                                        channelId={channelId}
                                        run={run}
                                        phaseIdx={i}
                                        worker={workers[0]}
                                        agents={agents}
                                    />
                                ) : null}
                                {thread.showShip ? <ShipMarker /> : null}
                            </div>
                        </div>
                    </motion.div>
                );
            })}
        </AnimatePresence>
    );
}

// The inner render of a single selected run — owns the run-scoped live machinery (liveness clock, the
// transcript streams for the run's running-phase workers, and the phase-rail entrance guard) so the
// merged surface just renders <RunBody run={selected} /> and gets the same live behavior RunsView had.
// Steering is the merged surface's composer Talk face, so the body hides the old inline Steer affordance.
export function RunBody({
    model,
    channel,
    agents,
    run: runProp,
}: {
    model: AgentsViewModel;
    channel: Channel;
    agents: AgentVM[];
    run: Run;
}) {
    // Focused run's live content via its run: WOS object (fetched on focus, kept live by the per-object
    // run: broadcasts Phase 2 turned on); falls back to the list entry from activeChannelRunsAtom until the
    // object hydrates. Both track the same run and converge, so the fallback is never wrong.
    const liveRun = useAtomValue(runAtom(runProp.id));
    const run = liveRun ?? runProp;
    const [expanded, setExpanded] = useState(true);

    // clock for liveness cues (quiet >45s) + elapsed labels; also re-runs the stream diff below
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        const t = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(t);
    }, []);

    // done run: show the sealed evidence snapshot. If it isn't sealed yet (pre-feature run), fire the
    // idempotent backfill once — the mirrored channel update re-renders this with run.evidence present.
    useEffect(() => {
        if (needsEvidenceSeal(run)) {
            fireAndForget(() => RpcApi.SealRunEvidenceCommand(TabRpcClient, { channelid: channel.oid, runid: run.id }));
        }
    }, [run.id, run.status, run.evidence]);

    // tab ids of every live session that owns a running term block — read straight from the session
    // model so it includes an agent session that hasn't reported its first agent:status yet. Lets the
    // phase rail tell a *starting* worker (its tab still exists) from a *gone* one (tab destroyed).
    const sidebarVM = useAtomValue(sessionSidebarViewModelAtom);
    const liveTabIds = new Set<string>(
        flattenVisualOrder(sidebarVM)
            .filter((r) => r.termBlockOref)
            .map((r) => r.tabId)
    );

    // no-cascade entrance guard for the phase rail: switching runs / first mount is silent, a newly
    // appended phase animates in once. Scoped to the run id (see motiontokens.computeEntrances).
    const railIds = phaseRailIds(run);
    const entranceRef = useRef(initialEntranceState());
    const { animate: entranceIds } = computeEntrances(entranceRef.current, run.id, railIds);
    const railKey = railIds.join(",");
    useLayoutEffect(() => {
        entranceRef.current = computeEntrances(entranceRef.current, run.id, railIds).state;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [run.id, railKey]);

    // live workers of the running phases — the set we open transcript streams for so the rail narrates
    // them inline. Filtered to those actually streamable (transcript + working/asking/recently-idle).
    const runWorkers = (run.phases ?? []).filter((p) => p.state === "running").flatMap((p) => phaseWorkers(p, agents));

    // own transcript streams for the run's workers via the shared card-stream hook (transcript only;
    // no git tracking here). Streams are module-level and idempotent; this surface and the cockpit grid
    // never co-mount, so ownership doesn't collide.
    const streamable = streamableTranscriptAgents(runWorkers, now);
    useCardStreams(
        streamable.filter((a) => a.transcriptPath).map((a) => ({ id: a.id, path: a.transcriptPath!, agent: a.agent }))
    );

    // the run's primary active worker drives the header "now" rollup
    const primaryWorker =
        runWorkers.find((w) => w.state === "working") ?? runWorkers.find((w) => w.state === "asking") ?? runWorkers[0];

    // auto-follow the run as it grows so the newest phase/worker card clears the composer below. A fresh
    // signature array each render re-pins while the user is at the bottom (releases on scroll-up).
    const stick = useStickToBottom([run.status, railKey, now]);

    const noop = () => {};
    if (run.status === "done" && run.evidence) {
        return <RunCompletion channel={channel} run={run} model={model} />;
    }
    if (isOrchestrator(run)) {
        return (
            <OrchestratorBody
                model={model}
                channel={channel}
                agents={agents}
                run={run}
                now={now}
                liveTabIds={liveTabIds}
                steering={false}
                steerDraft=""
                setSteerDraft={noop}
                onSteerToggle={noop}
                onSteerClose={noop}
                hideSteer
            />
        );
    }
    return (
        <div className="relative flex min-h-0 flex-1 flex-col">
            <div ref={stick.scrollRef} onScroll={stick.onScroll} className={cn(STAGE_SCROLLER, "sc min-h-0 flex-1")}>
                <div className={cn(STAGE_GUTTER, "pb-3 pt-5")}>
                    <RunHeader
                        run={run}
                        agents={agents}
                        channel={channel}
                        steering={false}
                        steerDraft=""
                        setSteerDraft={noop}
                        onSteerToggle={noop}
                        onSteerClose={noop}
                        hideSteer
                    />
                    <RunTimeline channel={channel} run={run} />
                    <CancelSurvivorsCard model={model} channelId={channel.oid} run={run} agents={agents} />
                    {run.status === "executing" && primaryWorker ? <RunRollup agent={primaryWorker} now={now} /> : null}
                    <CompactStepper run={run} expanded={expanded} onToggle={() => setExpanded((e) => !e)} />
                    {expanded ? (
                        <PhaseRail
                            model={model}
                            run={run}
                            agents={agents}
                            channelId={channel.oid}
                            liveTabIds={liveTabIds}
                            now={now}
                            entranceIds={entranceIds}
                        />
                    ) : null}
                    {!isTerminal(run.status) ? (
                        <CancelRunButton
                            channelId={channel.oid}
                            run={run}
                            agents={agents}
                            model={model}
                            className="mt-4 rounded border border-edge-mid px-3 py-1.5 text-[11.5px] font-semibold text-muted hover:border-error hover:text-error"
                        />
                    ) : null}
                </div>
            </div>
            {!stick.atBottom ? <JumpToLatestPill onClick={stick.jumpToBottom} /> : null}
        </div>
    );
}
