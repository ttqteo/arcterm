// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The Jobs popover (spec 2026-10-09-heavy-job-queue-design.md): every heavy shell job running or waiting its turn, with
// Run now and Skip on a queued one, the Slots picker for how many run at once (or Auto, as RAM allows, or Off), and
// Pause 1h / 4h to turn the queue off for a while. It hangs from the app bar's Jobs
// chip and shares the Consumers panel's shell. jobqueue.ts decides; this draws. Mounted once in cockpit-root, which
// also keeps the one feed of the queue (useJobQueueFeed) the chip reads.

import { pushToast } from "@/app/cockpit/notificationstore";
import { PopoverReveal } from "@/app/element/popoverreveal";
import { globalStore } from "@/app/store/jotaiStore";
import { modalsModel } from "@/app/store/modalmodel";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import type { AgentsViewModel } from "@/app/view/agents/agents";
import { PANEL_WIDTH } from "@/app/view/agents/consumers";
import { usePanelPlacement } from "@/app/view/agents/consumerspanel";
import { formatGB } from "@/app/view/agents/workercapacity";
import { openTarget } from "@/app/view/jarvis/openref";
import { cn, fireAndForget } from "@/util/util";
import { useAtomValue } from "jotai";
import { Pause } from "lucide-react";
import { useEffect, useState } from "react";
import {
    formatElapsed,
    formatLeft,
    openTargetFor,
    ordered,
    PACE_CHOICES,
    pacePatch,
    paceValue,
    PAUSE_CHOICES,
    pauseLeft,
    pausePatch,
    sourceLabel,
    type JobAgent,
} from "./jobqueue";
import { jobQueueAtom, jobQueueOpenAtom, jobQueueOpenerAtom, useJobQueueFeed } from "./jobqueuestore";

function close(): void {
    globalStore.set(jobQueueOpenAtom, false);
}

// wavesrv refuses a job that has just left the queue (started or skipped meanwhile); that is not worth more than a toast
function act(what: string, call: () => Promise<void>): void {
    fireAndForget(async () => {
        try {
            await call();
        } catch (e) {
            pushToast({ title: `Couldn't ${what}`, message: String(e), level: "error" });
        }
    });
}

function setPace(value: string): void {
    act("change the slots", () => RpcApi.SetConfigCommand(TabRpcClient, pacePatch(value)));
}

// ms null is Resume
function setPause(ms: number | null): void {
    act(ms == null ? "resume the queue" : "pause the queue", () =>
        RpcApi.SetConfigCommand(TabRpcClient, pausePatch(ms, Date.now()))
    );
}

// the clock the rows' elapsed times read, ticking once a second while the popover is open
function useNow(open: boolean): number {
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        if (!open) {
            return;
        }
        setNow(Date.now());
        const timer = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(timer);
    }, [open]);
    return now;
}

const ROW_BUTTON =
    "cursor-pointer rounded border border-edge-mid px-1.5 py-[1px] text-[11px] text-secondary hover:border-edge-strong hover:bg-surface-hover";

// Pause 1h or 4h turns the queue off for that long, so every heavy job starts at once; Resume ends it early. wavesrv
// turns it back on by itself when the time is up.
function PauseBar({ data, now }: { data: JobQueueData | null; now: number }) {
    const left = pauseLeft(data, now);
    return (
        <div
            data-job-queue-pause
            className="flex items-center gap-2 border-b border-border px-3 py-[6px] text-[11.5px] text-muted"
        >
            {left == null ? (
                <>
                    <span className="flex-1">Pause the queue for</span>
                    {PAUSE_CHOICES.map((c) => (
                        <button
                            key={c.label}
                            type="button"
                            data-job-queue-pause-for={c.label}
                            title={`Start every heavy job at once for ${c.label}, whatever RAM is free, then queue them again`}
                            onClick={() => setPause(c.ms)}
                            className={ROW_BUTTON}
                        >
                            {c.label}
                        </button>
                    ))}
                </>
            ) : (
                <>
                    <Pause size={11} aria-hidden className="flex-none" />
                    <span data-job-queue-paused-left className="flex-1 tabular-nums">
                        Paused, {formatLeft(left)} left: every job starts at once
                    </span>
                    <button type="button" data-job-queue-resume onClick={() => setPause(null)} className={ROW_BUTTON}>
                        Resume
                    </button>
                </>
            )}
        </div>
    );
}

