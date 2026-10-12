// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import type { AgentVM } from "./agentsviewmodel";
import {
    buildLeadCard,
    foldOpen,
    isLeadDown,
    leadActivity,
    leadMark,
    mergeWaitTag,
    REVIEW_ACTIONS,
    reviewFindings,
    rowCardId,
    rowKey,
    rowKeyActions,
    runAdjustable,
    runCost,
    runElapsed,
    runFlowing,
    runningCount,
    stopSelector,
    waitTag,
} from "./leadcardmodel";
import type { Lineage, RunInfo } from "./runlineage";

const NOW = 1_000_000;

function task(id: string, state: string, over: Partial<TaskNode> = {}): TaskNode {
    return { id, label: `Task ${id}`, state, ...over } as TaskNode;
}

function runInfo(tasks: TaskNode[], digest?: Partial<DagStatusDigest>): RunInfo {
    return {
        runId: "R",
        channelId: "C",
        title: "Session auth",
        project: "arc",
        dag: {
            oid: "D",
            runid: "R",
            parallelism: 3,
            status: "running",
            tasks,
            workerroute: { runtime: "claude", model: "claude-sonnet-4" },
        } as TaskGroup,
        digest: digest as DagStatusDigest | undefined,
    };
}

const lead = { id: "lead", name: "auth-lead", task: "", state: "working", model: "opus" } as AgentVM;

function input(run: RunInfo, workers: AgentVM[] = [], over: Partial<Parameters<typeof buildLeadCard>[0]> = {}) {
    const roles: Lineage["roles"] = { lead: { kind: "lead", runId: "R" } };
    for (const w of workers) {
        roles[w.id] = { kind: "worker", leadRunId: "R", taskId: w.task };
    }
    return {
        cardId: "lead",
        run,
        lead,
        roster: [lead, ...workers],
        lineage: { roles, runs: { R: run } },
        leadDown: false,
        now: NOW,
        ...over,
    };
}

function ev(kind: string, ts: number, detail?: object): RunEvent {
    return {
        id: `${kind}-${ts}`,
        runid: "R",
        channelid: "C",
        ts,
        kind,
        detail: detail ? JSON.stringify(detail) : undefined,
    };
}

