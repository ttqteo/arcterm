// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The run face of the Brief's detail sheet (docs/prototype/run-sheet.dc.html): a status read, not a place
// to watch. The lead's and the workers' transcripts live on the Agent surface, which every live row and the
// dock open; what stays here is where the run stands, what needs you, and what it is configured to do.
//
// Three regions, fixed in place across every state: the reading (verb, meter, meta, goal), the body (a
// card for what needs you, then the tasks), and the dock (the configuration line and the run's actions).
// All derivations are runsheetmodel.ts; this file maps them to DOM and to the verbs that already exist.

import * as WOS from "@/app/store/wos";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { diffScopeOfRun, openDiff } from "@/app/view/agents/agentdiffnav";
import type { AgentsViewModel } from "@/app/view/agents/agents";
import type { AgentVM } from "@/app/view/agents/agentsviewmodel";
import { jumpToAgent } from "@/app/view/agents/channelsprimitives";
import { runAtom } from "@/app/view/agents/channelsstore";
import { ChildAskCard } from "@/app/view/agents/childaskcard";
import { userOwnedAsks } from "@/app/view/agents/childaskmodel";
import { childAsksAtom } from "@/app/view/agents/childaskstore";
import { InlineMarkdown } from "@/app/view/agents/inlinemarkdown";
import { MarkdownMessage } from "@/app/view/agents/markdownmessage";
import { endFinalStage, type FinalEndOutcome } from "@/app/view/agents/runactions";
import { AskCard, CancelRunButton, CancelSurvivorsCard } from "@/app/view/agents/runcards";
import { needsEvidenceSeal, verifCounts } from "@/app/view/agents/runcompletion";
import { useRunEvents } from "@/app/view/agents/runeventstore";
import { cancelSurvivors, isTerminal, leadAsker, leadWorker, liveWorkers } from "@/app/view/agents/runmodel";
import { SEG_FILL, STRIP_MAX, taskStrip, taskStripLabel } from "@/app/view/agents/runstrip";
import { eventTitle, tsLabel } from "@/app/view/agents/runtimeline";
import { SectionLabel } from "@/app/view/agents/sectionlabel";
import { attentionQueue, type QueueEntry } from "@/app/view/orchestrate/attentionqueue";
import { formatElapsed, taskBriefs, useDagDigest, type TaskBrief } from "@/app/view/orchestrate/dagdigest";
import { openDagLive, openDagTask } from "@/app/view/orchestrate/dagmodalstate";
import { useDagGroup } from "@/app/view/orchestrate/dagstore";
import { recoverySummary, recoveryText } from "@/app/view/orchestrate/recoverysummary";
import { openTaskWorker, resolveTaskWorker, type TaskWorkerView } from "@/app/view/orchestrate/taskcorrelate";
import { groupEvents, railRows, type EventGroup } from "@/app/view/orchestrate/timelinegroups";
import { groupTime, SpineGlyph } from "@/app/view/orchestrate/timelinerail";
import { cn, fireAndForget } from "@/util/util";
import { atom, useAtomValue, type Atom } from "jotai";
import { ArrowUpRight, ChevronDown, ChevronRight, CornerDownRight } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { RunComposer } from "./briefcomposer";
import { RunSettingsPanel, saveRunAsDefaults, SHEET_BTN } from "./briefrunsheet";
import { finalCheckEntry, shotPath, shotRounds, type FinalCheckEntry, type ShotRound } from "./finalshotsmodel";
import { FinalShotsViewer, VERDICT_DOT } from "./finalshotsviewer";
import { briefEffortIndexAtom, briefRevealChunkAtom } from "./jarvisstore";
import { useLocalImage } from "./localimage";
import { RunReportView } from "./runreportview";
import { runSettingsDraft, type LinkedGroupRead } from "./runsettings";
import {
    doneBody,
    finalStageEndable,
    orderedTasks,
    runGraphRef,
    sheetLead,
    sheetStatus,
    taskRow,
    taskSectionMeta,
    type SheetBar,
    type SheetDagRead,
    type SheetRowAction,
    type SheetStatus,
    type SheetTone,
} from "./runsheetmodel";
import { RunTimingSection } from "./runtimingview";
import { STAGE_PROSE } from "./stagemeasure";

const LINK =
    "cursor-pointer text-[10.5px] text-accent-soft hover:text-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent";
const DOCK_BTN = cn(SHEET_BTN, "bg-transparent px-3 py-1.5 text-[11.5px]");
const DOCK_ACCENT = cn(DOCK_BTN, "border-accent/50 bg-accent/12 text-accent-soft");
const ROW_BTN =
    "inline-flex h-[22px] flex-none cursor-pointer items-center gap-1 rounded-[5px] border border-edge-mid px-[7px] text-[10.5px] text-secondary hover:border-edge-strong hover:text-ink-hi focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent";

const TONE_TEXT: Record<SheetTone, string> = {
    success: "text-success",
    "success-soft": "text-success-soft",
    warning: "text-warning",
    "warning-soft": "text-warning-soft",
    error: "text-error",
    "error-soft": "text-error-soft",
    muted: "text-muted",
    faint: "text-ink-faint",
    accent: "text-accent-soft",
};

const TONE_BG: Record<SheetTone, string> = {
    success: "bg-success",
    "success-soft": "bg-success-soft",
    warning: "bg-warning",
    "warning-soft": "bg-warning-soft",
    error: "bg-error",
    "error-soft": "bg-error-soft",
    muted: "bg-muted",
    faint: "bg-edge-strong",
    accent: "bg-accent",
};

