// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// What a land in flight is doing, said on the run's tree line and in its peek. A land that is pending runs the plan's
// Check, then its Verify, on the run merged with its base (pkg/orchestrate/land.go), and each holds a slot in the
// heavy-job queue tagged with the run's id and "<step> · land". The land's own state only says "pending", so a land
// waiting on RAM, one ten minutes into Verify and one getting its merge ready all read "Landing". This joins the land
// with the queue: the step, how long it has run or why it waits, and the lines another agent needs to take it over.
// Pure: no React, no Wave runtime imports.

import { formatElapsed } from "@/app/cockpit/jobqueue";

const LAND_LABEL_SUFFIX = " · land";

export type LandWait = "ram" | "slot" | "e2e" | "other";

export interface LandProgress {
    /** the run's tree line: "Landing · Verify running 4m 10s" */
    text: string;
    /** the step's name ("Check", "Verify"), "" while no step is in the queue */
    step: string;
    /** the land's job in the heavy-job queue, while it has one */
    job?: JobQueueJob;
    /** set while the job waits its turn: what it waits on */
    wait?: LandWait;
    /** the peek's and the tooltip's lines, also what "Copy for an agent" copies */
    lines: string[];
}

/** The land's job in the queue: the run's job whose label ends " · land", a running one before a queued one. */
export function landJob(jobs: readonly JobQueueJob[] | null | undefined, runId: string): JobQueueJob | undefined {
    const mine = (jobs ?? []).filter((j) => j.runid === runId && (j.label ?? "").endsWith(LAND_LABEL_SUFFIX));
    return mine.find((j) => j.running) ?? mine.sort((a, b) => (a.position ?? 0) - (b.position ?? 0))[0];
}

/** What a queued job's reason (pkg/jobqueue evaluate) waits on. */
export function landWait(reason: string | undefined): LandWait {
    const r = reason ?? "";
    if (r.startsWith("needs ") || r.startsWith("memory pressure")) {
        return "ram";
    }
    if (r === "slot busy") {
        return "slot";
    }
    if (r.includes("e2e")) {
        return "e2e";
    }
    return "other";
}

const WAIT_WORDS: Record<LandWait, string> = {
    ram: "waiting for RAM",
    slot: "waiting for a job slot",
    e2e: "waiting for an e2e run",
    other: "waiting its turn",
};

/** A pending land's line and peek, or null for a land that is not pending (in line, resolving, held, landed): those
 *  have their own words (dagProgressLabel). */
export function landProgress(
    run: { runId: string; base?: string; land?: { state: string } },
    jobs: readonly JobQueueJob[] | null | undefined,
    now: number
): LandProgress | null {
    if (run.land?.state !== "pending") {
        return null;
    }
    const base = run.base || "its base";
    const job = landJob(jobs, run.runId);
    const header = `Run ${run.runId} · land pending into ${base}`;
    const inspect = `Inspect: wsh runs show ${run.runId}`;
    if (job == null) {
        return {
            text: "Landing · getting the merge ready",
            step: "",
            lines: [
                header,
                `Step: none in the heavy-job queue: merging ${base} into the run's branch, or between Check and Verify`,
                inspect,
            ],
        };
    }
    const step = (job.label ?? "").slice(0, -LAND_LABEL_SUFFIX.length) || "Check";
    const command = `Command: ${job.name}`;
    if (job.running) {
        const ran = formatElapsed(now - (job.startedts ?? now));
        return {
            text: `Landing · ${step} running ${ran}`,
            step,
            job,
            lines: [header, `Step: ${step}, running for ${ran} on the run merged with ${base}`, command, inspect],
        };
    }
    const wait = landWait(job.reason);
    const place = job.position ? ` · #${job.position}` : "";
    const waited = formatElapsed(now - job.queuedts);
    return {
        text: `Landing · ${step} ${WAIT_WORDS[wait]}${place}`,
        step,
        job,
        wait,
        lines: [
            header,
            `Step: ${step}, queued for ${waited} in the heavy-job queue${job.position ? `, #${job.position} in line` : ""}`,
            `Why: ${job.reason || "waiting its turn"}`,
            command,
            `Job: ${job.id} (Run now in Jobs starts it past the queue)`,
            inspect,
        ],
    };
}
