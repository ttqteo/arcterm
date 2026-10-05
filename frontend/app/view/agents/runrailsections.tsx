// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The details rail's run sections: Needs you (a lead's run's questions waiting on the human), Run
// for a lead (status, lanes with the lead's questions under them, activity) and Task for a worker (its lead,
// lane, dependencies, attempt and the lead's question). A question the lead holds can be taken over.

import { paneReveal } from "@/app/element/motiontokens";
import { globalStore } from "@/app/store/jotaiStore";
import * as WOS from "@/app/store/wos";
import { openOrPeek } from "@/app/view/jarvis/openref";
import {
    cleanupOnly,
    digestStale,
    formatElapsed,
    healthView,
    nextStepView,
    taskBriefs,
} from "@/app/view/orchestrate/dagdigest";
import { openDagLive, openDagTask } from "@/app/view/orchestrate/dagmodalstate";
import { cn } from "@/util/util";
import { useAtomValue } from "jotai";
import { ArrowRight, ArrowUp, ArrowUpRight, Check } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import type { AgentsViewModel } from "./agents";
import { formatTokens } from "./agentsviewmodel";
import { ASK_OWNER_USER, childAskKey } from "./childaskmodel";
import { bindChildAsks, childAskErrorAtom, childAsksAtom, takeOverChildAsk } from "./childaskstore";
import { useRunEvents } from "./runeventstore";
import { formatLeft, leadAgentOf, runProgress, taskAgentOf, type RunInfo } from "./runlineage";
import { runStatusView } from "./runmodel";
import {
    laneRows,
    questionOrder,
    runElapsedMs,
    runLog,
    runSegments,
    taskFacts,
    thenTask,
    type LaneState,
} from "./runrail";
import { SEG_FILL } from "./runstrip";
import { tsLabel } from "./runtimeline";
import { useRunUsage } from "./runtokenstore";
import { summarizeUsage, usageText, type UsageSummary } from "./runusage";
import { SectionLabel, SubLabel } from "./sectionlabel";

const LANE_DOT: Record<LaneState, string> = {
    done: "bg-success",
    working: "bg-accent pulse-dot",
    asking: "bg-warning pulse-dot",
    lead: "bg-muted",
    pending: "border border-muted bg-transparent",
    failed: "bg-error",
    muted: "bg-muted",
};

const LANE_TEXT: Record<LaneState, string> = {
    done: "text-success",
    working: "text-accent",
    asking: "text-warning",
    lead: "text-muted",
    pending: "text-muted",
    failed: "text-error",
    muted: "text-muted",
};

// what the Run section's status line says for each digest health; one the UI does not know falls back to
// healthView's wording
const RUN_STATUS: Record<string, { text: string; tone: string }> = {
    "needs-you": { text: "Waiting on you", tone: "text-warning" },
    stalled: { text: "Stalled", tone: "text-error" },
    healthy: { text: "On track", tone: "text-accent" },
    done: { text: "Done", tone: "text-success" },
    cancelled: { text: "Cancelled", tone: "text-muted" },
};

// how many timeline rows the expanded Activity list shows
const ACTIVITY_MAX = 8;

const LINK =
    "-ml-[6px] w-fit cursor-pointer rounded-[7px] px-[6px] py-[3px] font-mono text-[10.5px] font-semibold text-accent-soft hover:bg-surface-hover";

function FactRow({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <div className="flex items-baseline gap-[12px] border-b border-edge-faint py-[5px] last:border-b-0">
            <span className="flex-none text-[12.5px] text-muted">{label}</span>
            <span className="min-w-0 flex-1 truncate text-right font-mono text-[12px] font-medium text-secondary">
                {children}
            </span>
        </div>
    );
}

// the tokens a run or task has spent, then each model's share
function UsageRows({ spent, sealed }: { spent: UsageSummary; sealed: boolean }) {
    return (
        <>
            <FactRow label="Tokens">{usageText(spent, sealed)}</FactRow>
            {spent.byModel.map((m) => (
                <FactRow key={m.model} label={m.model}>
                    {formatTokens(m.tokens)}
                </FactRow>
            ))}
        </>
    );
}

