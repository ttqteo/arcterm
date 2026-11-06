// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { landJob, landProgress, landWait } from "./landprogress";

const RUN = "983dcb44-38cf-4e78-b5dd-c0d7bcb0a206";
const NOW = 1_000_000_000;
const pending = { runId: RUN, base: "main", land: { state: "pending" } };

function job(over: Partial<JobQueueJob>): JobQueueJob {
    return {
        id: "j1",
        name: "node scripts/verify.mjs ./pkg/orchestrate",
        bytes: 2 << 30,
        queuedts: NOW - 90_000,
        ...over,
    };
}

describe("landJob", () => {
    it("takes the run's land job, the running one first", () => {
        const jobs = [
            job({ id: "other-run", runid: "x", label: "Verify · land", running: true }),
            job({ id: "task-verify", runid: RUN, label: "Verify · t-3", running: true }),
            job({ id: "queued", runid: RUN, label: "Verify · land", position: 2 }),
            job({ id: "running", runid: RUN, label: "Check · land", running: true }),
        ];
        expect(landJob(jobs, RUN)?.id).toBe("running");
        expect(landJob(jobs.slice(0, 3), RUN)?.id).toBe("queued");
        expect(landJob(jobs.slice(0, 2), RUN)).toBeUndefined();
        expect(landJob(null, RUN)).toBeUndefined();
    });
});

describe("landWait", () => {
    it("reads the queue's reasons", () => {
        expect(landWait("needs 3.2 GB, 1.1 GB free")).toBe("ram");
        expect(landWait("memory pressure high, one at a time")).toBe("ram");
        expect(landWait("memory pressure critical")).toBe("ram");
        expect(landWait("slot busy")).toBe("slot");
        expect(landWait("an e2e or smoke run is running")).toBe("e2e");
        expect(landWait(undefined)).toBe("other");
    });
});

describe("landProgress", () => {
    it("is null for a land that is not pending: in line, resolving, held and landed say their own words", () => {
        for (const state of ["queued", "resolving", "held", "landed"]) {
            expect(landProgress({ ...pending, land: { state } }, [], NOW)).toBeNull();
        }
        expect(landProgress({ runId: RUN }, [], NOW)).toBeNull();
    });

    it("says the step and how long it has run while its job runs", () => {
        const p = landProgress(
            pending,
            [job({ runid: RUN, label: "Verify · land", running: true, startedts: NOW - 250_000 })],
            NOW
        );
        expect(p?.text).toBe("Landing · Verify running 4m 10s");
        expect(p?.wait).toBeUndefined();
        expect(p?.lines).toEqual([
            `Run ${RUN} · land pending into main`,
            "Step: Verify, running for 4m 10s on the run merged with main",
            "Command: node scripts/verify.mjs ./pkg/orchestrate",
            `Inspect: wsh runs show ${RUN}`,
        ]);
    });

    it("says it waits for RAM, its place and the queue's reason while its job is queued", () => {
        const p = landProgress(
            pending,
            [job({ runid: RUN, label: "Check · land", position: 1, reason: "needs 3.2 GB, 1.1 GB free" })],
            NOW
        );
        expect(p?.text).toBe("Landing · Check waiting for RAM · #1");
        expect(p?.wait).toBe("ram");
        expect(p?.job?.id).toBe("j1");
        expect(p?.lines).toContain("Why: needs 3.2 GB, 1.1 GB free");
        expect(p?.lines).toContain("Step: Check, queued for 1m 30s in the heavy-job queue, #1 in line");
        expect(p?.lines).toContain("Job: j1 (Run now in Jobs starts it past the queue)");
    });

    it("says a slot wait apart from a RAM wait", () => {
        const p = landProgress(
            pending,
            [job({ runid: RUN, label: "Verify · land", position: 3, reason: "slot busy" })],
            NOW
        );
        expect(p?.text).toBe("Landing · Verify waiting for a job slot · #3");
    });

    it("says the merge is being readied while no step is in the queue", () => {
        const p = landProgress({ runId: RUN, land: { state: "pending" } }, [], NOW);
        expect(p?.text).toBe("Landing · getting the merge ready");
        expect(p?.job).toBeUndefined();
        expect(p?.lines[0]).toBe(`Run ${RUN} · land pending into its base`);
        expect(p?.lines.at(-1)).toBe(`Inspect: wsh runs show ${RUN}`);
    });
});