const FINAL_TONE_BG: Record<FinalCheckEntry["tone"], string> = {
    pass: "bg-success",
    fail: "bg-error",
    warn: "bg-warning",
};

type OpenShots = (at: { round: number; scenario?: string }) => void;

const ROW_ACTION_LABEL: Record<Exclude<SheetRowAction, null>, string> = {
    "open-agent": "Open in Agent",
    "open-child-run": "View child run",
    "open-dag-task": "Open DAG",
};

// stable no-run atom for a task that has not been dispatched: runAtom is oref-cached, and the row's hook
// count must not vary with whether the task has a child run
const NO_RUN_ATOM = atom<Run | undefined>(undefined);

type SheetCtx = {
    model: AgentsViewModel;
    channel: Channel;
    run: Run;
    agents: AgentVM[];
    now: number;
    onClose: () => void;
};

export function RunSheet({
    model,
    channel,
    run: runProp,
    onClose,
}: {
    model: AgentsViewModel;
    channel: Channel;
    run: Run;
    onClose: () => void;
}) {
    // the run's live WOS object, falling back to the list entry until it hydrates; both track one run
    const run = useAtomValue(runAtom(runProp.id)) ?? runProp;
    const agents = useAtomValue(model.agentsAtom);
    const now = useAtomValue(model.nowAtom);

    // a done run shows its sealed evidence; one sealed before the feature existed is backfilled once, and the
    // mirrored update re-renders this with run.evidence present
    useEffect(() => {
        if (needsEvidenceSeal(run)) {
            fireAndForget(() => RpcApi.SealRunEvidenceCommand(TabRpcClient, { channelid: channel.oid, runid: run.id }));
        }
    }, [run.id, run.status, run.evidence]);

    const ctx: SheetCtx = { model, channel, run, agents, now, onClose };
    const graph = runGraphRef(run);
    if (graph != null) {
        return <LinkedRunSheet ctx={ctx} dagOref={"dag:" + graph} />;
    }
    return <RunSheetFrame ctx={ctx} dag={null} />;
}

// The dag read is a component boundary rather than hooks inside a branch: a run without a graph never
// subscribes to one.
function LinkedRunSheet({ ctx, dagOref }: { ctx: SheetCtx; dagOref: string }) {
    const digest = useDagDigest(ctx.channel.oid, ctx.run.id, dagOref);
    const [group, loading] = useDagGroup(dagOref);
    const errored = useAtomValue(WOS.getWaveObjectErrorAtom(dagOref));
    const groupRead: LinkedGroupRead = loading ? "loading" : group != null ? "ready" : errored ? "error" : "missing";
    return <RunSheetFrame ctx={ctx} dag={{ digest, group: group ?? null, groupRead }} />;
}

function RunSheetFrame({ ctx, dag }: { ctx: SheetCtx; dag: SheetDagRead | null }) {
    const { run, agents, now, channel } = ctx;
    const asks = useAtomValue(childAsksAtom)[run.id] ?? [];
    const userAsks = userOwnedAsks(asks);
    const asker = leadAsker(run, agents);
    const survivors = cancelSurvivors(run, agents).length;
    const status = sheetStatus({ run, nowMs: now, dag, userAsks, workerAsking: asker != null, survivors });
    const body = doneBody(run);
    const group = dag?.group ?? null;
    const finalEntry = finalCheckEntry(group);
    // the viewer mounts only while open: mounting is what claims the keys and the modal stack
    const [shotsAt, setShotsAt] = useState<{ round: number; scenario?: string } | null>(null);

    return (
        <div data-run-sheet={run.status} className="flex min-h-0 flex-1 flex-col bg-background">
            <Reading run={run} agents={agents} status={status} dag={dag} onRetry={dag?.digest.retry} />
            <div className="sc min-h-0 flex-1 overflow-y-auto px-4 pb-2.5">
                {dag != null ? (
                    <RunTimingSection run={run} digest={dag.digest.digest} tasks={dag.group?.tasks} now={now} />
                ) : null}
                {group != null && finalEntry != null ? (
                    <FinalCheckRow key={run.id} group={group} entry={finalEntry} onOpen={setShotsAt} />
                ) : null}
                {survivors > 0 ? (
                    <CancelSurvivorsCard model={ctx.model} channelId={channel.oid} run={run} agents={agents} />
                ) : null}
                {asker != null ? <AskCard model={ctx.model} agent={asker} kind="clarify" /> : null}
                {dag != null ? (
                    <div className="mt-3.5">
                        <ChildAskCard channelId={channel.oid} runId={run.id} />
                    </div>
                ) : null}
                {/* a filed report is the finished body; a run with none keeps its sealed evidence (design L508, L539) */}
                {body != null ? (
                    body === "report" ? (
                        <RunReportView model={ctx.model} run={run} />
                    ) : (
                        <Evidence ctx={ctx} dag={dag} />
                    )
                ) : (
                    <Tasks ctx={ctx} dag={dag} status={status} asks={asks} />
                )}
            </div>
            {/* the settings face's selector is kept on the dock: checks read it as "a run face is showing". The
                configuration moved up into the reading; the composer sits under the dock (design L571-587). */}
            <footer data-jarvis-brief-sheet-face="settings" className="flex-none border-t border-edge-faint bg-surface">
                <Dock ctx={ctx} group={group} finalEntry={finalEntry} onOpenShots={setShotsAt} />
                <RunComposer model={ctx.model} channel={channel} run={run} onClose={ctx.onClose} />
            </footer>
            {group != null && shotsAt != null ? (
                <FinalShotsViewer group={group} initial={shotsAt} onClose={() => setShotsAt(null)} />
            ) : null}
        </div>
    );
}