// openRunDag lands on the run's Brief sheet, where the DAG modal lives, with the modal open on the run or
// one of its tasks. A Ctrl+click peeks the run instead, and the modal stays shut: it belongs to the sheet.
export function openRunDag(model: AgentsViewModel, run: RunInfo, taskId?: string, event?: React.MouseEvent) {
    const dag = run.dag;
    if (dag == null) {
        return;
    }
    void openOrPeek(model, { kind: "channel", channelId: run.channelId, runId: run.runId }, event).then((res) => {
        if ("reason" in res || event?.ctrlKey) {
            return;
        }
        const dagOref = WOS.makeORef("dag", dag.oid);
        if (taskId) {
            openDagTask(run.channelId, run.runId, dagOref, taskId);
        } else {
            openDagLive(run.channelId, run.runId, dagOref);
        }
    });
}

// useRunAsks is the open questions on a run, yours first. A rail with no run gets none.
export function useRunAsks(run: RunInfo | undefined): DagAskItem[] {
    useEffect(() => {
        if (run) {
            bindChildAsks(run.channelId, run.runId);
        }
    }, [run?.channelId, run?.runId]);
    const all = useAtomValue(childAsksAtom);
    return run ? questionOrder(all[run.runId] ?? []) : [];
}

// Reveal grows a question, or the run's older activity, in and out, so one arriving or clearing pushes the rail
// instead of jumping it. The sections holding it are keyed by agent, so switching agents never replays it. In a
// flex column with a gap, the caller cancels the gap with a negative top margin here and pads it back inside, so
// the gap animates with the height rather than snapping at either end.
function Reveal({ className, children }: { className?: string; children: React.ReactNode }) {
    return (
        <motion.div
            variants={paneReveal}
            initial="initial"
            animate="animate"
            exit="exit"
            className={cn("overflow-hidden", className)}
        >
            {children}
        </motion.div>
    );
}

function leadAnswering(ask: DagAskItem, now: number): string {
    return ask.deadline ? `lead is answering · ${formatLeft(Math.max(0, ask.deadline - now))}` : "lead is answering";
}

// NeedsYouCard flags a worker's question the human holds, on the lead's rail. It is answered in the worker's own
// terminal, where Claude Code shows the question with its full picker; the rail is too narrow for a long one.
function NeedsYouCard({
    ask,
    action,
}: {
    ask: DagAskItem;
    action: { label: string; run: (e: React.MouseEvent) => void; peek?: boolean };
}) {
    const first = ask.questions[0];
    const more = ask.questions.length - 1;
    return (
        <div className="rounded-[9px] border border-warning/45 bg-warning/[0.06] px-[11px] py-[9px]">
            <div className="flex items-center gap-[7px] overflow-hidden whitespace-nowrap font-mono text-[10.5px] text-muted">
                <span className="h-[7px] w-[7px] flex-none pulse-dot rounded-full bg-warning" />
                <b className="font-semibold text-primary">{ask.taskid}</b>
                <span className="truncate text-warning">waiting on you</span>
            </div>
            {first?.header ? <SubLabel className="mt-[6px] inline-block">{first.header}</SubLabel> : null}
            <div className="mt-[2px] line-clamp-2 text-[12.5px] leading-[1.45] text-primary">{first?.question}</div>
            <div className="mt-[7px] flex items-center gap-[10px] font-mono text-[10.5px]">
                {more > 0 ? <span className="text-muted">+{more} more</span> : null}
                <div className="flex-1" />
                <button
                    type="button"
                    data-peek={action.peek ? "" : undefined}
                    onClick={action.run}
                    className="inline-flex cursor-pointer items-center gap-[3px] font-semibold text-accent-soft hover:underline"
                >
                    {action.label}
                    <ArrowUpRight size={11} aria-hidden />
                </button>
            </div>
        </div>
    );
}

