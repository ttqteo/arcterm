// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { cn } from "@/util/util";
import { useAtomValue } from "jotai";
import { Layers, Pause, ShieldCheck, TriangleAlert } from "lucide-react";
import { useEffect, useState } from "react";
import {
    bypassOnly,
    chipText,
    chipTitle,
    longWait,
    pauseLeft,
    protectedJob,
    queuedTag,
    recentBypass,
    runQueuedTag,
    shortQueuedTag,
} from "./jobqueue";
import { jobQueueAtom, toggleJobQueue } from "./jobqueuestore";

// how often a waiting or paused queue re-reads the clock, so the chip turns to its warning, or counts a pause down,
// without an event to say so
const LONG_WAIT_CHECK_MS = 15_000;

// The app bar's Jobs chip: how many heavy shell jobs run and how many wait their turn; a click opens the Jobs popover.
// Nothing while the queue is empty, unless a pause is on: then it counts the pause down; or, for RECENT_BYPASS_MS after
// a command ran without a slot, "N ran unqueued" in the warning tone. It takes the warning tone
// once a job has waited past LONG_WAIT_MS.
// compact (Float's ledge): the icon and how many jobs, the words in the tooltip, so the chip showing barely moves the ledge
export function JobQueueChip({ compact = false }: { compact?: boolean } = {}) {
    const data = useAtomValue(jobQueueAtom);
    const now = Date.now();
    const waiting = data?.jobs.some((j) => !j.running) ?? false;
    const paused = pauseLeft(data, now) != null;
    // a recent bypass keeps the clock going too, so the chip it raised goes once RECENT_BYPASS_MS is up
    const bypassed = recentBypass(data, now);
    const [, setTick] = useState(0);
    useEffect(() => {
        if (!waiting && !paused && !bypassed) {
            return;
        }
        const timer = setInterval(() => setTick((n) => n + 1), LONG_WAIT_CHECK_MS);
        return () => clearInterval(timer);
    }, [waiting, paused, bypassed]);
    const label = data == null ? null : chipText(data, now);
    if (data == null || label == null) {
        return null;
    }
    const protecting = protectedJob(data) != null;
    // a Protect job keeps every queued job waiting on purpose: that is not a stuck queue
    const warn = !protecting && (longWait(data, now) || bypassOnly(data, now));
    const Icon = warn ? TriangleAlert : protecting ? ShieldCheck : paused ? Pause : Layers;
    return (
        <button
            type="button"
            data-job-queue-chip
            data-job-queue-paused={paused ? "" : undefined}
            data-job-queue-protected={protecting ? "" : undefined}
            aria-haspopup="dialog"
            aria-label={compact ? label : undefined}
            title={compact ? `${label}\n${chipTitle(data, now)}` : chipTitle(data, now)}
            onClick={(e) => toggleJobQueue(e.currentTarget)}
            className={cn(
                "flex shrink-0 cursor-pointer items-center gap-1 whitespace-nowrap rounded px-1 py-0.5 text-[11.5px] font-semibold tabular-nums hover:bg-surface-hover",
                warn ? "text-warning" : "text-muted"
            )}
        >
            <Icon data-job-queue-warn={warn ? "" : undefined} size={12} aria-hidden />
            {compact ? (data.jobs.length > 0 ? data.jobs.length : null) : label}
        </button>
    );
}

// An agent's tag while its heavy command waits its turn: its place in the queue, why in the tooltip. A click opens the
// Jobs popover from the tag, where Run now and Skip are, and never reaches the row it sits on. It keeps its own clock,
// as the chip does, so it turns to its warning past LONG_WAIT_MS without its row or header ticking every second.
// `short` in the Agent tree: "#1", the words in the tooltip (shortQueuedTag), so it stays whole beside a row's columns.
export function QueuedJobTag({ job, short }: { job: JobQueueJob; short?: boolean }) {
    useWaitClock();
    const tag = short ? shortQueuedTag(job, Date.now()) : queuedTag(job, Date.now());
    return <QueueTagButton tag={tag} focus={[job.id]} attrs={{ "data-agent-queued": job.id }} />;
}

// A run's tag while any of its jobs waits: its engine steps and its agents' commands, so a folded run still says it
// waits on the queue. Short beside the run's progress: the glyph and "#1" for one job, "×2" for several, the words and
// each job in the tooltip (runQueuedTag).
export function RunQueuedTag({ runId, jobs }: { runId: string; jobs: readonly JobQueueJob[] }) {
    useWaitClock();
    const tag = runQueuedTag(jobs, Date.now());
    return tag == null ? null : (
        <QueueTagButton tag={tag} focus={jobs.map((j) => j.id)} attrs={{ "data-run-queued": runId }} />
    );
}

// the tags keep their own clock, as the chip does, so they turn to the warning without their row ticking every second
function useWaitClock() {
    const [, setTick] = useState(0);
    useEffect(() => {
        const timer = setInterval(() => setTick((n) => n + 1), LONG_WAIT_CHECK_MS);
        return () => clearInterval(timer);
    }, []);
}

// whole, never cut: in the Agent tree its label is short ("#1", "×2") and the words left of it shrink instead. The
// popover it opens draws its jobs (`focus`) selected, so the row the tag sits on is the one you find there
function QueueTagButton({
    tag,
    focus,
    attrs,
}: {
    tag: { label: string; title: string; warn: boolean };
    focus: readonly string[];
    attrs: Record<string, string>;
}) {
    const Icon = tag.warn ? TriangleAlert : Layers;
    return (
        <button
            type="button"
            {...attrs}
            aria-haspopup="dialog"
            title={`${tag.title}. Click for Run now or Skip.`}
            onClick={(e) => {
                e.stopPropagation();
                toggleJobQueue(e.currentTarget, focus);
            }}
            className={cn(
                "flex flex-none cursor-pointer items-center gap-[3px] whitespace-nowrap rounded-[5px] px-[3px] py-[1px] text-[10.5px] font-semibold tabular-nums hover:bg-surface-hover",
                tag.warn ? "text-warning" : "text-muted"
            )}
        >
            <Icon size={10} aria-hidden className="flex-none" />
            {tag.label ? <span>{tag.label}</span> : null}
        </button>
    );
}