// The Final check's latest finished round, collapsed by default (.superpowers/design/final-shots: Main, States).
function FinalCheckRow({ group, entry, onOpen }: { group: TaskGroup; entry: FinalCheckEntry; onOpen: OpenShots }) {
    const [open, setOpen] = useState(false);
    const latest = shotRounds(group).find((r) => r.round === entry.latestRound);
    const openViewer = () => onOpen({ round: entry.latestRound });
    return (
        <div data-run-sheet-final-shots className="border-b border-edge-mid">
            <button
                type="button"
                aria-expanded={open}
                onClick={() => setOpen((o) => !o)}
                className="flex min-h-11 w-full cursor-pointer items-center gap-2 text-left text-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
            >
                <ChevronRight
                    size={14}
                    aria-hidden
                    className={cn("flex-none text-ink-mid transition-transform", open && "rotate-90")}
                />
                <span className="flex-none text-[12px] font-semibold">Final check</span>
                <span className="inline-flex min-w-0 items-center gap-1.5 text-[10.5px] tabular-nums text-secondary">
                    <span className={cn("size-1.5 flex-none rounded-full", FINAL_TONE_BG[entry.tone])} />
                    <span className="truncate">{entry.head}</span>
                </span>
                <span className="ml-auto flex-none text-[11px] tabular-nums text-secondary">{entry.right}</span>
            </button>
            {open ? (
                <div className="flex flex-col gap-2 pb-3 pl-[22px]">
                    {latest != null && entry.strip.length > 0 ? (
                        <div className="grid grid-cols-5 gap-2">
                            {entry.strip.map((s) => (
                                <FinalThumb
                                    key={`${s.name}:${s.file}`}
                                    round={latest}
                                    shot={s}
                                    onOpen={() => onOpen({ round: entry.latestRound, scenario: s.name })}
                                />
                            ))}
                        </div>
                    ) : null}
                    {/* with no shots there is nothing to view, as the disabled dock button says */}
                    {entry.dockDisabled ? (
                        entry.caption != null ? (
                            <span className="text-[11px] text-ink-mid">{entry.caption}</span>
                        ) : null
                    ) : (
                        <span className="text-[11px] text-ink-mid">
                            {entry.caption != null ? `${entry.caption} ` : null}
                            <button
                                type="button"
                                onClick={openViewer}
                                className="cursor-pointer text-accent-soft hover:text-accent"
                            >
                                Open the viewer
                            </button>
                            {entry.caption != null ? " to compare rounds." : null}
                        </span>
                    )}
                </div>
            ) : null}
        </div>
    );
}

function FinalThumb({
    round,
    shot,
    onOpen,
}: {
    round: ShotRound;
    shot: FinalCheckEntry["strip"][number];
    onOpen: () => void;
}) {
    const img = useLocalImage(shotPath(round, shot.file));
    return (
        <button
            type="button"
            aria-label={`Open ${shot.name}`}
            onClick={onOpen}
            className="flex min-w-0 cursor-pointer flex-col gap-1 text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
        >
            <span className="block h-[58px] w-full overflow-hidden rounded-[5px] border border-edge-mid bg-background">
                {img.url != null ? (
                    <img src={img.url} alt="" className="block size-full object-cover object-left-top" />
                ) : null}
            </span>
            <span className="flex min-w-0 items-center gap-[5px]">
                <span className={cn("size-1.5 flex-none rounded-full", VERDICT_DOT[shot.verdict])} />
                <span className="min-w-0 truncate text-[10px] text-secondary">{shot.name}</span>
            </span>
        </button>
    );
}

function Reading({
    run,
    agents,
    status,
    dag,
    onRetry,
}: {
    run: Run;
    agents: AgentVM[];
    status: SheetStatus;
    dag: SheetDagRead | null;
    onRetry?: () => void;
}) {
    const [goalOpen, setGoalOpen] = useState(false);
    const index = useAtomValue(briefEffortIndexAtom);
    const revealChunk = useAtomValue(briefRevealChunkAtom);
    // what the run has spent so far, off its live workers (design L1401)
    const cost = liveWorkers(run, agents).reduce((sum, a) => sum + (a.usage?.costusd ?? 0), 0);
    const ref = run.effortref;
    const effort = ref != null ? index.get(ref.effortoid) : undefined;
    return (
        <div className="flex flex-none flex-col gap-[11px] border-b border-edge-faint px-4 pb-3.5 pt-4">
            <div className="flex items-center gap-[9px]">
                <span
                    className={cn(
                        "h-[7px] w-[7px] flex-none rounded-full",
                        TONE_BG[status.tone],
                        status.pulse && "pulse-dot-slow"
                    )}
                />
                <span
                    data-run-sheet-verb
                    aria-live="polite"
                    className="flex-none text-[15px] font-bold tracking-[-.01em] text-primary"
                >
                    {status.verb}
                </span>
                <span className="min-w-0 text-[13px] leading-[1.35] text-ink-mid">{status.sub}</span>
            </div>
            <SheetBarView bar={status.meter} dag={dag} />
            <RunSettingsPanel
                run={run}
                inline
                meta={
                    <>
                        {status.meta.map((m) => (
                            <span key={m.text} className={m.tone === "muted" ? "text-ink-mid" : TONE_TEXT[m.tone]}>
                                {m.text}
                            </span>
                        ))}
                        {cost > 0 ? <span className="text-ink-mid">${cost.toFixed(2)}</span> : null}
                        {status.retry && onRetry != null ? (
                            <button type="button" onClick={onRetry} className={LINK}>
                                retry
                            </button>
                        ) : null}
                    </>
                }
            />
            {/* collapsed, the goal is a two-line heading; expanded it becomes the prose it was written as. A div,
                not a button: expanded markdown renders block elements a button may not contain. */}
            <div
                onClick={() => setGoalOpen((o) => !o)}
                title={goalOpen ? "Collapse" : "Expand"}
                className="mt-0.5 cursor-pointer text-[17px] font-bold leading-[1.3] tracking-[-.01em] text-primary hover:opacity-90"
            >
                {goalOpen ? (
                    <MarkdownMessage
                        text={run.goal}
                        className={cn(STAGE_PROSE, "text-[14px] font-semibold leading-snug text-primary")}
                    />
                ) : (
                    <div className="line-clamp-2">
                        <InlineMarkdown text={run.goal} />
                    </div>
                )}
            </div>
            {ref != null && effort != null ? (
                <button
                    type="button"
                    title="Open this chunk"
                    onClick={() => revealChunk?.(effort.oref, ref.chunklabel)}
                    className="inline-flex max-w-full cursor-pointer items-center gap-1 self-start text-[10.5px] text-ink-mid hover:text-accent-soft focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
                >
                    <CornerDownRight size={11} aria-hidden className="flex-none text-muted" />
                    <span className="truncate">
                        {effort.title} · {effort.chunkStages[ref.chunklabel] || "unstaged"} · {ref.chunklabel}
                    </span>
                </button>
            ) : null}
        </div>
    );
}

