// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// A compact per-task recovery line for the overview, derived from the run's own retained lifecycle
// events — the same rows the timeline rail renders, read through the same detail parser. No separate
// recovery store, and no count that the surviving evidence cannot support.

import { detailOf } from "../agents/runtimeline";

export type RecoverySummary = {
    // task-retried rows that survived retention
    retries: number;
    lastFailureKind?: string;
    // the retained rows record more attempts than they can account for: some were pruned
    partial: boolean;
    terminalFailure: boolean;
};

type RetryDetail = { taskid?: string; kind?: string; attempt?: number; by?: string };
type FailedDetail = { taskid?: string; lastfailurekind?: string; attempts?: number };

// recoverySummary returns null for a task with no failure history at all — the ordinary case, where a
// row has nothing to add.
export function recoverySummary(events: RunEvent[], taskId: string): RecoverySummary | null {
    let retries = 0;
    let maxAttempt = 0;
    let terminalFailure = false;
    let lastFailureKind: string | undefined;
    let lastTs = -1;
    for (const event of events) {
        if (event.kind === "task-retried") {
            const detail = detailOf<RetryDetail>(event);
            // a human's or lead's retry (stamped `by`) has no kind or attempt: not an engine recovery
            if (detail?.taskid !== taskId || detail.by) {
                continue;
            }
            retries++;
            maxAttempt = Math.max(maxAttempt, detail.attempt ?? 0);
            if (event.ts > lastTs) {
                lastTs = event.ts;
                lastFailureKind = detail.kind || undefined;
            }
        } else if (event.kind === "task-failed") {
            const detail = detailOf<FailedDetail>(event);
            if (detail?.taskid !== taskId) {
                continue;
            }
            terminalFailure = true;
            maxAttempt = Math.max(maxAttempt, detail.attempts ?? 0);
            if (event.ts > lastTs) {
                lastTs = event.ts;
                lastFailureKind = detail.lastfailurekind || undefined;
            }
        }
    }
    if (retries === 0 && !terminalFailure) {
        return null;
    }
    // a terminal failure consumes an attempt without emitting a retry, so it legitimately accounts for
    // one attempt more than the retries. The engine also resets the attempt counter when the failure
    // KIND changes, which can hide a gap — this under-claims rather than over-claims, which is the
    // right way round for a number a human will act on.
    const accountedFor = terminalFailure ? maxAttempt - 1 : maxAttempt;
    return { retries, lastFailureKind, partial: retries < accountedFor, terminalFailure };
}

// recoveryText renders the summary as one line: what happened, why, and where the task stands now.
export function recoveryText(summary: RecoverySummary, taskState: string): string {
    const parts: string[] = [countText(summary)];
    if (summary.lastFailureKind) {
        parts.push(summary.lastFailureKind);
    }
    parts.push(`now ${taskState}`);
    if (summary.partial) {
        parts.push("earlier history not retained");
    }
    return parts.join(" · ");
}

function countText(summary: RecoverySummary): string {
    if (summary.retries === 0) {
        return "Failed";
    }
    if (summary.partial) {
        // the surviving rows prove a retry happened but not how many
        return "Retried at least once";
    }
    return summary.retries === 1 ? "Retried once" : `Retried ${summary.retries} times`;
}