describe("buildLeadCard", () => {
    it("splits tasks into live, waiting and done rows in plan order", () => {
        const w = {
            id: "w2",
            name: "t2",
            task: "t2",
            state: "working",
            activity: "editing store.ts",
            runId: "c2",
        } as AgentVM;
        const run = runInfo(
            [task("t1", "done"), task("t2", "running", { runid: "c2" }), task("t3", "pending", { deps: ["t2"] })],
            {
                lanes: [["t1", "t2"], ["t3"]],
            }
        );
        const vm = buildLeadCard(input(run, [w]));
        expect(vm.done.map((r) => r.taskId)).toEqual(["t1"]);
        expect(vm.rows.map((r) => r.taskId)).toEqual(["t2"]);
        expect(vm.waiting.map((r) => r.taskId)).toEqual(["t3"]);
        expect(vm.rows[0]).toMatchObject({
            key: rowKey("lead", "t2"),
            sub: "t2 · lane A · editing store.ts",
            actions: ["tell"],
            openId: "w2",
        });
        expect(vm.waiting[0].sub).toBe("t3 · waits on t2");
        expect(vm.waiting[0].tag).toBe("after t2");
        expect(vm.waiting[0].waitOn).toBe("deps");
        expect(vm.done[0].openId).toBe("ended:R:t1");
        expect(vm).not.toHaveProperty("segs");
        expect(vm.progress).toEqual({ done: 1, total: 3 });
    });

    // a finished lane that has not landed is not "landed": it waits on the merge, visibly, with how long it has sat
    it("lifts a merge-ready task out of Done and tags it with the gate's age", () => {
        const run = runInfo([task("t1", "done"), task("t2", "done")], {
            tasks: [
                { taskid: "t1", mergestate: "ready", mergegatets: NOW - 34 * 60_000 } as DagTaskDigest,
                { taskid: "t2", mergestate: "merged" } as DagTaskDigest,
            ],
        });
        const vm = buildLeadCard(input(run));
        expect(vm.rows.map((r) => r.taskId)).toEqual(["t1"]);
        expect(vm.rows[0]).toMatchObject({ tag: "merge waiting 34m", tone: "wait", needsYou: false, actions: [] });
        expect(vm.rows[0].sub).toBe("t1 · merge ready");
        expect(vm.done.map((r) => r.taskId)).toEqual(["t2"]);
        expect(vm.done[0].sub).toBe("t2 · landed");
    });

    it("keeps a done task landed when the digest has not loaded or the dag needs no merge", () => {
        expect(buildLeadCard(input(runInfo([task("t1", "done")]))).done[0].sub).toBe("t1 · landed");
        const unmerged = runInfo([task("t1", "done")], {
            tasks: [{ taskid: "t1", mergestate: "not-required" } as DagTaskDigest],
        });
        expect(buildLeadCard(input(unmerged)).done[0].sub).toBe("t1 · landed");
    });

    it("answers a worker's question you hold inline and counts it", () => {
        const w = {
            id: "w2",
            name: "t2",
            task: "t2",
            state: "asking",
            runId: "c2",
            ask: { questions: [{ question: "Keep the cookie?" }] },
        } as AgentVM;
        const run = runInfo([task("t2", "running", { runid: "c2" })], {
            tasks: [{ taskid: "t2", waitreason: "ask" } as DagTaskDigest],
        });
        const vm = buildLeadCard(input(run, [w]));
        expect(vm.rows[0]).toMatchObject({ inline: "ask", needsYou: true, tone: "ask", tag: "asking", worker: w });
        expect(vm.askCount).toBe(1);
        expect(vm.needsYou).toBe(true);
    });

    it("lead-held ask: not yours, offers Take over", () => {
        const w = {
            id: "w2",
            name: "t2",
            task: "t2",
            state: "asking",
            runId: "c2",
            ask: { questions: [{ question: "?" }] },
        } as AgentVM;
        const run = runInfo([task("t2", "running", { runid: "c2" })], {
            tasks: [{ taskid: "t2", waitreason: "lead-ask", askdeadline: NOW + 4 * 60_000 } as DagTaskDigest],
        });
        const vm = buildLeadCard(input(run, [w]));
        expect(vm.rows[0]).toMatchObject({ needsYou: false, toLead: true, tag: "4m left", actions: ["takeover"] });
        expect(vm.rows[0].inline).toBeUndefined();
        expect(vm.askCount).toBe(0);
    });

    it("lead-held ask with no deadline: to the lead, with no tag", () => {
        const w = { id: "w2", name: "t2", task: "t2", state: "asking", runId: "c2" } as AgentVM;
        const run = runInfo([task("t2", "running", { runid: "c2" })], {
            tasks: [{ taskid: "t2", waitreason: "lead-ask" } as DagTaskDigest],
        });
        const row = buildLeadCard(input(run, [w])).rows[0];
        expect(row.toLead).toBe(true);
        expect(row.tag).toBeUndefined();
    });

    it("marks a landed run complete", () => {
        const r = runInfo([task("t1", "done")]);
        const landed = {
            ...r,
            status: "done",
            land: { state: "landed" } as RunLand,
            dag: { ...r.dag!, status: "done" },
        };
        expect(buildLeadCard(input(landed)).complete).toBe(true);
        expect(buildLeadCard(input(runInfo([task("t1", "running")]))).complete).toBe(false);
    });

    it("a failed review is the lead's to judge unless the lead is down", () => {
        const run = runInfo([task("t7", "review-failed")]);
        const judged = buildLeadCard(input(run));
        expect(judged.rows[0]).toMatchObject({ inline: "review", needsYou: false, tag: "lead judging", tone: "err" });
        const down = buildLeadCard(input(run, [], { leadDown: true }));
        expect(down.rows[0]).toMatchObject({ needsYou: true, tag: "needs you" });
        expect(down.askCount).toBe(1);
    });

    it("a stalled task offers Retry and Skip only when nobody else judges it", () => {
        const run = runInfo([task("t9", "stalled")]);
        expect(buildLeadCard(input(run)).rows[0].actions).toEqual([]);
        expect(buildLeadCard(input(run, [], { lead: undefined, cardId: "run:R" })).rows[0].actions).toEqual([
            "retry",
            "skip",
        ]);
    });

    it("a blocked merge or failed Verify offers Continue only when nobody else fixes it", () => {
        for (const state of ["blocked-merge", "verify-failed"]) {
            const run = runInfo([task("t5", state)]);
            expect(buildLeadCard(input(run)).rows[0]).toMatchObject({ needsYou: false, actions: [] });
            const down = buildLeadCard(input(run, [], { leadDown: true })).rows[0];
            expect(down).toMatchObject({ needsYou: true, tag: "needs you", actions: ["resolve"] });
        }
    });

    it("reads a slot wait from the digest", () => {
        const run = runInfo([task("t4", "pending")], {
            tasks: [{ taskid: "t4", waitreason: "parallelism" } as DagTaskDigest],
        });
        expect(buildLeadCard(input(run)).waiting[0].sub).toBe("t4 · waiting for a slot");
        expect(buildLeadCard(input(run)).waiting[0].waitOn).toBe("slot");
    });

    it("ages a live row from its first activity and a landed row by how long it ran", () => {
        const run = runInfo(
            [task("t1", "done"), task("t2", "running", { firstactivity: NOW - 8 * 60_000 }), task("t3", "running")],
            { durations: { elapsedms: 0, tasks: [{ taskid: "t1", runms: 12 * 60_000 }] } }
        );
        const vm = buildLeadCard(input(run));
        expect(vm.done[0].age).toBe("12m");
        expect(vm.rows.map((r) => r.age)).toEqual(["8m", undefined]);
    });

    // a lead that did the goal itself never submits a dag; once it lands the card is complete, not planning
    it("reads a finished run with no dag as complete, not planning", () => {
        const done: RunInfo = { runId: "R", channelId: "C", title: "t", project: "arc", status: "done" };
        const vm = buildLeadCard(input({ ...done, land: { state: "landed" } as RunLand }));
        expect(vm).toMatchObject({ planning: false, finished: true, complete: true, activity: "Landed" });
    });

    it("is planning with no dag, and names lead and worker models in the settings line", () => {
        const planning = buildLeadCard(input({ runId: "R", channelId: "C", title: "t", project: "arc" }));
        expect(planning.planning).toBe(true);
        expect(planning.rows).toEqual([]);
        const vm = buildLeadCard(input(runInfo([])));
        expect(vm.settings).toBe("lead opus · workers sonnet 4 · 3 at a time");
        expect(buildLeadCard(input(runInfo([]), [], { lead: undefined })).settings).toBe(
            "no lead · workers sonnet 4 · 3 at a time"
        );
    });

    it("names the branch a run lands on when it has its own", () => {
        const run = { ...runInfo([]), runId: "0123456789abcdef", landPath: "/p/.waveterm/worktrees/0123456789abcdef" };
        expect(buildLeadCard(input(run)).settings).toBe(
            "lead opus · workers sonnet 4 · 3 at a time · lands on wave/01234567"
        );
        // the label is shortened; the full name is what a human types into git
        expect(buildLeadCard(input(run)).settingsTitle).toBe("lands on wave/0123456789abcdef");
        expect(buildLeadCard(input(runInfo([]))).settingsTitle).toBeUndefined();
    });
});