// the shared task strip (the agent tree, the rail and the Cockpit draw the same one); a stale read keeps the
// dated count in the dim tone
function SheetBarView({ bar, dag }: { bar: SheetBar | null; dag: SheetDagRead | null }) {
    if (bar == null) {
        return null;
    }
    if (bar.kind === "stale") {
        if (bar.total === 0) {
            return null;
        }
        return (
            <div
                role="img"
                aria-label={`${bar.done} of ${bar.total} tasks finished`}
                className={cn("flex", bar.total > STRIP_MAX ? "gap-px" : "gap-1")}
            >
                {Array.from({ length: bar.total }, (_, i) => (
                    <span
                        key={i}
                        className={cn("h-1 flex-1 rounded-[2px]", i < bar.done ? "bg-accent-700" : "bg-edge-mid")}
                    />
                ))}
            </div>
        );
    }
    const group = dag?.group ?? undefined;
    const digest = dag?.digest.digest;
    const strip = taskStrip(group, digest);
    if (strip == null) {
        return null;
    }
    return (
        <div role="img" aria-label={taskStripLabel(group, digest)} className="flex h-1 gap-[3px]">
            {strip.kind === "segments" ? (
                strip.states.map((st, i) => (
                    <span key={i} className={cn("h-full min-w-[2px] flex-1 rounded-[2px]", SEG_FILL[st])} />
                ))
            ) : (
                <>
                    <span className="h-full min-w-0 rounded-[2px] bg-success" style={{ flexGrow: strip.done }} />
                    <span
                        className="h-full min-w-0 rounded-[2px] bg-edge-strong"
                        style={{ flexGrow: strip.total - strip.done }}
                    />
                </>
            )}
        </div>
    );
}

function Tasks({
    ctx,
    dag,
    status,
    asks,
}: {
    ctx: SheetCtx;
    dag: SheetDagRead | null;
    status: SheetStatus;
    asks: DagAskItem[];
}) {
    const { run, channel } = ctx;
    const events = useRunEvents(run.id, channel.oid);
    const [timelineOpen, setTimelineOpen] = useState(false);
    const rows = railRows(useMemo(() => groupEvents(events), [events]));
    const digestState = dag?.digest;
    const digest = digestState?.digest;
    const group = dag?.group ?? null;
    const readable = dag != null && dag.groupRead === "ready" && group != null && digest != null;
    const briefs = taskBriefs(group ?? undefined);
    // a stale read keeps its figures but dates them, and drops the exception list entirely: an attention
    // queue that might be minutes old is worse than none
    const failedRefresh = digestState?.stale === true && digestState.error != null && !digestState.loading;
    const asOf =
        failedRefresh && digestState.lastUpdatedTs != null
            ? `as of ${formatElapsed(Math.max(0, ctx.now - digestState.lastUpdatedTs))} ago`
            : failedRefresh
              ? "as of an earlier read"
              : null;

    return (
        <div>
            <div className="flex items-center gap-2.5 pb-2 pt-4">
                <SectionLabel>tasks</SectionLabel>
                <span className="min-w-0 truncate text-[10.5px] tabular-nums text-muted">
                    {taskSectionMeta(run, digest)}
                </span>
                <span className="flex-1" />
                {events.length > 0 ? (
                    <button
                        type="button"
                        aria-expanded={timelineOpen}
                        onClick={() => setTimelineOpen((o) => !o)}
                        className={cn(LINK, "inline-flex flex-none items-center gap-1")}
                    >
                        {timelineOpen ? <ChevronDown size={11} aria-hidden /> : <ChevronRight size={11} aria-hidden />}
                        timeline · {events.length} events
                    </button>
                ) : null}
            </div>
            {timelineOpen ? (
                <div data-run-sheet-timeline className="mb-3 flex flex-col">
                    <div className="sc max-h-[230px] overflow-y-auto">
                        <div className="relative pb-1.5 pt-0.5">
                            <div
                                aria-hidden="true"
                                className="absolute bottom-2 left-[15px] top-2 w-px bg-edge-faint"
                            />
                            <div className="relative flex items-center gap-2 py-0.5 pl-[5px] pr-1.5">
                                <span className="flex w-5 flex-none justify-center">
                                    <span className="size-2 pulse-dot rounded-full bg-accent" />
                                </span>
                                <span className="text-[10.5px] tabular-nums text-accent-soft">
                                    now · {tsLabel(ctx.now)}
                                </span>
                            </div>
                            {rows.map((row, i) =>
                                row.kind === "gap" ? (
                                    <SheetGapRow key={`gap:${i}`} minutes={row.minutes} />
                                ) : (
                                    <SheetBurstRow key={row.group.id} ctx={ctx} group={row.group} />
                                )
                            )}
                        </div>
                    </div>
                    {run.dagoref ? (
                        <button
                            type="button"
                            onClick={() => openDagLive(channel.oid, run.id, "dag:" + run.dagoref)}
                            className={cn(LINK, "mt-1 inline-flex items-center gap-1 self-start")}
                        >
                            open the full timeline
                            <ArrowUpRight size={11} aria-hidden />
                        </button>
                    ) : null}
                </div>
            ) : null}
            {readable && !digestState.stale ? <Attention ctx={ctx} digest={digest} group={group} /> : null}
            {readable ? (
                <div className="flex flex-col" data-run-sheet-rows>
                    {orderedTasks(group, digest).map(({ task, td }) => (
                        <TaskRow
                            key={task.id}
                            ctx={ctx}
                            task={task}
                            td={td}
                            briefs={briefs}
                            digest={digest}
                            events={events}
                            askOwner={askOwnerOf(asks, task.id)}
                            asOf={asOf}
                        />
                    ))}
                </div>
            ) : (
                <EmptyTasks ctx={ctx} dag={dag} />
            )}
            {status.next != null ? (
                <div className="pb-1 pt-[13px] text-[11px] leading-[1.5] text-muted">
                    <span className="text-muted">next: </span>
                    {status.next}
                </div>
            ) : null}
        </div>
    );
}