// NeedsYouSection heads a lead's rail with the run's questions waiting on the human, each opening the worker that
// asked, or the run's sheet once that session is gone.
export function NeedsYouSection({ model, run, asks }: { model: AgentsViewModel; run: RunInfo; asks: DagAskItem[] }) {
    const agents = useAtomValue(model.agentsAtom);
    const lineage = useAtomValue(model.lineageAtom);
    // it is a headerless rail section that carries its own bottom padding, so the space under it grows and
    // shrinks with it instead of the rail's section gap snapping
    return (
        <AnimatePresence initial={false}>
            {asks.length > 0 ? (
                <Reveal key="needs">
                    <div className="pb-[24px]">
                        <div className="flex items-center justify-between">
                            <SectionLabel className="text-warning">Needs you</SectionLabel>
                            <span className="rounded-[20px] bg-warning/[0.12] px-[8px] py-[1px] font-mono text-[11px] font-semibold text-warning">
                                {asks.length}
                            </span>
                        </div>
                        <AnimatePresence initial={false}>
                            {asks.map((a) => {
                                const worker = taskAgentOf(lineage, agents, run.runId, a.taskid);
                                const action = worker
                                    ? {
                                          label: `answer in ${a.taskid}`,
                                          run: () => globalStore.set(model.focusIdAtom, worker.id),
                                      }
                                    : {
                                          label: "answer in the run",
                                          run: (e: React.MouseEvent) =>
                                              void openOrPeek(
                                                  model,
                                                  { kind: "channel", channelId: run.channelId, runId: run.runId },
                                                  e
                                              ),
                                          peek: true,
                                      };
                                return (
                                    <Reveal key={childAskKey(a)}>
                                        <div className="pt-[8px]">
                                            <NeedsYouCard ask={a} action={action} />
                                        </div>
                                    </Reveal>
                                );
                            })}
                        </AnimatePresence>
                    </div>
                </Reveal>
            ) : null}
        </AnimatePresence>
    );
}

// LeadAskCard is a worker's question the lead is answering, which the human can take over.
function LeadAskCard({ model, run, ask }: { model: AgentsViewModel; run: RunInfo; ask: DagAskItem }) {
    const now = useAtomValue(model.nowAtom);
    const error = useAtomValue(childAskErrorAtom)[childAskKey(ask)];
    const first = ask.questions[0];
    return (
        <div className="rounded-[9px] border border-edge-mid bg-surface-raised px-[11px] py-[9px]">
            <div className="flex items-center gap-[7px] overflow-hidden whitespace-nowrap font-mono text-[10.5px] text-muted">
                <span className="h-[7px] w-[7px] flex-none pulse-dot rounded-full bg-warning" />
                <b className="font-semibold text-primary">{ask.taskid}</b>
                <span className="truncate">{leadAnswering(ask, now)}</span>
            </div>
            {first?.header ? <SubLabel className="mt-[6px] inline-block">{first.header}</SubLabel> : null}
            <div className="mt-[2px] text-[12.5px] leading-[1.45] text-primary">{first?.question}</div>
            {ask.questions.length > 1 ? (
                <div className="mt-[2px] font-mono text-[10.5px] text-muted">+{ask.questions.length - 1} more</div>
            ) : null}
            {error ? <div className="mt-[6px] text-[11px] text-warning">{error}</div> : null}
            <div className="mt-[7px] flex justify-end">
                <button
                    type="button"
                    onClick={() => takeOverChildAsk(run.channelId, run.runId, ask)}
                    title="Answer it yourself; the lead leaves it to you"
                    className="cursor-pointer whitespace-nowrap rounded-[7px] border border-edge-mid bg-surface px-[9px] py-[3px] font-mono text-[10.5px] font-semibold text-secondary hover:border-edge-strong hover:text-primary"
                >
                    Take over
                </button>
            </div>
        </div>
    );
}

// LaneAsk is the lead's question, shown under the lane whose task raised it.
function LaneAsk({ model, run, ask }: { model: AgentsViewModel; run: RunInfo; ask: DagAskItem }) {
    const now = useAtomValue(model.nowAtom);
    const error = useAtomValue(childAskErrorAtom)[childAskKey(ask)];
    return (
        <div className="mb-[6px] ml-[35px] mr-[6px] rounded-[8px] border border-edge-mid bg-surface-raised px-[10px] py-[7px]">
            <div className="flex items-baseline gap-[8px] font-mono text-[10.5px] text-muted">
                <span className="min-w-0 flex-1 truncate">
                    {ask.deadline
                        ? `asked the lead · ${formatLeft(Math.max(0, ask.deadline - now))}`
                        : "asked the lead"}
                </span>
                <button
                    type="button"
                    onClick={() => takeOverChildAsk(run.channelId, run.runId, ask)}
                    title="Answer it yourself; the lead leaves it to you"
                    className="flex-none cursor-pointer font-semibold text-accent-soft hover:underline"
                >
                    Take over
                </button>
            </div>
            <div className="mt-[2px] text-[12px] leading-[1.45] text-secondary">{ask.questions[0]?.question}</div>
            {error ? <div className="mt-[4px] text-[11px] text-warning">{error}</div> : null}
        </div>
    );
}