describe("isLeadDown", () => {
    it("is down after a wake failure until a lead launches again", () => {
        expect(isLeadDown([])).toBe(false);
        expect(isLeadDown([ev("lead-wake-failed", 10)])).toBe(true);
        expect(isLeadDown([ev("lead-wake-failed", 10), ev("lead-launched", 20)])).toBe(false);
        expect(isLeadDown([ev("lead-launched", 5), ev("lead-wake-failed", 10)])).toBe(true);
    });
});

describe("reviewFindings", () => {
    const failed = (ts: number, taskid: string, round: number, note: string) =>
        ev("task-review-failed", ts, { taskid, note, round, final: round >= 2 });

    it("lists the current attempt's rounds oldest first", () => {
        expect(
            reviewFindings([failed(1, "t7", 1, "no logout event"), failed(2, "t7", 2, "raw id logged")], "t7")
        ).toEqual([
            { round: 1, note: "no logout event" },
            { round: 2, note: "raw id logged" },
        ]);
    });
    it("retry: drops rounds from before the retry reset the count", () => {
        const events = [failed(1, "t7", 1, "old a"), failed(2, "t7", 2, "old b"), failed(3, "t7", 1, "new a")];
        expect(reviewFindings(events, "t7")).toEqual([{ round: 1, note: "new a" }]);
    });
    it("keeps rounds past the cap after a send-back", () => {
        const events = [failed(1, "t7", 1, "a"), failed(2, "t7", 2, "b"), failed(3, "t7", 3, "c")];
        expect(reviewFindings(events, "t7").map((f) => f.round)).toEqual([1, 2, 3]);
    });
    it("a reviewer that fails to finish reuses the round before it; both rounds stay", () => {
        const events = [
            failed(1, "t7", 1, "no logout event"),
            ev("task-review-failed", 2, { taskid: "t7", note: "reviewer edited the tree", round: 1, final: true }),
        ];
        expect(reviewFindings(events, "t7")).toEqual([
            { round: 1, note: "no logout event" },
            { round: 2, note: "reviewer edited the tree" },
        ]);
    });
    it("a reviewer that fails on the first review is round 1", () => {
        const events = [ev("task-review-failed", 1, { taskid: "t7", note: "could not start", round: 0, final: true })];
        expect(reviewFindings(events, "t7")).toEqual([{ round: 1, note: "could not start" }]);
    });
    it("ignores other tasks, other kinds and unreadable details", () => {
        const events = [
            failed(1, "t1", 1, "x"),
            ev("task-review-passed", 2, { taskid: "t7" }),
            { ...ev("task-review-failed", 3), detail: "{not json" },
        ];
        expect(reviewFindings(events, "t7")).toEqual([]);
    });
});