function SheetGapRow({ minutes }: { minutes: number }) {
    return (
        <div className="relative flex items-center gap-2 py-0.5 pl-[5px] pr-1.5">
            <span className="flex w-5 flex-none justify-center">
                <span className="size-[5px] rounded-full bg-edge-mid" />
            </span>
            <span className="flex-1 border-t border-dashed border-edge-mid" />
            <span className="text-[10.5px] tabular-nums text-ink-faint">{minutes} min quiet</span>
            <span className="flex-1 border-t border-dashed border-edge-mid" />
        </div>
    );
}

// one line per burst; the modal keeps the steps, snippet and detail. Without a dag there is no modal to open,
// so the row is plain.
function SheetBurstRow({ ctx, group }: { ctx: SheetCtx; group: EventGroup }) {
    const { channel, run } = ctx;
    const body = (
        <>
            <SpineGlyph kind={group.head.kind} attention={group.attention} compact />
            <span
                className={cn(
                    "min-w-0 truncate text-[12px]",
                    group.attention ? "font-semibold text-warning" : "font-medium text-ink-hi"
                )}
            >
                {eventTitle(group.head)}
            </span>
            {group.taskId ? (
                <span className="flex-none rounded bg-pill px-1.5 text-[10.5px] leading-4 text-ink-mid">
                    {group.taskId}
                </span>
            ) : null}
            <span className="ml-auto flex-none text-[10.5px] tabular-nums text-ink-mid">{groupTime(group)}</span>
        </>
    );
    const rowClass = "relative flex w-full items-center gap-2 rounded-[6px] py-[3px] pl-[5px] pr-1.5 text-left";
    if (!run.dagoref) {
        return <div className={rowClass}>{body}</div>;
    }
    const dagOref = "dag:" + run.dagoref;
    return (
        <button
            type="button"
            data-run-sheet-burst={group.taskId || undefined}
            title="Show in the DAG"
            onClick={() =>
                group.taskId
                    ? openDagTask(channel.oid, run.id, dagOref, group.taskId)
                    : openDagLive(channel.oid, run.id, dagOref)
            }
            className={cn(
                rowClass,
                "cursor-pointer hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
            )}
        >
            {body}
        </button>
    );
}

function askOwnerOf(asks: DagAskItem[], taskId: string): "user" | "lead" | null {
    const ask = asks.find((a) => a.taskid === taskId);
    if (ask == null) {
        return null;
    }
    return ask.owner === "user" ? "user" : "lead";
}

// the task's worker, resolved from its child run and the live roster — shared by rows and the attention
// list so the two can never disagree about who is running a task
function useTaskWorker(task: { id: string; runid?: string }, agents: AgentVM[]): TaskWorkerView {
    const childRun = useAtomValue<Run | undefined>(
        (task.runid ? runAtom(task.runid) : NO_RUN_ATOM) as Atom<Run | undefined>
    );
    return resolveTaskWorker(task, childRun, agents);
}