function Lanes({ model, run, leadAsks }: { model: AgentsViewModel; run: RunInfo; leadAsks: DagAskItem[] }) {
    const agents = useAtomValue(model.agentsAtom);
    const lineage = useAtomValue(model.lineageAtom);
    const focusId = useAtomValue(model.focusIdAtom);
    const rows = laneRows(run.dag, run.digest);
    if (rows.length === 0) {
        return null;
    }
    return (
        <div className="flex flex-col gap-[2px]">
            {rows.map((r) => {
                const agent = taskAgentOf(lineage, agents, run.runId, r.taskId);
                const ask = leadAsks.find((a) => a.taskid === r.taskId);
                return (
                    <div
                        key={r.key}
                        className={cn(
                            "rounded-[7px]",
                            agent != null && agent.id === focusId
                                ? "bg-surface-selected"
                                : agent != null && "hover:bg-surface-hover"
                        )}
                    >
                        <div
                            onClick={agent ? () => globalStore.set(model.focusIdAtom, agent.id) : undefined}
                            className={cn(
                                "grid grid-cols-[20px_minmax(0,1fr)_auto] items-center gap-[9px] p-[6px]",
                                agent && "cursor-pointer"
                            )}
                        >
                            <span className="flex h-[20px] w-[20px] items-center justify-center rounded-[5px] border border-edge-mid font-mono text-[10.5px] font-semibold text-ink-mid">
                                {r.key}
                            </span>
                            <div className="min-w-0">
                                <div
                                    className={cn(
                                        "truncate font-mono text-[11.5px] font-medium",
                                        r.state === "pending" ? "text-ink-mid" : "text-ink-hi"
                                    )}
                                >
                                    {r.name}
                                </div>
                                {r.hist ? (
                                    <div className="truncate font-mono text-[10.5px] text-muted">{r.hist}</div>
                                ) : null}
                            </div>
                            <span
                                className={cn(
                                    "flex items-center gap-[5px] whitespace-nowrap font-mono text-[10.5px] font-medium",
                                    LANE_TEXT[r.state]
                                )}
                            >
                                {r.state === "lead" ? (
                                    <ArrowRight size={10} aria-hidden />
                                ) : (
                                    <span className={cn("h-[7px] w-[7px] rounded-full", LANE_DOT[r.state])} />
                                )}
                                {r.text}
                            </span>
                        </div>
                        <AnimatePresence initial={false}>
                            {ask ? (
                                <Reveal key={childAskKey(ask)}>
                                    <LaneAsk model={model} run={run} ask={ask} />
                                </Reveal>
                            ) : null}
                        </AnimatePresence>
                    </div>
                );
            })}
        </div>
    );
}

function Activity({ model, run }: { model: AgentsViewModel; run: RunInfo }) {
    const events = useRunEvents(run.runId, run.channelId);
    const [open, setOpen] = useState(false);
    const log = runLog(events, ACTIVITY_MAX);
    if (log.length === 0 && run.dag == null) {
        return null;
    }
    // collapsed shows the newest row; open reads the rows in the order they happened, so the older ones unfold
    // above it
    const [newest, ...older] = log;
    const more = older.length;
    const row = (l: (typeof log)[number]) => (
        <div key={l.id} className="flex gap-[9px] font-mono text-[11px] leading-[1.45] text-secondary">
            <span className="flex-none text-muted">{tsLabel(l.ts)}</span>
            <span className="min-w-0">{l.text}</span>
        </div>
    );
    return (
        <div className="flex flex-col gap-[5px] border-t border-edge-faint pt-[10px]">
            <div className="flex items-center gap-[4px]">
                <SubLabel>Activity</SubLabel>
                <span className="flex-1" />
                {more > 0 ? (
                    <button
                        type="button"
                        onClick={() => setOpen((v) => !v)}
                        className="inline-flex cursor-pointer items-center gap-[3px] rounded-[6px] px-[6px] py-[2px] font-mono text-[10.5px] font-semibold text-muted hover:bg-surface-hover hover:text-secondary"
                    >
                        {open ? "less" : `+${more} more`}
                    </button>
                ) : null}
                {run.dag ? (
                    <button
                        type="button"
                        data-peek
                        onClick={(e) => openRunDag(model, run, undefined, e)}
                        className="inline-flex cursor-pointer items-center gap-[3px] rounded-[6px] px-[6px] py-[2px] font-mono text-[10.5px] font-semibold text-accent-soft hover:bg-surface-hover"
                    >
                        timeline
                        <ArrowUpRight size={11} aria-hidden />
                    </button>
                ) : null}
            </div>
            <AnimatePresence initial={false}>
                {open && more > 0 ? (
                    <Reveal key="older" className="-mt-[5px]">
                        <div className="flex flex-col gap-[5px] pt-[5px]">{[...older].reverse().map(row)}</div>
                    </Reveal>
                ) : null}
            </AnimatePresence>
            {newest ? row(newest) : null}
        </div>
    );
}

