// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { workerBucket, workerSortKey, type WorkerSortBucket } from "./workertasksort";

function td(waitreason: string, cleanupstate = "clear"): DagTaskDigest {
    return {
        taskid: "t",
        waitreason,
        cleanupstate,
        mergestate: "not-required",
    };
}

function node(state: string): TaskNode {
    return { id: "t", state } as TaskNode;
}

const BUCKET_ORDER: Record<WorkerSortBucket, number> = { attention: 0, running: 1, waiting: 2, done: 3 };

describe("workerBucket", () => {
    it("puts every exception class in the attention bucket", () => {
        expect(workerBucket(td("ask"), node("running"))).toBe("attention");
        expect(workerBucket(td("failure"), node("failed"))).toBe("attention");
        expect(workerBucket(td("none"), node("failed"))).toBe("attention");
        expect(workerBucket(td("none"), node("stalled"))).toBe("attention");
        expect(workerBucket(td("none"), node("blocked-merge"))).toBe("attention");
        expect(workerBucket(td("ask"), node("done"))).toBe("attention");
        expect(workerBucket(td("none", "failed"), node("done"))).toBe("attention");
    });

    it("puts running tasks in the running bucket", () => {
        expect(workerBucket(td("none"), node("running"))).toBe("running");
        expect(workerBucket(td("none"), node("preparing"))).toBe("running");
    });

    it("puts dependency/parallelism waits and pending/ready in the waiting bucket", () => {
        expect(workerBucket(td("dependency"), node("pending"))).toBe("waiting");
        expect(workerBucket(td("parallelism"), node("pending"))).toBe("waiting");
        expect(workerBucket(td("none"), node("pending"))).toBe("waiting");
        expect(workerBucket(td("none"), node("ready"))).toBe("waiting");
    });

    it("puts completed/merged/skipped/cancelled in the done bucket", () => {
        expect(workerBucket(td("terminal"), node("done"))).toBe("done");
        expect(workerBucket(td("none"), node("merged"))).toBe("done");
        expect(workerBucket(td("none"), node("skipped"))).toBe("done");
        expect(workerBucket(td("none"), node("cancelled"))).toBe("done");
    });

    it("buckets a failed Verify as attention and a running one as running", () => {
        expect(workerBucket(td("verify"), node("verify-failed"))).toBe("attention");
        expect(workerBucket(td("verify"), node("verifying"))).toBe("running");
    });
});

describe("workerSortKey", () => {
    it("orders attention < running < waiting < done", () => {
        const attention = workerSortKey(td("ask"), node("running"));
        const running = workerSortKey(td("none"), node("running"));
        const waiting = workerSortKey(td("dependency"), node("pending"));
        const done = workerSortKey(td("terminal"), node("done"));
        expect(attention).toBe(BUCKET_ORDER.attention);
        expect(running).toBe(BUCKET_ORDER.running);
        expect(waiting).toBe(BUCKET_ORDER.waiting);
        expect(done).toBe(BUCKET_ORDER.done);
        expect(attention < running && running < waiting && waiting < done).toBe(true);
    });

    it("ties within a bucket stay distinguishable via caller index (stable)", () => {
        const a = workerSortKey(td("ask", "failed"), node("failed"));
        const b = workerSortKey(td("ask"), node("running"));
        expect(a).toBe(b); // same bucket; caller's DAG index breaks the tie
    });
});