function Row({
    job,
    now,
    agents,
    model,
}: {
    job: JobQueueJob;
    now: number;
    agents: readonly JobAgent[];
    model: AgentsViewModel;
}) {
    const running = job.running === true;
    const target = openTargetFor(job, agents);
    const source = sourceLabel(job, agents);
    return (
        <div
            data-job-row={job.id}
            data-state={running ? "running" : "queued"}
            className="flex flex-col gap-[1px] px-3 py-[5px] hover:bg-surface-hover"
        >
            <div className="flex items-center gap-2">
                {running ? (
                    <span className="h-[7px] w-[7px] flex-none rounded-full bg-accent" aria-label="running" />
                ) : (
                    <span
                        title={`Number ${job.position ?? "?"} in the queue`}
                        className="w-[7px] flex-none text-[10.5px] tabular-nums text-muted"
                    >
                        {job.position ?? ""}
                    </span>
                )}
                <span data-job-name className="min-w-0 flex-1 truncate text-[12.5px] text-primary" title={job.name}>
                    {job.name}
                </span>
                <span data-job-size title="Its peak RAM" className="text-[12px] tabular-nums text-secondary">
                    {formatGB(job.bytes)}
                </span>
                <span data-job-elapsed className="w-[88px] text-right text-[12px] tabular-nums text-secondary">
                    {running
                        ? formatElapsed(now - (job.startedts ?? job.queuedts))
                        : `waiting ${formatElapsed(now - job.queuedts)}`}
                </span>
                {target != null ? (
                    <button
                        type="button"
                        data-job-open
                        title={`Open ${source}`}
                        onClick={() => {
                            close();
                            fireAndForget(() => openTarget(model, target));
                        }}
                        className="cursor-pointer rounded px-1 text-[12px] text-muted hover:bg-surface-hover hover:text-primary"
                    >
                        ↗
                    </button>
                ) : null}
                {running ? null : (
                    <button
                        type="button"
                        data-job-run-now
                        title="Start it now, whatever is running and whatever RAM is free"
                        onClick={() =>
                            act("run the job now", () => RpcApi.JobQueueRunNowCommand(TabRpcClient, { id: job.id }))
                        }
                        className={ROW_BUTTON}
                    >
                        Run now
                    </button>
                )}
                {running || job.engine ? null : (
                    <button
                        type="button"
                        data-job-skip
                        title="Drop it from the queue; its agent is told it was skipped"
                        onClick={() =>
                            act("skip the job", () => RpcApi.JobQueueSkipCommand(TabRpcClient, { id: job.id }))
                        }
                        className={cn(ROW_BUTTON, "text-error")}
                    >
                        Skip
                    </button>
                )}
            </div>
            <div data-job-source className="truncate pl-[15px] text-[11px] text-muted">
                {source}
                {running || !job.reason ? null : ` · ${job.reason}`}
            </div>
        </div>
    );
}

export function JobQueuePanel({ model }: { model: AgentsViewModel }) {
    useJobQueueFeed();
    const open = useAtomValue(jobQueueOpenAtom);
    const data = useAtomValue(jobQueueAtom);
    const agents = useAtomValue(model.agentsAtom);
    const placement = usePanelPlacement(open, useAtomValue(jobQueueOpenerAtom));
    const now = useNow(open);
    useEffect(() => {
        if (!open) {
            return;
        }
        const onKey = (e: KeyboardEvent) => {
            // a confirm over the panel owns Esc: it closes alone and the panel stays
            if (e.key !== "Escape" || modalsModel.hasOpenModals()) {
                return;
            }
            e.stopPropagation();
            close();
        };
        window.addEventListener("keydown", onKey, true);
        return () => window.removeEventListener("keydown", onKey, true);
    }, [open]);
    const jobs = ordered(data?.jobs ?? []);
    return (
        <>
            {open ? <div data-job-queue-backdrop className="fixed inset-0 z-50" onClick={close} /> : null}
            <PopoverReveal
                open={open}
                origin={placement.origin}
                // it hangs from the chip that opened it, wherever that sits
                style={{ right: placement.right, top: placement.top, bottom: placement.bottom, width: PANEL_WIDTH }}
                className="fixed z-[60] overflow-hidden rounded-lg border border-edge-strong bg-surface-raised shadow-popover"
            >
                <div data-job-queue-panel role="dialog" aria-label="Heavy jobs">
                    <div className="flex items-center gap-2 border-b border-border px-3 py-2">
                        <span className="flex-1 text-[12px] font-semibold text-secondary">Heavy jobs</span>
                        <label className="flex items-center gap-1.5 text-[11.5px] text-muted">
                            Slots
                            <select
                                data-job-queue-slots
                                title="How many heavy jobs run at once. Auto starts each as soon as the RAM it needs is free; Off never makes one wait"
                                value={paceValue(data)}
                                onChange={(e) => setPace(e.target.value)}
                                className="h-6 cursor-pointer rounded-[7px] border border-border bg-surface px-1.5 text-[11.5px] text-secondary hover:border-edge-mid hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                            >
                                {PACE_CHOICES.map((c) => (
                                    <option key={c.value} value={c.value}>
                                        {c.label}
                                    </option>
                                ))}
                            </select>
                        </label>
                    </div>
                    <PauseBar data={data} now={now} />
                    <div data-job-queue-list className="max-h-[56vh] overflow-y-auto py-1">
                        {jobs.length === 0 ? (
                            <div data-job-queue-empty className="px-3 py-2 text-[12px] text-muted">
                                No heavy jobs running.
                            </div>
                        ) : (
                            jobs.map((j) => <Row key={j.id} job={j} now={now} agents={agents} model={model} />)
                        )}
                    </div>
                </div>
            </PopoverReveal>
        </>
    );
}