describe("rowCardId", () => {
    it("reads the card back out of a row key, even a leadless card's", () => {
        expect(rowCardId(rowKey("lead", "t2"))).toBe("lead");
        expect(rowCardId(rowKey("run:R", "t-3"))).toBe("run:R");
    });
    it("returns a card id unchanged", () => {
        expect(rowCardId("lead")).toBe("lead");
    });
});

describe("foldOpen", () => {
    const rows = [{ key: rowKey("lead", "t1") }, { key: rowKey("lead", "t2") }];
    it("opens a closed fold while the cursor is on one of its rows", () => {
        expect(foldOpen(false, rows, rowKey("lead", "t2"))).toBe(true);
        expect(foldOpen(false, rows, "lead")).toBe(false);
        expect(foldOpen(false, rows, undefined)).toBe(false);
    });
    it("keeps a fold the user opened", () => {
        expect(foldOpen(true, rows, "lead")).toBe(true);
    });
});

describe("rowKeyActions", () => {
    it("numbers a failed review's choices as the card does", () => {
        expect(rowKeyActions({ inline: "review", actions: [] })).toEqual(REVIEW_ACTIONS.map(([a]) => a));
        expect(REVIEW_ACTIONS.map(([a]) => a)).toEqual(["approve", "sendback", "retry", "skip"]);
    });
    it("numbers a live row's own actions, Tell included: its key opens the input", () => {
        expect(rowKeyActions({ actions: ["retry", "skip"] })).toEqual(["retry", "skip"]);
        expect(rowKeyActions({ actions: ["tell"] })).toEqual(["tell"]);
    });
});

describe("waitTag", () => {
    it("names the one task a row waits on, and counts several", () => {
        expect(waitTag(["t-1"], false)).toBe("after t-1");
        expect(waitTag(["t-1", "t-2", "t-3", "t-4"], false)).toBe("after 4 tasks");
    });
    it("says a row waits for a slot, or is queued", () => {
        expect(waitTag([], true)).toBe("for a slot");
        expect(waitTag([], false)).toBe("queued");
    });
});

describe("mergeWaitTag", () => {
    it("ages a gate from its clock", () => {
        expect(mergeWaitTag(NOW - 34 * 60_000, NOW)).toBe("merge waiting 34m");
        expect(mergeWaitTag(NOW - 65 * 60_000, NOW)).toBe("merge waiting 1h5m");
    });

    // pruned history leaves no clock; a gate stamped ahead of this clock (skew) must not read as a negative age
    it("shows no age without a clock or before it", () => {
        expect(mergeWaitTag(undefined, NOW)).toBe("merge waiting");
        expect(mergeWaitTag(0, NOW)).toBe("merge waiting");
        expect(mergeWaitTag(NOW + 5_000, NOW)).toBe("merge waiting");
    });

    // formatElapsed floors to whole seconds, so a gate opened this second would read "0s"
    it("shows no age under a second", () => {
        expect(mergeWaitTag(NOW - 500, NOW)).toBe("merge waiting");
        expect(mergeWaitTag(NOW - 1_000, NOW)).toBe("merge waiting 1s");
    });
});

describe("runningCount", () => {
    // the cancel confirm stops running tasks; a merge gate's worker has finished and the engine lands it
    it("leaves the merge gate out of the running tasks", () => {
        const run = runInfo([task("t1", "done"), task("t2", "running")], {
            tasks: [{ taskid: "t1", mergestate: "ready", mergegatets: NOW - 60_000 } as DagTaskDigest],
        });
        const vm = buildLeadCard(input(run));
        expect(vm.rows).toHaveLength(2);
        expect(runningCount(vm.rows)).toBe(1);
    });
});