function TaskRow({
    ctx,
    task,
    td,
    briefs,
    digest,
    events,
    askOwner,
    asOf,
}: {
    ctx: SheetCtx;
    task: TaskNode;
    td: DagTaskDigest | undefined;
    briefs: Map<string, TaskBrief>;
    digest: DagStatusDigest;
    events: RunEvent[];
    askOwner: "user" | "lead" | null;
    asOf: string | null;
}) {
    const worker = useTaskWorker(task, ctx.agents);
    const recovery = recoverySummary(events, task.id);
    const row = taskRow({
        task,
        td,
        worker,
        briefs,
        lanes: digest.lanes,
        durations: digest.durations?.tasks,
        recovery: recovery != null ? recoveryText(recovery, task.state) : null,
        askOwner,
        nowMs: ctx.now,
        asOf,
    });
    const act = () => {
        if (row.action === "open-dag-task") {
            openDagTask(ctx.channel.oid, ctx.run.id, "dag:" + ctx.run.dagoref, task.id);
            return;
        }
        openTaskWorker(worker, ctx.model);
    };
    return (
        <div
            data-run-sheet-row={task.id}
            className="grid grid-cols-[62px_minmax(0,1fr)_auto] items-baseline gap-3 border-b border-edge-faint py-[11px]"
        >
            <span title={task.id} className="truncate text-[11px] font-medium text-ink-mid">
                {task.id}
            </span>
            <div className="flex min-w-0 flex-col gap-[3px]">
                <span className="text-[12.5px] leading-[1.35] text-ink-hi">{row.label}</span>
                {row.meta ? (
                    <span
                        title={row.meta}
                        className={cn("truncate text-[10.5px] tabular-nums", TONE_TEXT[row.metaTone])}
                    >
                        {row.meta}
                    </span>
                ) : null}
            </div>
            <div className="flex items-center gap-2">
                <span className={cn("text-[10.5px] font-semibold", TONE_TEXT[row.stateTone])}>{row.state}</span>
                {row.action != null ? (
                    <button type="button" onClick={act} className={ROW_BTN}>
                        {ROW_ACTION_LABEL[row.action]}
                        {row.action !== "open-child-run" ? <ArrowUpRight size={11} aria-hidden /> : null}
                    </button>
                ) : null}
            </div>
        </div>
    );
}

// The exceptions lifted above the list, carrying the digest's own action names. A child's question is
// left out: the questions card above already holds every one that is the human's to answer.
function Attention({ ctx, digest, group }: { ctx: SheetCtx; digest: DagStatusDigest; group: TaskGroup }) {
    const asking = new Set((digest.tasks ?? []).filter((td) => td.waitreason === "ask").map((td) => td.taskid));
    const entries = attentionQueue(digest, group).filter((e) => !asking.has(e.taskId));
    if (entries.length === 0) {
        return null;
    }
    return (
        <div className="mb-2.5 flex flex-col gap-1.5">
            {entries.map((entry) => (
                <AttentionRow key={entry.taskId} ctx={ctx} entry={entry} />
            ))}
        </div>
    );
}

function AttentionRow({ ctx, entry }: { ctx: SheetCtx; entry: QueueEntry }) {
    const worker = useTaskWorker({ id: entry.taskId, runid: entry.runId }, ctx.agents);
    const openWorker = entry.target === "worker" && worker.state !== "pending";
    const go = () =>
        openWorker
            ? openTaskWorker(worker, ctx.model)
            : openDagTask(ctx.channel.oid, ctx.run.id, "dag:" + ctx.run.dagoref, entry.taskId);
    return (
        <button
            type="button"
            onClick={go}
            title={openWorker ? "Open the worker" : "Show this task in the DAG"}
            className="flex w-full cursor-pointer items-center gap-[9px] rounded-[8px] border border-warning/30 bg-warning/12 px-[11px] py-2 text-left hover:border-warning focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
        >
            <span className="h-1.5 w-1.5 flex-none rounded-full bg-warning" />
            <span className="flex-none text-[11px] font-medium text-ink-hi">{entry.label}</span>
            <span className="min-w-0 flex-1 truncate text-[12px] text-secondary">{entry.detail}</span>
            {entry.actions.length > 0 ? (
                <span className="flex-none rounded-[5px] border border-warning/45 px-[7px] py-px text-[10.5px] text-warning-soft">
                    {entry.actions.join("/")}
                </span>
            ) : null}
        </button>
    );
}

function EmptyBox({ title, body, act }: { title: string; body: string; act?: ReactNode }) {
    return (
        <div
            data-run-sheet-empty
            className="flex flex-col gap-[7px] rounded-[10px] border border-dashed border-edge-strong px-3.5 py-[13px]"
        >
            <span className="text-[12.5px] font-semibold text-ink-hi">{title}</span>
            <span className="text-[11.5px] leading-[1.5] text-muted">{body}</span>
            {act}
        </div>
    );
}

function EmptyTasks({ ctx, dag }: { ctx: SheetCtx; dag: SheetDagRead | null }) {
    const { run, model, agents } = ctx;
    const actClass = cn(SHEET_BTN, "mt-[3px] self-start px-[11px] py-[5px]");
    if (dag == null) {
        if (run.mode === "orchestrator") {
            return (
                <EmptyBox
                    title="No tasks yet"
                    body="The lead writes the plan first. Nothing is dispatched until it submits one."
                />
            );
        }
        const worker = leadWorker(run, agents);
        return (
            <EmptyBox
                title="No task graph"
                body="A quick run is one worker on one goal. Its transcript is the whole run; the Agent view is where it is watched."
                act={
                    worker != null ? (
                        <button
                            type="button"
                            onClick={() => jumpToAgent(model, worker.id)}
                            className={cn(actClass, "inline-flex items-center gap-1")}
                        >
                            Open in Agent
                            <ArrowUpRight size={11} aria-hidden />
                        </button>
                    ) : undefined
                }
            />
        );
    }
    const loading = dag.groupRead === "loading" || (dag.digest.digest == null && dag.digest.loading);
    if (loading) {
        return (
            <div data-jarvis-brief-sheet-state="loading" className="flex flex-col gap-[11px] pt-0.5">
                <span className="h-[30px] animate-pulse rounded-[8px] bg-surface-raised motion-reduce:animate-none" />
                <span className="h-[30px] w-[72%] animate-pulse rounded-[8px] bg-surface-raised motion-reduce:animate-none" />
            </div>
        );
    }
    const canRetry = dag.groupRead === "ready" && dag.digest.retry != null;
    return (
        <EmptyBox
            title="DAG status unavailable"
            body="The run links a task graph, but the read failed. Nothing about the tasks is shown rather than the run's launch snapshot, which is not what the scheduler is running."
            act={
                canRetry ? (
                    <button type="button" onClick={dag.digest.retry} className={actClass}>
                        Retry the read
                    </button>
                ) : undefined
            }
        />
    );
}

