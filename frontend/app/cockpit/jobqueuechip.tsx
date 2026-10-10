// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { cn } from "@/util/util";
import { useAtomValue } from "jotai";
import { Layers, TriangleAlert } from "lucide-react";
import { useEffect, useState } from "react";
import { chipLabel, longWait, queuedTag, queueTitle } from "./jobqueue";
import { jobQueueAtom, toggleJobQueue } from "./jobqueuestore";

// how often a waiting queue re-reads the clock, so the chip turns to its warning without an event to say so
const LONG_WAIT_CHECK_MS = 15_000;

// The app bar's Jobs chip: how many heavy shell jobs run and how many wait their turn; a click opens the Jobs popover.
// Nothing while the queue is empty. It takes the warning tone once a job has waited past LONG_WAIT_MS.
export function JobQueueChip() {
    const data = useAtomValue(jobQueueAtom);
    const waiting = data?.jobs.some((j) => !j.running) ?? false;
    const [, setTick] = useState(0);
    useEffect(() => {
        if (!waiting) {
            return;
        }
        const timer = setInterval(() => setTick((n) => n + 1), LONG_WAIT_CHECK_MS);
        return () => clearInterval(timer);
    }, [waiting]);
    const label = data == null ? null : chipLabel(data);
    if (data == null || label == null) {
        return null;
    }
    const warn = longWait(data, Date.now());
    const Icon = warn ? TriangleAlert : Layers;
    return (
        <button
            type="button"
            data-job-queue-chip
            aria-haspopup="dialog"
            title={queueTitle(data)}
            onClick={(e) => toggleJobQueue(e.currentTarget)}
            className={cn(
                "flex shrink-0 cursor-pointer items-center gap-1 whitespace-nowrap rounded px-1 py-0.5 text-[11.5px] font-semibold tabular-nums hover:bg-surface-hover",
                warn ? "text-warning" : "text-muted"
            )}
        >
            <Icon data-job-queue-warn={warn ? "" : undefined} size={12} aria-hidden />
            {label}
        </button>
    );
}

// An agent's tag while its heavy command waits its turn: its place in the queue, why in the tooltip. A click opens the
// Jobs popover from the tag, where Run now and Skip are, and never reaches the row it sits on. It keeps its own clock,
// as the chip does, so it turns to its warning past LONG_WAIT_MS without its row or header ticking every second.
export function QueuedJobTag({ job }: { job: JobQueueJob }) {
    const [, setTick] = useState(0);
    useEffect(() => {
        const timer = setInterval(() => setTick((n) => n + 1), LONG_WAIT_CHECK_MS);
        return () => clearInterval(timer);
    }, []);
    const tag = queuedTag(job, Date.now());
    const Icon = tag.warn ? TriangleAlert : Layers;
    return (
        <button
            type="button"
            data-agent-queued={job.id}
            aria-haspopup="dialog"
            title={`${tag.title}. Click for Run now or Skip.`}
            onClick={(e) => {
                e.stopPropagation();
                toggleJobQueue(e.currentTarget);
            }}
            className={cn(
                "flex flex-none cursor-pointer items-center gap-[3px] whitespace-nowrap rounded-[5px] px-[3px] py-[1px] text-[10.5px] font-semibold tabular-nums hover:bg-surface-hover",
                tag.warn ? "text-warning" : "text-muted"
            )}
        >
            <Icon size={10} aria-hidden />
            {tag.label}
        </button>
    );
}
