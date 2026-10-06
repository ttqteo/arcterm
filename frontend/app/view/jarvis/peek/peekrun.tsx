// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The run body (PeekRun.dc.html): the run's header, meta line, goal, phase strip and task list, live from the
// run and its task graph through WOS. What it says is arranged in peekrunmodel.ts.

import * as WOS from "@/app/store/wos";
import type { AgentsViewModel } from "@/app/view/agents/agents";
import { projectLabel } from "@/app/view/agents/projectlabel";
import { projectsAtom } from "@/app/view/agents/projectsstore";
import { RuntimeMark } from "@/app/view/agents/runtimemark";
import { useRunUsage } from "@/app/view/agents/runtokenstore";
import { useDagDigest } from "@/app/view/orchestrate/dagdigest";
import { useDagGroup } from "@/app/view/orchestrate/dagstore";
import { cn } from "@/util/util";
import { useAtomValue } from "jotai";
import { Check, X } from "lucide-react";
import { Fragment, useEffect } from "react";
import { RUN_TONE } from "../briefpeekview";
import { FAINT_TEXT, REGION_LABEL } from "../briefstyle";
import { reportPeekFacts, type PeekTarget } from "../peekstore";
import { runGraphRef } from "../runsheetmodel";
import {
    buildRunPeek,
    runPeekFacts,
    type PeekPhase,
    type PeekRunView,
    type PeekTaskRow,
    type PeekTone,
} from "./peekrunmodel";

const TONE_TEXT: Record<PeekTone, string> = {
    done: "text-success",
    running: "text-accent-soft",
    warning: "text-warning",
    failed: "text-error",
    pending: "text-muted",
};

const TONE_DOT: Record<PeekTone, string> = {
    done: "bg-success",
    running: "bg-accent-soft",
    warning: "bg-warning",
    failed: "bg-error",
    pending: "bg-ink-faint",
};

// a settled verdict reads as a mark, anything still open as a dot
function ToneMark({ tone, size }: { tone: PeekTone; size: number }) {
    if (tone === "done") {
        return <Check aria-hidden="true" size={size} strokeWidth={2.4} className="flex-none" />;
    }
    if (tone === "failed") {
        return <X aria-hidden="true" size={size} strokeWidth={2.4} className="flex-none" />;
    }
    return <span className={cn("h-[7px] w-[7px] flex-none rounded-full", TONE_DOT[tone])} />;
}

function PhaseCell({ phase }: { phase: PeekPhase }) {
    return (
        <div
            data-peek-run-phase={phase.label}
            className="flex min-w-0 flex-col gap-1 rounded-[8px] border border-edge-mid px-2.5 py-2"
        >
            <span className="text-[10px] uppercase tracking-[.06em] text-muted">{phase.label}</span>
            <span className={cn("flex min-w-0 items-center gap-1.5 text-[12px] font-semibold", TONE_TEXT[phase.tone])}>
                <ToneMark tone={phase.tone} size={11} />
                <span className="truncate">{phase.state}</span>
            </span>
        </div>
    );
}

function TaskRowView({ row }: { row: PeekTaskRow }) {
    return (
        <div className="grid grid-cols-[26px_minmax(0,1fr)_12px_36px] items-center gap-[7px] px-3 py-[5px]">
            <span className="truncate text-[10.5px] text-muted">{row.id}</span>
            <span className="truncate text-[12.5px] text-secondary">{row.title}</span>
            <span aria-label={row.state} className={cn("flex justify-center", TONE_TEXT[row.mark])}>
                <ToneMark tone={row.mark} size={12} />
            </span>
            <span className="text-right text-[10.5px] tabular-nums text-muted">{row.tokens}</span>
        </div>
    );
}