// RunStatus is the Run section's headline: the run's title, a slot per task, and where the run stands.
function RunStatus({ run, waitingOnYou }: { run: RunInfo; waitingOnYou: boolean }) {
    const digest = run.digest;
    const state = { digest, loading: digest == null, stale: digestStale(digest, run.dag?.version) };
    const known = digest != null && !state.stale ? RUN_STATUS[digest.health] : undefined;
    const status = waitingOnYou
        ? RUN_STATUS["needs-you"]
        : !state.stale && cleanupOnly(digest)
          ? { text: "Cleanup failed", tone: "text-warning" }
          : (known ?? healthView(state));
    const finished = !state.stale && digest?.health === "done";
    // waiting on you, the engine's next step only repeats that; what the run moves on to afterwards is news
    const then = waitingOnYou ? thenTask(run.dag) : undefined;
    const next = finished || waitingOnYou ? null : nextStepView(state, taskBriefs(run.dag));
    const tail = then ? `· then ${then}` : next ? `· next ${next}` : "";
    return (
        <div className="flex flex-col gap-[8px]">
            <div className="truncate text-[13px] font-semibold text-primary">{run.title}</div>
            <div className="flex h-[4px] gap-[3px]">
                {runSegments(run.dag, digest).map((st, i) => (
                    <span key={i} className={cn("flex-1 rounded-[2px]", SEG_FILL[st])} />
                ))}
            </div>
            <div className="flex min-w-0 items-baseline gap-[6px] text-[12px]">
                {status === RUN_STATUS.done ? (
                    <span className={cn("inline-flex flex-none items-center gap-[4px] font-semibold", status.tone)}>
                        <Check size={12} aria-hidden />
                        {status.text}
                    </span>
                ) : (
                    <span className={cn("flex-none font-semibold", status.tone)}>{status.text}</span>
                )}
                {tail ? <span className="min-w-0 truncate text-muted">{tail}</span> : null}
            </div>
        </div>
    );
}