// A done run's body: what landed, then the sealed evidence the run's own numbers came from.
function Evidence({ ctx, dag }: { ctx: SheetCtx; dag: SheetDagRead | null }) {
    const { run, model } = ctx;
    const ev = run.evidence;
    if (ev == null) {
        return (
            <div data-jarvis-brief-sheet-state="loading" className="flex flex-col gap-[11px] pt-[18px]">
                <span className="h-[30px] animate-pulse rounded-[8px] bg-surface-raised motion-reduce:animate-none" />
                <span className="text-[12px] text-ink-mid">Sealing this run's evidence…</span>
            </div>
        );
    }
    const digest = dag?.digest.digest;
    const briefs = taskBriefs(dag?.group ?? undefined);
    const commits = digest?.report?.commits ?? [];
    const files = ev.files ?? [];
    const counts = verifCounts(ev.verifs ?? []);
    const shape = digest?.shape;
    const lines = [
        [
            shape != null ? `${shape.tasks} tasks · ${shape.lanes} lanes` : null,
            ev.durationms ? `${formatElapsed(ev.durationms)} wall` : null,
            digest?.report?.workerms ? `${formatElapsed(digest.report.workerms)} worker time` : null,
        ]
            .filter(Boolean)
            .join(" · "),
        `+${ev.addtotal} −${ev.deltotal} across ${files.length} ${files.length === 1 ? "file" : "files"}`,
        (ev.verifs ?? []).length > 0
            ? `verification: ${counts.pass} passed, ${counts.fail} failed${counts.unknown ? `, ${counts.unknown} unknown` : ""}`
            : "verification: none recorded",
        digest?.report?.unverified ? "unverified: a landed commit has no test attributed" : null,
    ].filter((l): l is string => !!l);

    return (
        <div className="flex flex-col gap-4 pt-4" data-evidence-block>
            <div className="flex flex-col gap-[9px]">
                <SectionLabel>what landed</SectionLabel>
                {commits.length > 0
                    ? commits.map((c) => (
                          <div
                              key={`${c.taskid}:${c.commit}`}
                              className="grid grid-cols-[72px_minmax(0,1fr)] items-baseline gap-3 border-b border-edge-faint py-[9px]"
                          >
                              <span className="font-mono text-[11px] font-medium text-ink-mid">
                                  {c.commit.slice(0, 7)}
                              </span>
                              <span className="min-w-0 text-[12.5px] leading-[1.35] text-ink-hi">
                                  {briefs.get(c.taskid)?.label || c.taskid}
                              </span>
                          </div>
                      ))
                    : files.slice(0, 8).map((f) => (
                          <button
                              key={f.path}
                              type="button"
                              onClick={() => openDiff(model, diffScopeOfRun(run), f.path)}
                              className="grid cursor-pointer grid-cols-[minmax(0,1fr)_auto] items-baseline gap-3 border-b border-edge-faint py-[9px] text-left hover:bg-surface-hover"
                          >
                              <span className="truncate text-[11.5px] text-ink-hi">{f.path}</span>
                              <span className="text-[10.5px] tabular-nums">
                                  <span className="text-diff-added">+{f.add}</span>{" "}
                                  <span className="text-diff-removed">−{f.del}</span>
                              </span>
                          </button>
                      ))}
                {commits.length === 0 && files.length === 0 ? (
                    <span className="text-[12px] text-muted">Nothing landed in the repository.</span>
                ) : null}
                {commits.length === 0 && files.length > 8 ? (
                    <span className="text-[10.5px] tabular-nums text-muted">+{files.length - 8} more files</span>
                ) : null}
            </div>
            <div className="flex flex-col gap-[7px]">
                <SectionLabel>sealed evidence</SectionLabel>
                <div className="flex flex-col text-[11px] leading-[1.6] tabular-nums text-secondary">
                    {lines.map((l) => (
                        <span key={l}>{l}</span>
                    ))}
                </div>
                {ev.summary ? (
                    <p className="text-pretty text-[12px] leading-[1.55] text-secondary">{ev.summary}</p>
                ) : null}
                <button
                    type="button"
                    onClick={() => openDiff(model, diffScopeOfRun(run))}
                    className={cn(LINK, "inline-flex items-center gap-1 self-start")}
                >
                    open the repository diff
                    <ArrowUpRight size={11} aria-hidden />
                </button>
            </div>
        </div>
    );
}

