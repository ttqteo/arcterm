// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
    bypassLine,
    bypassOnly,
    chipLabel,
    chipText,
    chipTitle,
    formatElapsed,
    formatLeft,
    LONG_WAIT_MS,
    longWait,
    openTargetFor,
    ordered,
    paceOfSettings,
    pacePatch,
    paceValue,
    pauseLeft,
    pausePatch,
    queuedJobFor,
    queuedStepFor,
    queuedTag,
    queueTitle,
    RECENT_BYPASS_MS,
    runQueuedJobs,
    runQueuedTag,
    sizeLabel,
    sourceLabel,
    stepQueuedState,
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
        expect(chipLabel({ slots: 1, mode: "slots", jobs: [] })).toBeNull();
    });
    it("counts running and queued", () => {
        expect(chipLabel({ slots: 1, mode: "slots", jobs: [job({ running: true })] })).toBe("1 running");
        expect(
            chipLabel({ slots: 1, mode: "slots", jobs: [job({ running: true }), job({ id: "j2" }), job({ id: "j3" })] })
        ).toBe("1 · 2 queued");
        expect(chipLabel({ slots: 1, mode: "slots", jobs: [job({ id: "j2" })] })).toBe("1 queued");
    });
    it("counts every running job when the slots allow several", () => {
        expect(
            chipLabel({ slots: 3, mode: "slots", jobs: [job({ running: true }), job({ id: "j2", running: true })] })
        ).toBe("2 running");
    });
    it("warns once a job has waited past LONG_WAIT_MS", () => {
        const d = { slots: 1, mode: "slots", jobs: [job({ queuedts: 1_000 })] };
        expect(longWait(d, 1_000 + LONG_WAIT_MS - 1)).toBe(false);
        expect(longWait(d, 1_000 + LONG_WAIT_MS + 1)).toBe(true);
        expect(
            longWait({ slots: 1, mode: "slots", jobs: [job({ running: true, queuedts: 0 })] }, LONG_WAIT_MS * 2)
        ).toBe(false);
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
        expect(sourceLabel(job({ runid: "700db4a1-xx", label: "Check · base tree" }), [], "Heavy job queue")).toBe(
            "Heavy job queue · Check · base tree"
        );
        expect(sourceLabel(job({ runid: "700db4a1-xx" }), [], "  ")).toBe("Run 700db4");
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
        const d = { slots: 1, mode: "slots", jobs: [job({ running: true }), job({ id: "j2" }), job({ id: "j3" })] };
        expect(queueTitle(d)).toBe("Heavy jobs: 1 running, 2 queued (one at a time; set in the popover)");
        expect(queueTitle({ ...d, slots: 3 })).toBe(
            "Heavy jobs: 1 running, 2 queued (3 at a time; set in the popover)"
        );
    });
    it("finds the job an agent's block waits on, the one served first", () => {
        const d = {
            slots: 1,
            mode: "slots",
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
        const d = {
            slots: 1,
            mode: "slots",
            jobs: [job({ id: "r", running: true, blockid: "b1" }), job({ id: "e", position: 1 })],
        };
        expect(queuedJobFor(d, "b1")).toBeNull();
        expect(queuedJobFor(d, "b9")).toBeNull();
        expect(queuedJobFor(d, undefined)).toBeNull();
        expect(queuedJobFor(null, "b1")).toBeNull();
    });
    it("finds the engine step a run's task waits on, a batch's Verify for each of its tasks", () => {
        const d = {
            slots: 1,
            mode: "auto",
            jobs: [
                job({ id: "run", running: true, runid: "R", taskids: ["t-1"], label: "Verify · One" }),
                job({ id: "v", position: 2, runid: "R", taskids: ["t-3", "t-4"], label: "Verify · Three" }),
                job({ id: "s", position: 1, runid: "R", taskids: ["t-4"], label: "Setup · Four" }),
                job({ id: "other", position: 3, runid: "X", taskids: ["t-3"] }),
                job({ id: "final", position: 4, runid: "R", label: "Final" }),
            ],
        };
        expect(queuedStepFor(d, "R", "t-3")?.id).toBe("v");
        expect(queuedStepFor(d, "R", "t-4")?.id).toBe("s");
        // a running step has stopped waiting; a whole-run step is no task's
        expect(queuedStepFor(d, "R", "t-1")).toBeNull();
        expect(queuedStepFor(d, "R", "t-9")).toBeNull();
        expect(queuedStepFor(d, undefined, "t-3")).toBeNull();
        expect(queuedStepFor(null, "R", "t-3")).toBeNull();
    });
    it("names a queued step by its label's first part", () => {
        expect(stepQueuedState(job({ label: "Verify · The handoff card", position: 2 }))).toBe("verify queued");
        expect(stepQueuedState(job({ label: "Verify · bisect" }))).toBe("verify queued");
        expect(stepQueuedState(job({ label: "Setup · t-2", position: 1 }))).toBe("setup queued");
        expect(stepQueuedState(job({}))).toBe("queued");
    });
    it("names an engine step first in its tag's tooltip, and an agent's command alone", () => {
        expect(queuedTag(job({ label: "Verify · Four", name: "scripts/verify.mjs" }), 0).title).toBe(
            "Verify · Four: scripts/verify.mjs waits its turn in the heavy-job queue"
        );
        expect(queuedTag(job({ name: "task check:ts" }), 0).title).toBe(
            "task check:ts waits its turn in the heavy-job queue"
        );
    });
    it("collects every job a run waits on: its steps and its agents' commands, in serving order", () => {
        const d = {
            slots: 1,
            mode: "auto",
            jobs: [
                job({ id: "a2", position: 3, blockid: "w2" }),
                job({ id: "step", position: 1, runid: "R", label: "Verify · Two" }),
                job({ id: "a1", position: 2, blockid: "w1" }),
                job({ id: "busy", running: true, blockid: "w1" }),
                job({ id: "stranger", position: 4, blockid: "z" }),
                job({ id: "otherrun", position: 5, runid: "X" }),
            ],
        };
        expect(runQueuedJobs(d, "R", new Set(["w1", "w2"])).map((j) => j.id)).toEqual(["step", "a1", "a2"]);
        expect(runQueuedJobs(d, "R", new Set())).toHaveLength(1);
        expect(runQueuedJobs(null, "R", new Set(["w1"]))).toEqual([]);
        expect(runQueuedJobs(d, undefined, new Set(["w1"]))).toEqual([]);
    });
    it("tags a run with its one waiting job, or how many wait, and warns once any waited long", () => {
        expect(runQueuedTag([], 0)).toBeNull();
        const one = runQueuedTag([job({ position: 1, label: "Verify · Four", name: "scripts/verify.mjs" })], 1_000);
        expect(one?.label).toBe("queued #1");
        expect(one?.title).toBe("Verify · Four: scripts/verify.mjs waits its turn in the heavy-job queue");
        expect(one?.warn).toBe(false);
        const two = runQueuedTag(
            [
                job({ id: "a", position: 1, label: "Verify · Four", name: "scripts/verify.mjs", queuedts: 0 }),
                job({ id: "b", position: 2, name: "task check:ts", queuedts: LONG_WAIT_MS }),
            ],
            LONG_WAIT_MS + 1
        );
        expect(two?.label).toBe("2 queued");
        expect(two?.title).toBe(
            "2 of this run's jobs wait their turn in the heavy-job queue: Verify · Four (scripts/verify.mjs), task check:ts"
        );
        expect(two?.warn).toBe(true);
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
    it("words the chip's tooltip in Auto and Off", () => {
        const jobs = [job({ running: true }), job({ id: "j2" })];
        expect(queueTitle({ slots: 1, mode: "auto", jobs })).toBe(
            "Heavy jobs: 1 running, 1 queued (as RAM and CPU allow; set in the popover)"
        );
        expect(queueTitle({ slots: 1, mode: "off", jobs })).toBe(
            "Heavy jobs: 1 running, 1 queued (queue off: each starts at once; set in the popover)"
        );
    });
    it("shows the picker on the slot count, or on Auto or Off", () => {
        expect(paceValue({ slots: 2, mode: "slots", jobs: [] })).toBe("2");
        expect(paceValue({ slots: 2, mode: "auto", jobs: [] })).toBe("auto");
        expect(paceValue({ slots: 2, mode: "off", jobs: [] })).toBe("off");
        // before the first reading: the setting's default
        expect(paceValue(null)).toBe("auto");
    });
    it("writes a slot count with the slots mode, so leaving Auto counts again", () => {
        expect(pacePatch("3")).toEqual({ "jobs:mode": "slots", "jobs:slots": 3 });
        expect(pacePatch("auto")).toEqual({ "jobs:mode": "auto" });
        expect(pacePatch("off")).toEqual({ "jobs:mode": "off" });
    });
    it("reads the pace from settings like the server does", () => {
        expect(paceOfSettings(undefined, undefined)).toBe("auto");
        expect(paceOfSettings("auto", 3)).toBe("auto");
        expect(paceOfSettings("off", 2)).toBe("off");
        expect(paceOfSettings("slots", 3)).toBe("3");
        expect(paceOfSettings("slots", undefined)).toBe("1");
        expect(paceOfSettings("slots", 0)).toBe("1");
        expect(paceOfSettings("slots", 9)).toBe("4");
    });
    it("reads a pause's time left, and none once it has ended", () => {
        const d = { slots: 1, mode: "auto", pauseduntil: 10_000, jobs: [] };
        expect(pauseLeft(d, 4_000)).toBe(6_000);
        expect(pauseLeft(d, 10_000)).toBeNull();
        expect(pauseLeft({ slots: 1, mode: "auto", jobs: [] }, 0)).toBeNull();
        expect(pauseLeft(null, 0)).toBeNull();
    });
    it("formats a pause's time left, rounded up to the minute", () => {
        expect(formatLeft(4 * 3_600_000)).toBe("4h");
        expect(formatLeft(3 * 3_600_000 + 11 * 60_000 + 1)).toBe("3h 12m");
        expect(formatLeft(58 * 60_000)).toBe("58m");
        expect(formatLeft(20_000)).toBe("1m");
    });
    it("shows the chip while paused, even with nothing running, with the time left", () => {
        const paused = { slots: 1, mode: "auto", pauseduntil: 3_600_000, jobs: [] as JobQueueJob[] };
        expect(chipText(paused, 0)).toBe("paused 1h");
        expect(chipText({ ...paused, jobs: [job({ running: true })] }, 0)).toBe("paused 1h · 1 running");
        expect(chipTitle(paused, 0)).toBe(
            "Heavy jobs: queue paused for 1h, every job starts at once (resume in the popover)"
        );
    });
    it("reads the chip as the queue once a pause has ended", () => {
        const d = { slots: 1, mode: "auto", pauseduntil: 1_000, jobs: [job({ running: true })] };
        expect(chipText(d, 2_000)).toBe(chipLabel(d));
        expect(chipTitle(d, 2_000)).toBe(queueTitle(d));
        expect(chipText({ ...d, jobs: [] }, 2_000)).toBeNull();
    });
    it("writes a pause's end, and Resume clears it", () => {
        expect(pausePatch(3_600_000, 1_000)).toEqual({ "jobs:pauseuntil": 3_601_000 });
        expect(pausePatch(null, 1_000)).toEqual({ "jobs:pauseuntil": 0 });
    });
    it("raises the chip for a while after a command ran without a slot, only with the queue empty", () => {
        const d: JobQueueData = {
            slots: 1,
            mode: "auto",
            jobs: [],
            bypassed: 2,
            lastbypass: { name: "task check:ts", ts: 0 },
        };
        expect(chipText(d, 60_000)).toBe("2 ran unqueued");
        expect(bypassOnly(d, 60_000)).toBe(true);
        expect(chipTitle(d, 60_000)).toContain("2 commands ran without a slot");
        expect(chipText(d, RECENT_BYPASS_MS)).toBeNull();
        expect(chipText({ ...d, jobs: [job({ running: true })] }, 60_000)).toBe("1 running");
        expect(chipText({ ...d, bypassed: 0, lastbypass: undefined }, 60_000)).toBeNull();
    });
    it("says how many commands ran without a slot, and the latest", () => {
        expect(bypassLine(null, 0)).toBeNull();
        expect(bypassLine({ slots: 1, mode: "auto", jobs: [] }, 0)).toBeNull();
        expect(
            bypassLine(
                { slots: 1, mode: "auto", jobs: [], bypassed: 1, lastbypass: { name: "task check:ts", ts: 1_000 } },
                241_000
            )
        ).toBe("1 command ran without a slot · last task check:ts, 4m 0s ago");
        expect(
            bypassLine(
                { slots: 1, mode: "auto", jobs: [], bypassed: 3, lastbypass: { name: "npm test", ts: 0 } },
                5_000
            )
        ).toBe("3 commands ran without a slot · last npm test, 5s ago");
    });
    describe("sizeLabel", () => {
        const GB = 2 ** 30;
        it("says measured, with the rule and the last peaks (newest first) in the tooltip", () => {
            expect(sizeLabel(job({ bytes: 2.1 * GB, measured: true, peaks: [1.8 * GB, 1.2 * GB, 0.9 * GB] }))).toEqual({
                text: "2.1 GB",
                tag: "measured",
                title: "2.1 GB: max of the last 3 runs × 1.2 (1.8, 1.2, 0.9 GB)",
                measured: true,
            });
        });
        it("reads the last run, not the last 1 runs, when one peak is kept", () => {
            const label = sizeLabel(job({ bytes: 1.2 * GB, measured: true, peaks: [1 * GB] }));
            expect(label.tag).toBe("measured");
            expect(label.title).toBe("1.2 GB: max of the last run × 1.2 (1 GB)");
        });
        it("says a figure measured in another project, with its own peaks", () => {
            expect(
                sizeLabel(
                    job({
                        bytes: 2.1 * GB,
                        measured: true,
                        elsewhere: true,
                        peaks: [1.8 * GB, 1.5 * GB, 1.2 * GB, 0.9 * GB, 0.5 * GB],
                    })
                )
            ).toEqual({
                text: "2.1 GB",
                tag: "measured",
                title: "2.1 GB: measured in another project, max of its last 5 runs × 1.2 (1.8, 1.5, 1.2, 0.9, 0.5 GB)",
                measured: true,
            });
            expect(sizeLabel(job({ bytes: 1.2 * GB, measured: true, elsewhere: true, peaks: [1 * GB] })).title).toBe(
                "1.2 GB: measured in another project, max of its last run × 1.2 (1 GB)"
            );
        });
        it("says est. for the table's figure, whatever peaks ride along", () => {
            const expected = {
                text: "3 GB",
                tag: "est.",
                title: "3 GB: estimate (not measured yet)",
                measured: false,
            };
            expect(sizeLabel(job({ bytes: 3 * GB }))).toEqual(expected);
            expect(sizeLabel(job({ bytes: 3 * GB, measured: false, peaks: [1 * GB] }))).toEqual(expected);
        });
        it("still says measured when a measured figure carries no peaks", () => {
            const label = sizeLabel(job({ bytes: 2.1 * GB, measured: true }));
            expect(label.measured).toBe(true);
            expect(label.tag).toBe("measured");
            expect(label.title).toBe("2.1 GB: max of the recent runs × 1.2");
        });
    });
});
