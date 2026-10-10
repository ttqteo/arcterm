// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
    chipLabel,
    formatElapsed,
    LONG_WAIT_MS,
    longWait,
    openTargetFor,
    ordered,
    queuedJobFor,
    queuedTag,
    queueTitle,
    sourceLabel,
} from "./jobqueue";

const job = (o: Partial<JobQueueJob>): JobQueueJob => ({
    id: "j1",
    name: "task check:ts",
    bytes: 3 * 2 ** 30,
    queuedts: 0,
    ...o,
});

describe("jobqueue", () => {
    it("hides the chip when nothing runs or waits", () => {
        expect(chipLabel({ slots: 1, jobs: [] })).toBeNull();
    });
    it("counts running and queued", () => {
        expect(chipLabel({ slots: 1, jobs: [job({ running: true })] })).toBe("1 running");
        expect(chipLabel({ slots: 1, jobs: [job({ running: true }), job({ id: "j2" }), job({ id: "j3" })] })).toBe(
            "1 · 2 queued"
        );
        expect(chipLabel({ slots: 1, jobs: [job({ id: "j2" })] })).toBe("1 queued");
    });
    it("counts every running job when the slots allow several", () => {
        expect(chipLabel({ slots: 3, jobs: [job({ running: true }), job({ id: "j2", running: true })] })).toBe(
            "2 running"
        );
    });
    it("warns once a job has waited past LONG_WAIT_MS", () => {
        const d = { slots: 1, jobs: [job({ queuedts: 1_000 })] };
        expect(longWait(d, 1_000 + LONG_WAIT_MS - 1)).toBe(false);
        expect(longWait(d, 1_000 + LONG_WAIT_MS + 1)).toBe(true);
        expect(longWait({ slots: 1, jobs: [job({ running: true, queuedts: 0 })] }, LONG_WAIT_MS * 2)).toBe(false);
    });
    it("formats elapsed time", () => {
        expect(formatElapsed(20_000)).toBe("20s");
        expect(formatElapsed(134_000)).toBe("2m 14s");
        expect(formatElapsed(3_720_000)).toBe("1h 2m");
    });
    it("never formats a negative elapsed time", () => {
        expect(formatElapsed(-5_000)).toBe("0s");
    });
    it("orders running first, then by queue position", () => {
        const out = ordered([
            job({ id: "q2", position: 2 }),
            job({ id: "r", running: true }),
            job({ id: "q1", position: 1 }),
        ]);
        expect(out.map((j) => j.id)).toEqual(["r", "q1", "q2"]);
    });
    it("orders running jobs by when they started", () => {
        const out = ordered([
            job({ id: "late", running: true, startedts: 9 }),
            job({ id: "early", running: true, startedts: 3 }),
        ]);
        expect(out.map((j) => j.id)).toEqual(["early", "late"]);
    });
    it("does not mutate the snapshot it orders", () => {
        const jobs = [job({ id: "q", position: 1 }), job({ id: "r", running: true })];
        ordered(jobs);
        expect(jobs.map((j) => j.id)).toEqual(["q", "r"]);
    });
    it("names the source: an engine step with its run, or the agent", () => {
        expect(sourceLabel(job({ runid: "700db4a1-xx", label: "Verify · Task 3" }), [])).toBe(
            "Run 700db4 · Verify · Task 3"
        );
        expect(sourceLabel(job({ runid: "700db4a1-xx" }), [])).toBe("Run 700db4");
        expect(sourceLabel(job({ blockid: "b1" }), [{ id: "t1", blockId: "b1", name: "fix-footer" }])).toBe(
            "fix-footer"
        );
        expect(sourceLabel(job({ blockid: "b9" }), [])).toBe("an agent");
        expect(sourceLabel(job({}), [])).toBe("an agent");
    });
    it("opens a run, or an agent's tab, or nothing", () => {
        expect(openTargetFor(job({ runid: "run-1" }), [])).toEqual({ kind: "run", runId: "run-1" });
        expect(openTargetFor(job({ blockid: "b1", tabid: "tab-1" }), [])).toEqual({ kind: "agent", tabId: "tab-1" });
        expect(openTargetFor(job({ blockid: "b1" }), [{ id: "t1", blockId: "b1", name: "fix-footer" }])).toEqual({
            kind: "agent",
            tabId: "t1",
        });
        expect(openTargetFor(job({ blockid: "b9" }), [])).toBeNull();
        expect(openTargetFor(job({}), [])).toBeNull();
    });
    it("words the chip's tooltip", () => {
        const d = { slots: 1, jobs: [job({ running: true }), job({ id: "j2" }), job({ id: "j3" })] };
        expect(queueTitle(d)).toBe("Heavy jobs: 1 running, 2 queued (one at a time; set in the popover)");
        expect(queueTitle({ ...d, slots: 3 })).toBe(
            "Heavy jobs: 1 running, 2 queued (3 at a time; set in the popover)"
        );
    });
    it("finds the job an agent's block waits on, the one served first", () => {
        const d = {
            slots: 1,
            jobs: [
                job({ id: "r", running: true, blockid: "b1" }),
                job({ id: "q3", position: 3, blockid: "b1" }),
                job({ id: "q2", position: 2, blockid: "b1" }),
                job({ id: "q1", position: 1, blockid: "b2" }),
            ],
        };
        expect(queuedJobFor(d, "b1")?.id).toBe("q2");
        expect(queuedJobFor(d, "b2")?.id).toBe("q1");
    });
    it("finds nothing for a block that only runs, a block with no job, or no block", () => {
        const d = { slots: 1, jobs: [job({ id: "r", running: true, blockid: "b1" }), job({ id: "e", position: 1 })] };
        expect(queuedJobFor(d, "b1")).toBeNull();
        expect(queuedJobFor(d, "b9")).toBeNull();
        expect(queuedJobFor(d, undefined)).toBeNull();
        expect(queuedJobFor(null, "b1")).toBeNull();
    });
    it("tags the head of the queue with why it waits", () => {
        const tag = queuedTag(job({ position: 1, reason: "needs 3.0 GB, 1.2 GB free", queuedts: 0 }), 20_000);
        expect(tag).toEqual({
            label: "queued #1",
            title: "task check:ts waits its turn in the heavy-job queue: needs 3.0 GB, 1.2 GB free",
            warn: false,
        });
    });
    it("tags a job further back with how many wait ahead of it", () => {
        expect(queuedTag(job({ position: 3, reason: "slot busy" }), 0).title).toBe(
            "task check:ts waits its turn in the heavy-job queue: 2 jobs ahead of it"
        );
        expect(queuedTag(job({ position: 2, reason: "slot busy" }), 0).title).toBe(
            "task check:ts waits its turn in the heavy-job queue: 1 job ahead of it"
        );
    });
    it("tags a job with no position or reason plainly", () => {
        expect(queuedTag(job({}), 0)).toEqual({
            label: "queued",
            title: "task check:ts waits its turn in the heavy-job queue",
            warn: false,
        });
    });
    it("warns on a tag once its job has waited past LONG_WAIT_MS", () => {
        expect(queuedTag(job({ position: 1, queuedts: 1_000 }), 1_000 + LONG_WAIT_MS - 1).warn).toBe(false);
        expect(queuedTag(job({ position: 1, queuedts: 1_000 }), 1_000 + LONG_WAIT_MS + 1).warn).toBe(true);
    });
});