function RunPeekView({ view }: { view: PeekRunView }) {
    return (
        <div data-peek-run className="flex flex-col">
            <div className="flex min-w-0 items-center gap-2.5 border-b border-border px-[18px] py-[13px]">
                <span className={cn(REGION_LABEL, "text-accent-soft")}>Run</span>
                <span className="min-w-0 flex-1 truncate text-[14px] font-semibold text-ink-hi">{view.title}</span>
                <span
                    data-peek-run-status={view.status.label}
                    className={cn(
                        "inline-flex flex-none items-center gap-[5px] rounded-[6px] border border-border bg-surface-raised px-2 py-0.5 text-[10.5px] font-semibold",
                        RUN_TONE[view.status.tone]
                    )}
                >
                    {view.status.tone === "done" ? <Check aria-hidden="true" size={11} strokeWidth={2.4} /> : null}
                    {view.status.label}
                </span>
            </div>
            <div className="flex flex-col gap-3.5 px-[18px] py-[15px]">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[10.5px] tabular-nums text-ink-mid">
                    {view.meta.map((m, i) => (
                        <Fragment key={i}>
                            {i > 0 ? <span className="text-ink-faint">·</span> : null}
                            <span className={cn("inline-flex items-center gap-1", m.faint && "text-muted")}>
                                {m.runtime != null ? (
                                    <RuntimeMark runtime={m.runtime} imageClassName="h-3 w-3" />
                                ) : null}
                                {m.text}
                            </span>
                        </Fragment>
                    ))}
                </div>
                {view.goal != null ? (
                    <p className="line-clamp-3 whitespace-pre-line text-[13px] leading-[1.6] text-ink-mid">
                        {view.goal}
                    </p>
                ) : null}
                {view.phases != null ? (
                    <div className="grid grid-cols-4 gap-1.5">
                        {view.phases.map((p) => (
                            <PhaseCell key={p.label} phase={p} />
                        ))}
                    </div>
                ) : null}
                {view.unverified != null ? (
                    <div
                        data-peek-run-unverified
                        className="flex items-start gap-2.5 rounded-[8px] bg-warning/12 px-3 py-2.5"
                    >
                        <span className="mt-1.5 h-[7px] w-[7px] flex-none rounded-full bg-warning" />
                        <span className="text-[12.5px] leading-[1.5] text-secondary">
                            <span className="font-semibold text-ink-hi">Unverified:</span> {view.unverified}
                        </span>
                    </div>
                ) : null}
                {view.tasks != null ? (
                    <div className="flex flex-col overflow-hidden rounded-[9px] border border-border bg-background">
                        <div className="flex items-center gap-2.5 border-b border-edge-faint px-3 py-2">
                            <span className={cn(REGION_LABEL, "text-ink-mid")}>Tasks</span>
                            <span className="h-px flex-1 bg-edge-faint" />
                            {view.commits != null ? (
                                <span className={cn("flex-none", FAINT_TEXT)}>{view.commits}</span>
                            ) : null}
                        </div>
                        {view.tasks.length === 0 ? (
                            <div className="px-3 py-2.5 text-[11px] text-muted">The plan has no tasks.</div>
                        ) : (
                            <div className="grid grid-cols-2 py-[3px]">
                                {view.tasks.map((t) => (
                                    <TaskRowView key={t.id} row={t} />
                                ))}
                            </div>
                        )}
                    </div>
                ) : null}
            </div>
        </div>
    );
}

type ViewProps = { run: Run; group: TaskGroup | null; commitCount: number | undefined };

function RunPeekLive({ run, group, commitCount }: ViewProps) {
    const projects = useAtomValue(projectsAtom);
    const usage = useRunUsage(run.channeloid, run.id);
    const view = buildRunPeek({
        run,
        group,
        usage: usage?.rows,
        commitCount,
        project: projectLabel(run.projectpath, projects),
        now: Date.now(),
    });
    return <RunPeekView view={view} />;
}

// The graph read is a component boundary, as in runsheet.tsx: a run without a graph never subscribes to one.
function LinkedRunPeek({ run, dagOref }: { run: Run; dagOref: string }) {
    const [group] = useDagGroup(dagOref);
    const digest = useDagDigest(run.channeloid ?? "", run.id, dagOref);
    return <RunPeekLive run={run} group={group ?? null} commitCount={digest.digest?.report?.commits?.length} />;
}

export function PeekRunBody({ target }: { model: AgentsViewModel; target: PeekTarget }) {
    const runId = target.kind === "run" ? target.runId : "";
    const [run, loading] = WOS.useWaveObjectValue<Run>(WOS.makeORef("run", runId));

    useEffect(() => {
        if (loading) {
            return;
        }
        reportPeekFacts(target, runPeekFacts(run ?? undefined));
    }, [target, loading, run == null]);

    if (run == null) {
        return null;
    }
    const graph = runGraphRef(run);
    if (graph != null) {
        return <LinkedRunPeek run={run} dagOref={"dag:" + graph} />;
    }
    return <RunPeekLive run={run} group={null} commitCount={undefined} />;
}