function Dock({
    ctx,
    group,
    finalEntry,
    onOpenShots,
}: {
    ctx: SheetCtx;
    group: TaskGroup | null;
    finalEntry: FinalCheckEntry | null;
    onOpenShots: OpenShots;
}) {
    const { model, channel, run, agents } = ctx;
    const [saving, setSaving] = useState(false);
    const [result, setResult] = useState<{ failed: boolean; text: string } | null>(null);
    const [ending, setEnding] = useState(false);
    const endable = finalStageEndable(group);
    // a stage that stops being endable closes the form, or a later round's final stage would open on it
    if (ending && !endable) {
        setEnding(false);
    }
    const lead = sheetLead(run, agents);
    // a live quick run's one worker, opened where it is watched (design L576)
    const worker = run.mode !== "orchestrator" && !isTerminal(run.status) ? leadWorker(run, agents) : undefined;
    // a finished orchestrator has no dials left, so the dock's first slot carries its configuration forward
    const carryForward = run.status === "done" && run.mode === "orchestrator";
    const saveDefaults = () => {
        setSaving(true);
        setResult(null);
        fireAndForget(async () => {
            try {
                await saveRunAsDefaults(run, runSettingsDraft(run, group));
                setResult({ failed: false, text: "Saved as this project's defaults." });
            } catch (e) {
                setResult({ failed: true, text: String(e) });
            } finally {
                setSaving(false);
            }
        });
    };
    return (
        <div className="flex flex-col gap-1.5 border-t border-edge-faint px-4 py-[11px]">
            <div className="flex items-center gap-2">
                {carryForward ? (
                    <button type="button" disabled={saving} onClick={saveDefaults} className={DOCK_ACCENT}>
                        {saving ? "Saving…" : "Save as project defaults"}
                    </button>
                ) : null}
                {run.dagoref ? (
                    <button
                        type="button"
                        onClick={() => openDagLive(channel.oid, run.id, "dag:" + run.dagoref)}
                        className={carryForward ? DOCK_BTN : DOCK_ACCENT}
                    >
                        Open DAG
                    </button>
                ) : null}
                {finalEntry != null ? (
                    <button
                        type="button"
                        data-run-sheet-final-shots-dock
                        disabled={finalEntry.dockDisabled}
                        onClick={() => onOpenShots({ round: finalEntry.latestRound })}
                        className={cn(
                            DOCK_BTN,
                            "inline-flex items-center gap-1.5",
                            finalEntry.dockAccent && "border-accent text-accent-soft"
                        )}
                    >
                        <span className={cn("size-1.5 flex-none rounded-full", FINAL_TONE_BG[finalEntry.tone])} />
                        {finalEntry.dockLabel}
                    </button>
                ) : null}
                {endable && !ending ? (
                    <button type="button" onClick={() => setEnding(true)} className={DOCK_BTN}>
                        End final stage
                    </button>
                ) : null}
                {lead != null ? (
                    <button
                        type="button"
                        onClick={() => jumpToAgent(model, lead.id)}
                        className={cn(DOCK_BTN, "inline-flex items-center gap-1")}
                    >
                        Open lead
                        <ArrowUpRight size={11} aria-hidden />
                    </button>
                ) : null}
                {worker != null ? (
                    <button
                        type="button"
                        onClick={() => jumpToAgent(model, worker.id)}
                        className={cn(DOCK_BTN, "inline-flex items-center gap-1")}
                    >
                        Open in Agent
                        <ArrowUpRight size={11} aria-hidden />
                    </button>
                ) : null}
                <span className="flex-1" />
                {!isTerminal(run.status) ? (
                    <CancelRunButton
                        channelId={channel.oid}
                        run={run}
                        agents={agents}
                        model={model}
                        className={cn(DOCK_BTN, "border-edge-mid text-muted hover:border-error hover:text-error")}
                    />
                ) : null}
            </div>
            {endable && ending ? (
                <EndFinalForm
                    ctx={ctx}
                    onClose={(text) => {
                        setEnding(false);
                        setResult(text != null ? { failed: false, text } : null);
                    }}
                    onError={(text) => setResult({ failed: true, text })}
                />
            ) : null}
            {result != null ? (
                <span className={cn("text-[11px]", result.failed ? "text-error" : "text-success")}>{result.text}</span>
            ) : null}
        </div>
    );
}

// Ends a stuck final stage on the human's word. The reason is required: it is what the run records, and for
// a fail what the lead plans the fix round from.
function EndFinalForm({
    ctx,
    onClose,
    onError,
}: {
    ctx: SheetCtx;
    onClose: (done: string | null) => void;
    onError: (text: string) => void;
}) {
    const [reason, setReason] = useState("");
    const [busy, setBusy] = useState(false);
    const blank = reason.trim() === "";
    const end = (outcome: FinalEndOutcome) => {
        setBusy(true);
        fireAndForget(async () => {
            try {
                await endFinalStage(ctx.channel.oid, ctx.run.id, outcome, reason.trim());
                onClose(
                    outcome === "failed"
                        ? "Final stage failed; the lead has the reason."
                        : "Final stage ended unverified."
                );
            } catch (e) {
                onError(`Ending the final stage failed: ${e instanceof Error ? e.message : String(e)}`);
                setBusy(false);
            }
        });
    };
    return (
        <div data-run-sheet-end-final className="flex flex-col gap-1.5">
            <textarea
                autoFocus
                rows={2}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Why end it? Recorded on the run; a fail's reason goes to the lead."
                aria-label="Reason for ending the final stage"
                className="resize-none rounded-[6px] border border-edge-mid bg-transparent px-2 py-1.5 text-[12px] leading-[1.5] text-primary outline-none placeholder:text-muted focus-visible:border-accent"
            />
            <div className="flex items-center gap-2">
                <button
                    type="button"
                    disabled={blank || busy}
                    onClick={() => end("unverified")}
                    className={cn(DOCK_BTN, "disabled:opacity-60")}
                >
                    Pass unverified
                </button>
                <button
                    type="button"
                    disabled={blank || busy}
                    onClick={() => end("failed")}
                    className={cn(
                        DOCK_BTN,
                        "border-edge-mid text-muted hover:border-error hover:text-error disabled:opacity-60"
                    )}
                >
                    Fail
                </button>
                <span className="flex-1" />
                <button type="button" disabled={busy} onClick={() => onClose(null)} className={DOCK_BTN}>
                    Keep running
                </button>
            </div>
        </div>
    );
}