describe("runElapsed", () => {
    it("counts a live run from its dag's creation", () => {
        const run = runInfo([task("t1", "running")]);
        run.dag!.createdts = NOW - 9 * 60_000;
        expect(runElapsed(run, NOW)).toBe("9m");
    });
    it("takes a finished run's time from the digest, which knows when it ended", () => {
        const run = runInfo([task("t1", "done")], { durations: { elapsedms: 42 * 60_000 } });
        run.dag!.status = "done";
        run.dag!.createdts = NOW - 90 * 60_000;
        expect(runElapsed(run, NOW)).toBe("42m");
    });
    it("is empty when the run has no dag yet", () => {
        expect(runElapsed({ runId: "R", channelId: "C", title: "t", project: "arc" }, NOW)).toBe("");
    });
});

describe("stopSelector", () => {
    it("finds a task row by its row key and a card by its agent id", () => {
        expect(stopSelector("row:L:t1")).toBe('[data-row-key="row:L:t1"]');
        expect(stopSelector("a1")).toBe('[data-agent-id="a1"]');
    });
});

describe("leadActivity", () => {
    const run = (status = "running", digest?: Partial<DagStatusDigest>) => {
        const r = runInfo([task("t1", "running"), task("t2", "running"), task("t3", "pending")], digest);
        r.dag!.status = status;
        return r;
    };
    it("says a lead at its prompt stands by while the engine runs its tasks", () => {
        const idle = { ...lead, state: "idle", atPrompt: true } as AgentVM;
        expect(leadActivity(run(), idle, false)).toBe("standing by · engine running 2 lanes");
        expect(leadActivity(run("running", { counts: { running: 1 } as DagStatusCounts }), idle, false)).toBe(
            "standing by · engine running 1 lane"
        );
    });
    it("shows what a busy lead is doing", () => {
        expect(leadActivity(run(), { ...lead, activity: "judging t-2" } as AgentVM, false)).toBe("judging t-2");
    });
    it("says who holds the run's judgment when there is no lead or it is down", () => {
        expect(leadActivity(run(), undefined, false)).toBe(
            "engine running · a lead starts at the first judgment event"
        );
        expect(leadActivity(run(), lead, true)).toBe("lead down · its events come to you");
    });
    it("names a finished run's end", () => {
        const done = { ...run("done"), status: "done" };
        expect(leadActivity(done, { ...lead, atPrompt: true } as AgentVM, false)).toBe("Complete");
    });
    it("says the lead is wrapping up while the run itself is still open", () => {
        const open = { ...run("done"), status: "executing" };
        expect(leadActivity(open, { ...lead, atPrompt: true } as AgentVM, false)).toBe("Wrapping up · lead");
    });
});

describe("leadMark", () => {
    const leadOf = (over: Partial<AgentVM> = {}) => ({ id: "l", name: "lead", state: "working", ...over }) as AgentVM;
    // runmodel.test.ts builds runComplete's cases the same way: run status + land + dag status
    const ended = (status: string, dagStatus: string, land?: RunLand): RunInfo => {
        const r = runInfo([task("t-1", "done")]);
        return { ...r, status, land, dag: { ...r.dag!, status: dagStatus } };
    };
    const MUTED = { tone: "muted", pulse: false };
    it("is green and still only when the run is complete", () => {
        expect(leadMark(ended("done", "done", { state: "landed" } as RunLand), leadOf({ state: "idle" }))).toEqual({
            tone: "success",
            pulse: false,
        });
        expect(leadMark(ended("done", "done"), leadOf({ state: "working" }))).toEqual({
            tone: "success",
            pulse: false,
        });
    });
    it("is green for a run its lead finished without a dag", () => {
        const dagless: RunInfo = { runId: "R", channelId: "C", title: "t", project: "arc", status: "done" };
        expect(leadMark({ ...dagless, land: { state: "landed" } as RunLand }, leadOf({ state: "idle" }))).toEqual({
            tone: "success",
            pulse: false,
        });
    });
    it("is not green for a cancelled run, a lead wrapping up, or a held land", () => {
        expect(leadMark(ended("cancelled", "cancelled"), leadOf({ state: "idle" }))).toEqual(MUTED);
        expect(leadMark(ended("finalizing", "done"), leadOf({ state: "working" }))).toEqual({
            tone: "accent",
            pulse: true,
        });
        expect(leadMark(ended("done", "done", { state: "held" } as RunLand), leadOf({ state: "idle" }))).toEqual(MUTED);
    });
    it("is accent and still while the engine works without its lead", () => {
        const STILL_ACCENT = { tone: "accent", pulse: false };
        expect(leadMark(runInfo([task("t-1", "running")]), undefined)).toEqual(STILL_ACCENT);
        expect(leadMark(runInfo([task("t-1", "reviewing")]), leadOf({ atPrompt: true }))).toEqual(STILL_ACCENT);
    });
    it("is muted when neither the lead nor the engine works", () => {
        expect(leadMark(runInfo([task("t-1", "pending")]), undefined)).toEqual(MUTED);
        expect(leadMark(runInfo([task("t-1", "failed")]), leadOf({ atPrompt: true }))).toEqual(MUTED);
    });
    it("pulses accent while working and warning while asking", () => {
        const run = runInfo([task("t-1", "running")]);
        expect(leadMark(run, leadOf({ state: "working" }))).toEqual({ tone: "accent", pulse: true });
        expect(leadMark(run, leadOf({ state: "asking" }))).toEqual({ tone: "warning", pulse: true });
        expect(leadMark(run, leadOf({ state: "idle" }))).toEqual(MUTED);
    });
});

