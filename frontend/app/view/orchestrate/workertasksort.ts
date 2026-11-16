// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Deterministic exception-first ordering of the overview's worker rows (spec 6.1): asks, failed,
// stalled, blocked-merge, cleanup-failed -> running -> ready/dependency-waiting -> done/merged/skipped/
// cancelled.

export type WorkerSortBucket = "attention" | "running" | "waiting" | "done";

const BUCKET_RANK: Record<WorkerSortBucket, number> = { attention: 0, running: 1, waiting: 2, done: 3 };

// workerSortKey maps a task to a stable sort number: the digest's attention signals (ask, failure,
// blocked merge, failed cleanup) plus the node state, so an ordinary stall reads "attention" and a
// dependency/parallelism wait reads "waiting". The caller keeps its DAG order as the tie-break so
// within-bucket order is deterministic.
export function workerSortKey(td: DagTaskDigest, node: TaskNode): number {
    return BUCKET_RANK[workerBucket(td, node)];
}

export function workerBucket(td: DagTaskDigest, node: TaskNode): WorkerSortBucket {
    if (td.waitreason === "ask" || td.waitreason === "failure") {
        return "attention";
    }
    if (td.cleanupstate === "failed") {
        return "attention";
    }
    switch (node.state) {
        case "failed":
        case "stalled":
        case "blocked-merge":
        case "verify-failed":
        case "review-failed":
            return "attention";
        case "running":
        case "verifying":
        case "reviewing":
        case "preparing":
            return "running";
        case "done":
        case "merged":
        case "skipped":
        case "cancelled":
            return "done";
        default:
            break;
    }
    // pending/ready tasks waiting on deps or parallelism (or the dispatch queue)
    if (td.waitreason === "dependency" || td.waitreason === "parallelism" || node.state === "pending" || node.state === "ready") {
        return "waiting";
    }
    return "done";
}