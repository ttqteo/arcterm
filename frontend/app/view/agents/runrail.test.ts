// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
    endedLine,
    laneRows,
    questionOrder,
    runElapsedMs,
    runLog,
    runSegments,
    taskFacts,
    thenTask,
    verifyingHeadline,
} from "./runrail";

describe("verifyingHeadline", () => {
    it("reads Verifying in the working tone while finalizing, with the model's next as its tail", () => {
        expect(verifyingHeadline("finalizing", false, "next Final, then the verifier")).toEqual({
            text: "Verifying",
            tone: "text-working",
            tail: "· next Final, then the verifier",
        });
        expect(verifyingHeadline("finalizing", false, "")?.tail).toBe("");
    });

    it("leaves every other status to the line it had", () => {
        for (const status of ["running", "done", "failed", "", undefined]) {
            expect(verifyingHeadline(status, false, "next Final")).toBeUndefined();
        }
    });

    it("yields to a question waiting on the human", () => {
        expect(verifyingHeadline("finalizing", true, "next Final")).toBeUndefined();
    });
});

const MIN = 60_000;
const NOW = 100 * MIN;

function task(id: string, state: string, over: Partial<TaskNode> = {}): TaskNode {
    return { id, label: `do ${id}`, state, ...over };
}

// lanes A: t-1 -> t-3, B: t-2 -> t-4, C: t-5 joining A and B
const dag = {
    tasks: [
        task("t-1", "done", { merged: true }),
        task("t-2", "done", { merged: true }),
        task("t-3", "running", { deps: ["t-1"], firstactivity: NOW - 4 * MIN }),
        task("t-4", "running", { deps: ["t-2"] }),
        task("t-5", "pending", { deps: ["t-3", "t-4"] }),
    ],
} as TaskGroup;

const digest = {
    lanes: [["t-1", "t-3"], ["t-2", "t-4"], ["t-5"]],
    tasks: [{ taskid: "t-4", waitreason: "lead-ask" }],
    report: { commits: [{ taskid: "t-1", commit: "a1b2c3d4e5f6" }] },
} as DagStatusDigest;

describe("laneRows", () => {
    it("names each lane's task in play and where it stands", () => {
        expect(laneRows(dag, digest)).toEqual([
            { key: "A", taskId: "t-3", name: "t-3 · do t-3", hist: "t-1 landed", state: "working", text: "working" },
            { key: "B", taskId: "t-4", name: "t-4 · do t-4", hist: "t-2 landed", state: "lead", text: "lead" },
            {
                key: "C",
                taskId: "t-5",
                name: "t-5 · do t-5",
                hist: "waits on t-3, t-4",
                state: "pending",
                text: "queued",
            },
        ]);
    });

    it("reads a question the human holds as asking you", () => {
        const held = { ...digest, tasks: [{ taskid: "t-4", waitreason: "ask" }] } as DagStatusDigest;
        expect(laneRows(dag, held)[1]).toMatchObject({ state: "asking", text: "asks you" });
    });

    it("shows a finished lane's tip with its landed commit", () => {
        const finished = {
            tasks: [task("t-1", "done", { merged: true }), task("t-2", "done", { merged: true, deps: ["t-1"] })],
        } as TaskGroup;
        const d = { lanes: [["t-1", "t-2"]], report: { commits: [{ taskid: "t-2", commit: "9e04f1aa77" }] } };
        expect(laneRows(finished, d as DagStatusDigest)).toEqual([
            { key: "A", taskId: "t-2", name: "t-2 · do t-2", hist: "9e04f1a", state: "done", text: "landed" },
        ]);
    });

    it("has no rows before the digest lists lanes", () => {
        expect(laneRows(dag, undefined)).toEqual([]);
    });
});

describe("thenTask", () => {
    it("names the first task not started yet", () => {
        expect(thenTask(dag)).toBe("t-5 · do t-5");
        expect(thenTask({ tasks: [task("t-1", "done")] } as TaskGroup)).toBeUndefined();
    });
});

describe("runSegments", () => {
    it("gives each task a slot in plan order", () => {
        const held = { ...digest, tasks: [{ taskid: "t-4", waitreason: "ask" }] } as DagStatusDigest;
        expect(runSegments(dag, held)).toEqual(["done", "done", "working", "asking", "pending"]);
    });
});

describe("taskFacts", () => {
    it("says a running task's lane, what it depends on and how long this attempt has run", () => {
        expect(taskFacts(dag, digest, "t-3", NOW)).toEqual({
            lane: "A",
            laneText: "A · t-1 → t-3",
            depends: "t-1 · landed",
            resultLabel: "Attempt",
            result: "1 · 4m",
            landed: false,
        });
    });

    it("counts a retried task's attempt past its failures", () => {
        const retried = { tasks: [task("t-1", "running", { attempts: 2 })] } as TaskGroup;
        expect(taskFacts(retried, undefined, "t-1", NOW)?.result).toBe("3 · running");
    });

    it("reads a finished task's result as landed with its commit", () => {
        expect(taskFacts(dag, digest, "t-1", NOW)).toMatchObject({
            depends: "none",
            resultLabel: "Result",
            result: "landed a1b2c3d",
            landed: true,
        });
    });

    it("has no facts for a task the dag does not hold", () => {
        expect(taskFacts(dag, digest, "t-9", NOW)).toBeUndefined();
    });
});

describe("run clock and questions", () => {
    it("runs the clock from the dag's start until the run ends, then keeps the settled figure", () => {
        const started = { createdts: NOW - 5 * MIN } as TaskGroup;
        expect(runElapsedMs(started, { next: { kind: "dispatch" } } as DagStatusDigest, NOW)).toBe(5 * MIN);
        const ended = { next: { kind: "terminal" }, durations: { elapsedms: 3 * MIN } } as DagStatusDigest;
        expect(runElapsedMs(started, ended, NOW)).toBe(3 * MIN);
        expect(runElapsedMs(undefined, undefined, NOW)).toBe(0);
    });

    it("puts the questions waiting on you before the lead's, oldest first", () => {
        const ask = (taskid: string, owner: string, ts: number) => ({ taskid, owner, ts }) as DagAskItem;
        const order = questionOrder([ask("t-1", "lead", 1), ask("t-2", "user", 3), ask("t-3", "user", 2)]);
        expect(order.map((a) => a.taskid)).toEqual(["t-3", "t-2", "t-1"]);
    });
});

describe("runLog", () => {
    const ev = (id: string, ts: number, kind: string, detail?: object): RunEvent =>
        ({ id, ts, kind, detail: detail ? JSON.stringify(detail) : undefined }) as RunEvent;

    it("keeps the newest rows first", () => {
        const rows = runLog([ev("a", 1, "dag-done"), ev("b", 3, "dag-done"), ev("c", 2, "dag-done"), ev("d", 0, "x")]);
        expect(rows.map((r) => r.id)).toEqual(["b", "c", "a"]);
    });
});

describe("endedLine", () => {
    it("says what a done task came to and that its session ended", () => {
        const digest = { report: { commits: [{ taskid: "t-1", commit: "a1b2c3d4e5f6" }] } } as DagStatusDigest;
        expect(endedLine(task("t-1", "done", { merged: true }), digest)).toBe(
            "t-1 · do t-1 landed on main as a1b2c3d · session ended"
        );
        expect(endedLine(task("t-2", "done", { merged: true }), undefined)).toBe(
            "t-2 · do t-2 landed on main · session ended"
        );
        expect(endedLine(task("t-3", "done"), digest)).toBe("t-3 · do t-3 done · session ended");
    });
});