describe("runFlowing", () => {
    const leadOf = (over: Partial<AgentVM> = {}) => ({ id: "l", name: "lead", state: "working", ...over }) as AgentVM;
    it("flows while the engine works, with the lead standing by or absent", () => {
        expect(runFlowing(runInfo([task("t-1", "running")]), undefined)).toBe(true);
        expect(runFlowing(runInfo([task("t-1", "verifying")]), leadOf({ atPrompt: true }))).toBe(true);
    });
    it("flows while the lead itself works", () => {
        expect(runFlowing(runInfo([task("t-1", "pending")]), leadOf())).toBe(true);
    });
    it("is still when neither works", () => {
        expect(runFlowing(runInfo([task("t-1", "pending")]), leadOf({ atPrompt: true }))).toBe(false);
        expect(runFlowing(runInfo([task("t-1", "pending")]), leadOf({ state: "asking" }))).toBe(false);
        expect(runFlowing(runInfo([task("t-1", "pending")]), undefined)).toBe(false);
    });
    it("is still once the run has finished", () => {
        const r = runInfo([task("t-1", "done")]);
        expect(runFlowing({ ...r, status: "done", dag: { ...r.dag!, status: "done" } }, leadOf())).toBe(false);
    });
});

describe("lead card bar", () => {
    it("draws nothing before a plan exists", () => {
        expect(buildLeadCard(input({ ...runInfo([]), dag: undefined })).bar).toBeUndefined();
    });
    it("draws one segment per task, labelled with the done count", () => {
        const vm = buildLeadCard(input(runInfo([task("t1", "done"), task("t2", "running"), task("t3", "pending")])));
        expect(vm.bar).toEqual({
            strip: { kind: "segments", states: ["done", "working", "pending"] },
            label: "1 of 3 tasks done",
        });
    });
    it("becomes one done/total bar past STRIP_MAX tasks", () => {
        const tasks = Array.from({ length: 30 }, (_, i) => task(`t${i}`, i < 12 ? "done" : "pending"));
        const vm = buildLeadCard(input(runInfo(tasks)));
        expect(vm.bar).toEqual({ strip: { kind: "bar", done: 12, total: 30 }, label: "12 of 30 tasks done" });
    });
});

describe("runCost", () => {
    it("joins the workers' time and tokens, leaving out what is unknown", () => {
        expect(runCost(6_120_000, 2_100_000)).toBe("1h42m worker · 2.1M tokens");
        expect(runCost(1_440_000, undefined)).toBe("24m worker");
        expect(runCost(undefined, 410_000)).toBe("410k tokens");
        expect(runCost(0, 0)).toBe("");
    });
});

describe("runAdjustable", () => {
    it("adjusts an engine run until it finishes", () => {
        expect(runAdjustable(runInfo([]))).toBe(true);
        expect(runAdjustable({ ...runInfo([]), dag: { ...runInfo([]).dag, status: "done" } })).toBe(false);
        expect(runAdjustable({ ...runInfo([]), dag: undefined })).toBe(false);
    });
});
