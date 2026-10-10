// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The Jobs chip and popover's logic (spec 2026-10-09-heavy-job-queue-design.md): what the chip says, when it warns, how
// the rows are ordered, worded and opened. The queue itself is wavesrv's (pkg/jobqueue); this is only how the cockpit
// reads its snapshot. jobqueuechip.tsx and jobqueuepanel.tsx draw it.

import type { AgentVM } from "@/app/view/agents/agentsviewmodel";
import type { OpenTarget } from "@/app/view/jarvis/address";

/** A job that has waited this long makes the chip warn: whatever holds the slot is probably stuck. */
export const LONG_WAIT_MS = 5 * 60_000;

/** The roster fields a row needs to name or open the agent behind a job. */
export type JobAgent = Pick<AgentVM, "id" | "name" | "blockId">;

function runningCount(d: JobQueueData): number {
    return d.jobs.filter((j) => j.running).length;
}

/** The chip's text, or null when nothing runs or waits and the chip is not drawn. */
export function chipLabel(d: JobQueueData): string | null {
    const running = runningCount(d);
    const queued = d.jobs.length - running;
    if (running > 0 && queued > 0) {
        return `${running} · ${queued} queued`;
    }
    if (running > 0) {
        return `${running} running`;
    }
    return queued > 0 ? `${queued} queued` : null;
}

/** The chip's tooltip. */
export function queueTitle(d: JobQueueData): string {
    const running = runningCount(d);
    const pace = d.slots === 1 ? "one at a time" : `${d.slots} at a time`;
    return `Heavy jobs: ${running} running, ${d.jobs.length - running} queued (${pace}; set in the popover)`;
}

/** Whether a queued job has waited past LONG_WAIT_MS at `now` (Unix ms). A running job has stopped waiting. */
export function longWait(d: JobQueueData, now: number): boolean {
    return d.jobs.some((j) => !j.running && now - j.queuedts > LONG_WAIT_MS);
}

/** "20s", "2m 14s", "1h 2m": the two largest units, nothing below a second. */
export function formatElapsed(ms: number): string {
    const total = Math.max(0, Math.floor(ms / 1000));
    if (total < 60) {
        return `${total}s`;
    }
    if (total < 3600) {
        return `${Math.floor(total / 60)}m ${total % 60}s`;
    }
    return `${Math.floor(total / 3600)}h ${Math.floor((total % 3600) / 60)}m`;
}

/** The rows' order: running jobs first, the longest-running on top, then the queue in the order it will be served. */
export function ordered(jobs: JobQueueJob[]): JobQueueJob[] {
    return [...jobs].sort((a, b) => {
        if (a.running !== b.running) {
            return a.running ? -1 : 1;
        }
        if (a.running) {
            return (a.startedts ?? 0) - (b.startedts ?? 0);
        }
        return (a.position ?? 0) - (b.position ?? 0);
    });
}

/** Who the job is for: an engine step with its run, or the agent whose shell asked. wavesrv does not know an agent's
 * display name, so it comes from the roster by block id. */
export function sourceLabel(job: JobQueueJob, agents: readonly JobAgent[]): string {
    if (job.runid) {
        const run = `Run ${job.runid.slice(0, 6)}`;
        return job.label ? `${run} · ${job.label}` : run;
    }
    return agents.find((a) => job.blockid && a.blockId === job.blockid)?.name ?? "an agent";
}

/** What the row's ↗ opens: its run, or its agent's tab; null when the job has neither (and the row has no ↗). */
export function openTargetFor(job: JobQueueJob, agents: readonly JobAgent[]): OpenTarget | null {
    if (job.runid) {
        return { kind: "run", runId: job.runid };
    }
    if (job.tabid) {
        return { kind: "agent", tabId: job.tabid };
    }
    const agent = agents.find((a) => job.blockid && a.blockId === job.blockid);
    return agent ? { kind: "agent", tabId: agent.id } : null;
}

/** The job an agent's block waits on: its queued job served first, or null when it has none waiting. A running job has
 * stopped waiting, and an engine step belongs to no block. */
export function queuedJobFor(d: JobQueueData | null, blockId: string | undefined): JobQueueJob | null {
    if (d == null || !blockId) {
        return null;
    }
    const waiting = d.jobs.filter((j) => !j.running && j.blockid === blockId);
    return ordered(waiting)[0] ?? null;
}

/** What an agent's row and header say while its heavy command waits its turn: the head of the queue says why it waits
 * (the queue's reason is the head's), a job further back how many wait ahead of it. It warns past LONG_WAIT_MS, as the
 * chip does. */
export function queuedTag(job: JobQueueJob, now: number): { label: string; title: string; warn: boolean } {
    const pos = job.position ?? 0;
    const title = `${job.name} waits its turn in the heavy-job queue`;
    let why = "";
    if (pos > 1) {
        why = `${pos - 1} ${pos === 2 ? "job" : "jobs"} ahead of it`;
    } else if (pos === 1 && job.reason) {
        why = job.reason;
    }
    return {
        label: pos > 0 ? `queued #${pos}` : "queued",
        title: why ? `${title}: ${why}` : title,
        warn: now - job.queuedts > LONG_WAIT_MS,
    };
}