export function RunSection({ model, run, asks }: { model: AgentsViewModel; run: RunInfo; asks: DagAskItem[] }) {
    const now = useAtomValue(model.nowAtom);
    const { done, total } = runProgress(run.dag);
    const digest = run.digest;
    const finished = !digestStale(digest, run.dag?.version) && digest?.health === "done";
    const report = digest?.report;
    const elapsed = runElapsedMs(run.dag, digest, now);
    const usage = useRunUsage(run.channelId, run.runId);
    const spent = summarizeUsage(usage?.rows);
    const leadAsks = asks.filter((a) => a.owner !== ASK_OWNER_USER);
    const laneTasks = new Set(laneRows(run.dag, digest).map((r) => r.taskId));
    // a lead question whose task is not any lane's task in play still needs somewhere to be taken over
    const looseAsks = leadAsks.filter((a) => !laneTasks.has(a.taskid));

    return (
        <div className="flex flex-col gap-[12px]">
            <div className="flex items-baseline justify-between gap-[8px]">
                <SectionLabel>Run</SectionLabel>
                {run.dag ? (
                    <span className="whitespace-nowrap font-mono text-[11px] font-semibold text-muted">
                        {done}/{total}
                        {elapsed ? ` · ${formatElapsed(elapsed)}` : ""}
                    </span>
                ) : null}
            </div>
            {run.dag == null ? (
                // an absent dag is not "planning": a bounded run never submits one, so the run says where it is
                <div className="font-mono text-[11px] text-muted">
                    {runStatusView(run.status ?? "planning").label} · no plan submitted
                </div>
            ) : (
                <RunStatus run={run} waitingOnYou={asks.some((a) => a.owner === ASK_OWNER_USER)} />
            )}
            {(finished && report) || spent ? (
                <div>
                    {finished && report ? (
                        <>
                            <FactRow label="Landed">
                                {report.commits?.length ?? 0} {report.commits?.length === 1 ? "commit" : "commits"}
                            </FactRow>
                            {elapsed ? <FactRow label="Elapsed">{formatElapsed(elapsed)}</FactRow> : null}
                            <FactRow label="Worker time">{formatElapsed(report.workerms)}</FactRow>
                            <FactRow label="Answered">{report.answered}</FactRow>
                            <FactRow label="Forwarded">{report.forwarded}</FactRow>
                        </>
                    ) : null}
                    {spent ? <UsageRows spent={spent} sealed={usage.sealed} /> : null}
                </div>
            ) : null}
            <Lanes model={model} run={run} leadAsks={leadAsks} />
            <AnimatePresence initial={false}>
                {looseAsks.map((a) => (
                    <Reveal key={childAskKey(a)} className="-mt-[12px]">
                        <div className="pt-[12px]">
                            <LeadAskCard model={model} run={run} ask={a} />
                        </div>
                    </Reveal>
                ))}
            </AnimatePresence>
            <Activity model={model} run={run} />
        </div>
    );
}

export function TaskSection({
    model,
    run,
    taskId,
    asks,
}: {
    model: AgentsViewModel;
    run: RunInfo;
    taskId: string;
    asks: DagAskItem[];
}) {
    const now = useAtomValue(model.nowAtom);
    const agents = useAtomValue(model.agentsAtom);
    const lineage = useAtomValue(model.lineageAtom);
    // the human's own question heads the rail as Needs you; only the lead's is taken over from here
    const leadAsk = asks.find((a) => a.taskid === taskId && a.owner !== ASK_OWNER_USER);
    const facts = taskFacts(run.dag, run.digest, taskId, now);
    const lead = leadAgentOf(lineage, agents, run.runId);
    const usage = useRunUsage(run.channelId, run.runId);
    const spent = summarizeUsage(usage?.rows, taskId);

    return (
        <div className="flex flex-col gap-[12px]">
            <div className="flex items-baseline justify-between gap-[8px]">
                <SectionLabel>Task</SectionLabel>
                <button
                    type="button"
                    data-peek
                    onClick={(e) => openRunDag(model, run, taskId, e)}
                    className={cn(LINK, "ml-0 inline-flex items-center gap-[3px]")}
                >
                    plan · Task {taskId.replace(/^t-/, "")}
                    <ArrowUpRight size={11} aria-hidden />
                </button>
            </div>
            <div>
                <FactRow label="Lead">
                    {lead ? (
                        <button
                            type="button"
                            onClick={() => globalStore.set(model.focusIdAtom, lead.id)}
                            className="inline-flex cursor-pointer items-center gap-[3px] text-accent-soft hover:underline"
                        >
                            <ArrowUp size={11} aria-hidden />
                            {lead.name}
                        </button>
                    ) : (
                        <span className="inline-flex items-center gap-[3px]">
                            <ArrowUp size={11} aria-hidden />
                            {run.title}
                        </span>
                    )}
                </FactRow>
                {facts?.laneText ? <FactRow label="Lane">{facts.laneText}</FactRow> : null}
                {facts ? <FactRow label="Depends on">{facts.depends}</FactRow> : null}
                {facts ? (
                    <FactRow label={facts.resultLabel}>
                        <span className={facts.landed ? "text-success" : undefined}>{facts.result}</span>
                    </FactRow>
                ) : null}
                {spent ? <UsageRows spent={spent} sealed={usage.sealed} /> : null}
            </div>
            <AnimatePresence initial={false}>
                {leadAsk ? (
                    <Reveal key={childAskKey(leadAsk)} className="-mt-[12px]">
                        <div className="pt-[12px]">
                            <LeadAskCard model={model} run={run} ask={leadAsk} />
                        </div>
                    </Reveal>
                ) : null}
            </AnimatePresence>
        </div>
    );
}
