// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import type { AgentVM } from "@/app/view/agents/agentsviewmodel";
import { taskStripLabel } from "@/app/view/agents/runstrip";
import { describe, expect, it } from "vitest";
import type { DigestState } from "../orchestrate/dagdigest";
import type { TaskWorkerView } from "../orchestrate/taskcorrelate";
import {
    configLine,
    configNote,
    doneBody,
    doneBodyHasDiff,
    finalStageEndable,
    launcherReading,
    orderedTasks,
    runGraphRef,
    sheetLead,
    sheetRoute,
    sheetStatus,
    taskRow,
    taskSectionMeta,
    type SheetRead,
    type SheetRowInput,
} from "./runsheetmodel";

const NOW = 10_000_000;
const MIN = 60_000;

function run(over: Partial<Run> = {}): Run {
    return {
        oid: "r1",
        version: 1,
        id: "3457abcd",
        goal: "fix every finding",
        runtime: "pi",
        model: "deepseek-v4-flash",
        mode: "orchestrator",
        orchestration: "engine",
        status: "executing",
        phases: [],
        workspaceid: "ws",
        projectpath: "/repo",
        createdts: NOW - 18 * MIN,
        dagoref: "d1",
        meta: {},
        ...over,
    } as Run;
}

function group(states: string[], over: Partial<TaskGroup> = {}): TaskGroup {
    return {
        oid: "d1",
        version: 3,
        id: "d1",
        runid: "3457abcd",
        channelid: "c1",
        parallelism: 2,
        tasks: states.map((state, i) => ({ id: `t-${i + 1}`, label: `task ${i + 1}`, state })),
        status: "running",
        failures: 0,
        createdts: 1,
        updatedts: 1,
        ...over,
    } as TaskGroup;
}

function digest(over: Partial<DagStatusDigest> = {}, counts: Partial<DagStatusCounts> = {}): DagStatusDigest {
    return {
        dagversion: 3,
        health: "healthy",
        counts: {
            total: 4,
            done: 2,
            running: 2,
            stalled: 0,
            dependencywaiting: 1,
            attention: 0,
            recoveredretry: 0,
            mergeready: 0,
            ...counts,
        },
        next: { kind: "parallelism-wait", blockingtaskids: ["t-1", "t-2"] },
        tasks: [],
        durations: { elapsedms: 18 * MIN },
        report: { workerms: 31 * MIN, answered: 0, forwarded: 0 },
        shape: { tasks: 4, lanes: 4, longestchain: 1 },
        ...over,
    };
}

function fresh(d: DagStatusDigest, over: Partial<DigestState> = {}): DigestState {
    return { digest: d, loading: false, stale: false, lastUpdatedTs: NOW - 3_000, ...over };
}

function read(over: Partial<SheetRead> = {}): SheetRead {
    return {
        run: run(),
        nowMs: NOW,
        dag: {
            digest: fresh(digest()),
            group: group(["running", "running", "done", "done"]),
            groupRead: "ready",
        },
        userAsks: [],
        workerAsking: false,
        survivors: 0,
        ...over,
    };
}

function ask(over: Partial<DagAskItem> = {}): DagAskItem {
    return {
        taskid: "t-1",
        askid: "a1",
        owner: "user",
        questions: [],
        blockoref: "block:x",
        ts: NOW - 40_000,
        ...over,
    };
}

describe("sheetRoute", () => {
    it("draws engine orchestrators and quick runs", () => {
        expect(sheetRoute(run())).toBe("sheet");
        expect(sheetRoute(run({ mode: "quick", dagoref: "" }))).toBe("sheet");
        expect(sheetRoute(run({ mode: "" }))).toBe("sheet");
    });

    // slice 5c deleted these shapes; their stored runs keep the body that knows how to draw them
    it("leaves runs stored before slice 5c to the legacy body", () => {
        expect(sheetRoute(run({ mode: "pipeline" }))).toBe("legacy");
        expect(sheetRoute(run({ orchestration: "adaptive" }))).toBe("legacy");
        expect(sheetRoute(run({ orchestration: "", runtime: "claude" }))).toBe("legacy");
        expect(sheetRoute(run({ status: "awaiting-review" }))).toBe("legacy");
        expect(sheetRoute(run({ plangatepending: true }))).toBe("legacy");
    });
});

describe("runGraphRef", () => {
    it("reads the graph only from the orchestrator that owns it", () => {
        expect(runGraphRef(run())).toBe("d1");
        expect(runGraphRef(run({ dagoref: "" }))).toBeNull();
        // a task's worker run carries its parent's dagoref
        expect(runGraphRef(run({ mode: "quick" }))).toBeNull();
    });
});

describe("sheetStatus", () => {
    // a lead the app restart stopped before it submitted a plan (run 8b822a9b): it sat Blocked with an
    // elapsed time that kept counting, a "writes the plan first" box, and no way forward but Cancel
    const stoppedLead = (over: Partial<Run> = {}) =>
        run({
            status: "blocked",
            dagoref: "",
            runtime: "claude",
            sessionid: "s-1",
            phases: [{ kind: "orchestrate", state: "failed", donets: NOW - 10 * MIN, workerorefs: ["tab:t1"] }],
            ...over,
        } as Partial<Run>);

    it("dates a blocked run by when it stopped, and offers to resume a lead that can be", () => {
        const s = sheetStatus(read({ run: stoppedLead(), dag: null }));
        expect(s.verb).toBe("Blocked");
        expect(s.sub).toBe("the lead stopped before it submitted a plan");
        expect(s.meta.map((m) => m.text)).toEqual(["ran 8m", "stopped 10m ago"]);
        expect(s.next).toBe("resume the lead in its own session to pick up where it stopped, or cancel the run");
    });

    it("says only cancel is left when a blocked run cannot be resumed", () => {
        const s = sheetStatus(read({ run: stoppedLead({ sessionid: "" }), dag: null }));
        expect(s.next).toBe("cancel the run and start a new one: this one cannot be resumed");
    });

    it("says no plan was submitted for a blocked lead with no graph", () => {
        expect(taskSectionMeta(stoppedLead(), undefined)).toBe("none — no plan was submitted");
    });

    it("reads a healthy run as executing, with the meter and next line from the same read", () => {
        const s = sheetStatus(read());
        expect(s.verb).toBe("Executing");
        expect(s.sub).toBe("2 of 4 tasks done, 2 workers live");
        expect(s.meter).toEqual({ kind: "strip" });
        expect(s.next).toBe("waiting for a slot — task 1, task 2 still running");
        expect(s.meta.map((m) => m.text)).toEqual(["18m elapsed", "workers 31m", "updated 3s ago"]);
    });

    // the contradiction that started the redesign: every task finished, the run not yet
    it("says Landing when the graph is done and the run is still executing", () => {
        const s = sheetStatus(
            read({
                dag: {
                    digest: fresh(
                        digest(
                            { health: "done", next: { kind: "terminal", terminalstatus: "done" } },
                            { done: 4, running: 0 }
                        )
                    ),
                    group: group(["done", "done", "done", "done"], { status: "done" }),
                    groupRead: "ready",
                },
            })
        );
        expect(s.verb).toBe("Landing");
        expect(s.meter).toEqual({ kind: "strip" });
        expect(s.next).not.toMatch(/finished/);
    });

    it("counts a skipped task as finished, so Landing never sits over a strip one short", () => {
        const g = group(["done", "skipped", "done", "done"], { status: "done" });
        const s = sheetStatus(
            read({
                dag: {
                    digest: fresh(
                        digest({ next: { kind: "terminal", terminalstatus: "done" } }, { done: 3, running: 0 })
                    ),
                    group: g,
                    groupRead: "ready",
                },
            })
        );
        expect(s.verb).toBe("Landing");
        expect(s.meter).toEqual({ kind: "strip" });
        expect(taskStripLabel(g, undefined)).toBe("4 of 4 tasks done");
    });

    it("draws the strip for a finished or cancelled run with a graph, and no bar without one", () => {
        const dag = { digest: fresh(digest()), group: group(["done", "cancelled"]), groupRead: "ready" as const };
        expect(sheetStatus(read({ run: run({ status: "done" }), dag })).meter).toEqual({ kind: "strip" });
        expect(sheetStatus(read({ run: run({ status: "cancelled" }), dag })).meter).toEqual({ kind: "strip" });
        expect(sheetStatus(read({ run: run({ status: "cancelled" }), dag: null })).meter).toBeNull();
    });

    it("waits on you for a question that is yours, naming the task that asked", () => {
        const s = sheetStatus(read({ userAsks: [ask()] }));
        expect(s.verb).toBe("Waiting on you");
        expect(s.sub).toBe("task 1's worker asked a question 40s ago");
        expect(s.tone).toBe("warning");
    });

    // a lead-held question never reaches userAsks; the digest's lead-action next line is what reports it
    it("does not wait on you while the lead holds the question", () => {
        const s = sheetStatus(
            read({
                dag: {
                    digest: fresh(digest({ next: { kind: "lead-action", taskids: ["t-1"], actions: ["answer"] } })),
                    group: group(["running", "running", "done", "done"]),
                    groupRead: "ready",
                },
            })
        );
        expect(s.verb).toBe("Executing");
        expect(s.next).toMatch(/waiting on the lead/);
    });

    it("keeps executing while other work runs, and names how many tasks need you", () => {
        const s = sheetStatus(
            read({
                dag: {
                    digest: fresh(
                        digest(
                            {
                                health: "needs-you",
                                next: { kind: "human-action", taskids: ["t-1", "t-2"], actions: ["retry", "skip"] },
                            },
                            { attention: 2, mergeready: 1, running: 1 }
                        )
                    ),
                    group: group(["stalled", "blocked-merge", "done", "running"]),
                    groupRead: "ready",
                },
            })
        );
        expect(s.verb).toBe("Executing");
        expect(s.sub).toBe("1 of 4 done · 2 tasks need you");
        expect(s.meta.map((m) => m.text)).toContain("attention 2");
        expect(s.meta.map((m) => m.text)).toContain("merge 1");
    });

    it("waits on you when a decision is all that is left", () => {
        const s = sheetStatus(
            read({
                dag: {
                    digest: fresh(
                        digest({ next: { kind: "human-action", taskids: ["t-1"] } }, { attention: 1, running: 0 })
                    ),
                    group: group(["failed", "done", "done", "done"]),
                    groupRead: "ready",
                },
            })
        );
        expect(s.verb).toBe("Waiting on you");
        expect(s.sub).toBe("1 task needs you; nothing else is running");
    });

    it("says cleanup failed, not waiting on you, when only worktrees are left", () => {
        const s = sheetStatus(
            read({
                dag: {
                    digest: fresh(
                        digest(
                            {
                                health: "needs-you",
                                next: { kind: "human-action", taskids: ["t-2"], actions: ["retry-cleanup"] },
                                tasks: [{ taskid: "t-2", humanactions: ["retry-cleanup"] } as DagTaskDigest],
                            },
                            { attention: 1, running: 0 }
                        )
                    ),
                    group: group(["done", "done", "done", "done"]),
                    groupRead: "ready",
                },
            })
        );
        expect(s.verb).toBe("Cleanup failed");
        expect(s.sub).toBe("1 worktree could not be removed");
    });

    it("says the read failed, dates the held figures, and offers the retry", () => {
        const s = sheetStatus(
            read({
                dag: {
                    digest: fresh(digest(), { stale: true, error: "boom", lastUpdatedTs: NOW - 2 * MIN }),
                    group: group(["done", "done", "done", "running"]),
                    groupRead: "ready",
                },
            })
        );
        expect(s.verb).toBe("Status is stale");
        expect(s.sub).toBe("the last status read failed; these figures are 2m old");
        // the digest's own count, not the live group's three, and no per-task colours: the figures are old
        expect(s.meter).toEqual({ kind: "stale", done: 2, total: 4 });
        expect(s.retry).toBe(true);
        expect(s.next).toMatch(/^unknown/);
    });

    it("says refreshing rather than a fresh update while the next digest loads", () => {
        const s = sheetStatus(
            read({
                dag: {
                    digest: fresh(digest(), { stale: true, loading: true }),
                    group: group(["running"]),
                    groupRead: "ready",
                },
            })
        );
        expect(s.verb).toBe("Executing");
        expect(s.meta.map((m) => m.text)).toContain("refreshing");
    });

    it("refuses to guess when the task graph cannot be read", () => {
        for (const groupRead of ["error", "missing"] as const) {
            const s = sheetStatus(read({ dag: { digest: { loading: false, stale: false }, group: null, groupRead } }));
            expect(s.sub).toBe("the run is live, but its task graph could not be read");
            expect(s.meter).toBeNull();
            expect(s.retry).toBe(false);
        }
        const failedDigest = sheetStatus(
            read({
                dag: {
                    digest: { loading: false, stale: false, error: "boom" },
                    group: group(["running"]),
                    groupRead: "ready",
                },
            })
        );
        expect(failedDigest.meta.map((m) => m.text)).toContain("dag unavailable");
        expect(failedDigest.retry).toBe(true);
    });

    it("reads the graph without claiming health while the first digest loads", () => {
        const s = sheetStatus(
            read({ dag: { digest: { loading: true, stale: false }, group: null, groupRead: "loading" } })
        );
        expect(s.sub).toBe("reading the task graph…");
        expect(s.meter).toBeNull();
        expect(s.next).toBeNull();
    });

    it("plans until the lead submits, and names the lead when it asks", () => {
        const planning = sheetStatus(read({ run: run({ status: "planning", dagoref: "" }), dag: null }));
        expect(planning.verb).toBe("Planning");
        expect(planning.meta.map((m) => m.text)).toEqual(["18m elapsed", "no plan yet"]);
        const asking = sheetStatus(
            read({ run: run({ status: "planning", dagoref: "" }), dag: null, workerAsking: true })
        );
        expect(asking.verb).toBe("Waiting on you");
        expect(asking.sub).toBe("the lead asked you a question");
    });

    it("reads a quick run as one worker with no next line", () => {
        const s = sheetStatus(read({ run: run({ mode: "quick", dagoref: "", createdts: NOW - 6 * MIN }), dag: null }));
        expect(s.verb).toBe("Executing");
        expect(s.sub).toBe("one worker, no plan");
        expect(s.next).toBeNull();
        expect(s.meta.map((m) => m.text)).toEqual(["6m elapsed", "1 worker"]);
    });

    it("says what a done run delivered", () => {
        const s = sheetStatus(
            read({
                run: run({
                    status: "done",
                    completedts: NOW - 11 * MIN,
                    evidence: { durationms: 39 * MIN } as RunEvidence,
                }),
                dag: {
                    digest: fresh(
                        digest({
                            report: {
                                workerms: 77 * MIN,
                                commits: [
                                    { taskid: "t-1", commit: "a91c4f2" },
                                    { taskid: "t-2", commit: "7d0b18e" },
                                ],
                                answered: 0,
                                forwarded: 0,
                            },
                        })
                    ),
                    group: group(["done", "done", "done", "done"], { status: "done" }),
                    groupRead: "ready",
                },
            })
        );
        expect(s.verb).toBe("Done");
        expect(s.sub).toBe("4 tasks, 2 commits landed, 39m");
        expect(s.pulse).toBe(false);
        expect(s.meta.map((m) => m.text)).toEqual(["finished 11m ago", "workers 1h17m", "evidence sealed"]);
    });

    it("counts a cancelled run's survivors in the subtitle, so the count and the card cannot drift", () => {
        const s = sheetStatus(read({ run: run({ status: "cancelled", completedts: NOW - 30_000 }), survivors: 2 }));
        expect(s.verb).toBe("Cancelled");
        expect(s.sub).toBe("2 workers still running");
        expect(s.meta.map((m) => m.text)).toEqual(["cancelled 30s ago", "2 survivors"]);
        const clean = sheetStatus(read({ run: run({ status: "cancelled" }) }));
        expect(clean.sub).toBe("stopped after 2 of 4 tasks");
    });
});

describe("orderedTasks", () => {
    it("lifts exceptions above running work and keeps graph order within a bucket", () => {
        const g = group(["done", "running", "stalled", "pending", "running"]);
        const d = digest({ tasks: [{ taskid: "t-4", waitreason: "ask", mergestate: "", cleanupstate: "" }] });
        expect(orderedTasks(g, d).map((r) => r.task.id)).toEqual(["t-3", "t-4", "t-2", "t-5", "t-1"]);
    });
});

describe("launcherReading", () => {
    it("says nothing is running only when no run in the project is live", () => {
        expect(launcherReading([], NOW)).toEqual({ verb: "Nothing running", sub: "no run in this project yet" });
        expect(launcherReading([run({ status: "done", completedts: NOW - 120 * MIN })], NOW).sub).toBe(
            "last run ended 2h0m ago"
        );
        expect(launcherReading([run({ status: "done", completedts: NOW - MIN }), run()], NOW)).toEqual({
            verb: "New run",
            sub: "1 run still live in this project",
        });
    });
});

describe("taskSectionMeta", () => {
    it("prints the plan's shape, or why there is none", () => {
        expect(taskSectionMeta(run(), digest())).toBe("4 tasks · 4 lanes · longest chain 1");
        expect(taskSectionMeta(run({ dagoref: "" }), undefined)).toBe("not decided yet");
        expect(taskSectionMeta(run({ mode: "quick" }), undefined)).toBe("none — a quick run has no graph");
    });
});

function rowInput(task: Partial<TaskNode>, over: Partial<SheetRowInput> = {}): SheetRowInput {
    return {
        task: { id: "t-1", label: "fix the store layer", state: "running", ...task } as TaskNode,
        td: undefined,
        worker: { state: "pending" },
        briefs: new Map([
            ["t-1", { label: "fix the store layer", state: "running" }],
            ["t-2", { label: "fix the backend", state: "running" }],
        ]),
        lanes: [["t-1"], ["t-2"], ["t-3"]],
        durations: undefined,
        recovery: null,
        askOwner: null,
        nowMs: NOW,
        asOf: null,
        ...over,
    };
}

const dispatched = (activity: string): TaskWorkerView => ({
    state: "dispatched",
    tabId: "tab1",
    runId: "8a41ffff",
    agent: { id: "tab1", name: "w", task: "", state: "working", activity } as TaskWorkerView["agent"],
});

describe("taskRow", () => {
    it("spends a live row's second line on what the worker is doing now", () => {
        const r = taskRow(rowInput({ runid: "8a41ffff" }, { worker: dispatched("editing briefsheet.tsx") }));
        expect(r).toMatchObject({
            meta: "editing briefsheet.tsx",
            state: "running",
            stateTone: "success",
            action: "open-agent",
        });
    });

    // was two lines above the task ("Worker session unavailable", "Activity unavailable")
    it("puts a gone session in the state column and keeps the action that still works", () => {
        const r = taskRow(rowInput({ runid: "8a41ffff" }, { worker: { state: "unavailable", runId: "8a41ffff" } }));
        expect(r).toMatchObject({
            meta: "child run 8a41 · session closed, work continues",
            state: "no session",
            action: "open-child-run",
        });
    });

    it("prints a done task's lane, time and child run", () => {
        const r = taskRow(
            rowInput(
                { id: "t-3", state: "done", runid: "8a43ffff" },
                { worker: { state: "unavailable", runId: "8a43ffff" }, durations: [{ taskid: "t-3", runms: 14 * MIN }] }
            )
        );
        expect(r).toMatchObject({ meta: "lane 3 · 14m · child run 8a43", state: "done", action: "open-child-run" });
    });

    it("names what a queued task waits on", () => {
        const r = taskRow(
            rowInput(
                { id: "t-4", state: "pending" },
                {
                    td: {
                        taskid: "t-4",
                        waitreason: "dependency",
                        blockingtaskids: ["t-1", "t-2"],
                        mergestate: "",
                        cleanupstate: "",
                    },
                }
            )
        );
        expect(r).toMatchObject({
            meta: "waiting on fix the store layer, fix the backend",
            state: "queued",
            action: null,
        });
    });

    it("says who holds a task's question", () => {
        const td: DagTaskDigest = {
            taskid: "t-1",
            waitreason: "ask",
            askts: NOW - 40_000,
            mergestate: "",
            cleanupstate: "",
        };
        expect(taskRow(rowInput({}, { td, askOwner: "user" })).meta).toBe("asked you · idle 40s");
        expect(taskRow(rowInput({}, { td, askOwner: "lead" })).meta).toBe("asked the lead · idle 40s");
    });

    it("gives a failure one meta line from its recovery history", () => {
        const r = taskRow(
            rowInput({ state: "stalled", runid: "8a42ffff" }, { recovery: "Retried twice · test · now stalled" })
        );
        expect(r).toMatchObject({
            meta: "Retried twice · test · now stalled",
            stateTone: "error",
            action: "open-child-run",
        });
    });

    it("sends a blocked merge to the task in the graph, with the first line of git's refusal", () => {
        const r = taskRow(rowInput({ state: "blocked-merge", mergeerror: "CONFLICT in store.ts\nmore detail" }));
        expect(r).toMatchObject({ meta: "CONFLICT in store.ts", action: "open-dag-task" });
    });

    it("dates every figure and drops the tones on a stale row", () => {
        const r = taskRow(
            rowInput({ runid: "8a41ffff" }, { worker: dispatched("running tests"), asOf: "as of 2m ago" })
        );
        expect(r).toMatchObject({
            meta: "as of 2m ago · running tests",
            state: "running?",
            stateTone: "muted",
            metaTone: "muted",
        });
    });

    // the engine reaps the lane's worker before Verify starts, so a verifying task has no session by design
    it("reads a verifying task as running Verify once its worker is reaped", () => {
        const r = taskRow(
            rowInput({ state: "verifying", runid: "8a41ffff" }, { worker: { state: "unavailable", runId: "8a41ffff" } })
        );
        expect(r).toMatchObject({
            meta: "running Verify",
            state: "verifying",
            stateTone: "success",
            action: "open-dag-task",
        });
    });

    it("reads a question the lead holds as asked the lead", () => {
        const td: DagTaskDigest = {
            taskid: "t-1",
            waitreason: "lead-ask",
            askts: NOW - 40_000,
            mergestate: "",
            cleanupstate: "",
        };
        expect(taskRow(rowInput({}, { td, askOwner: null })).meta).toBe("asked the lead · idle 40s");
    });
});

describe("configLine", () => {
    it("prints the running configuration as one line", () => {
        expect(
            configLine(run(), { parallelism: 2, workerRoute: null, reviewerPicks: false, reviewerRoute: null }, false)
        ).toBe("engine · orchestrator · lead pi/deepseek-v4-flash · parallelism 2 · workers inherit the lead");
    });

    it("says when a run's width is left to its submit", () => {
        expect(
            configLine(run(), { parallelism: 0, workerRoute: null, reviewerPicks: false, reviewerRoute: null }, false)
        ).toContain("parallelism set at submit");
    });

    it("carries a refused value with not saved", () => {
        expect(
            configLine(run(), { parallelism: 9, workerRoute: null, reviewerPicks: false, reviewerRoute: null }, true)
        ).toBe("engine · orchestrator · parallelism 9 — not saved");
    });
});

describe("configNote", () => {
    it("leaves the slot to the printed line when the run is editable", () => {
        expect(configNote(run(), { kind: "editable" })).toBeNull();
    });

    it("states each fixed reason where the dials would be", () => {
        expect(configNote(run({ status: "done" }), { kind: "readonly", reason: "this run is done" })?.title).toBe(
            "Settings are fixed: this run is done."
        );
        const quick = configNote(run({ mode: "quick", runtime: "claude", model: "sonnet-4-6" }), {
            kind: "readonly",
            reason: "a quick run has no scheduler to reconfigure",
        });
        expect(quick?.body).toMatch(/fixed at launch: claude · sonnet-4-6/);
        // a finished quick run has no dock button to carry its configuration forward, so the note offers none
        const quickDone = configNote(run({ mode: "quick", status: "done" }), {
            kind: "readonly",
            reason: "this run is done",
        });
        expect(quickDone?.body).not.toMatch(/Save/);
    });

    it("says a plan that cannot be read offers no controls", () => {
        expect(configNote(run(), { kind: "unavailable", reason: "error" })?.title).toBe(
            "This run's plan could not be read."
        );
        expect(configNote(run(), { kind: "loading" })?.pulse).toBe(true);
    });
});

describe("finalStageEndable", () => {
    const group = (status: string, state?: string) =>
        ({ status, final: state == null ? undefined : { state, round: 1 } }) as unknown as TaskGroup;
    it("is true while the stage's commands or its verifier run", () => {
        for (const state of ["checking", "final", "verifying"]) {
            expect(finalStageEndable(group("finalizing", state))).toBe(true);
        }
    });
    it("is false with no stage, a stage not started, or one that ended", () => {
        expect(finalStageEndable(null)).toBe(false);
        expect(finalStageEndable(group("running"))).toBe(false);
        expect(finalStageEndable(group("finalizing", ""))).toBe(false);
        for (const state of ["passed", "unverified", "failed"]) {
            expect(finalStageEndable(group("done", state))).toBe(false);
        }
    });
    it("is false on a cancelled dag, whatever the stage last recorded", () => {
        expect(finalStageEndable(group("cancelled", "final"))).toBe(false);
    });
});

describe("sheetLead", () => {
    const lead = { id: "lead", name: "lead", state: "working" } as AgentVM;
    const withLead = { phases: [{ kind: "orchestrate", state: "running", workerorefs: ["tab:lead"] }] };
    it("is a live orchestrator's lead", () => {
        expect(sheetLead(run(withLead), [lead])?.id).toBe("lead");
    });
    it("is none on a finished run or a quick run", () => {
        expect(sheetLead(run({ ...withLead, status: "done" }), [lead])).toBeUndefined();
        expect(sheetLead(run({ ...withLead, mode: "" }), [lead])).toBeUndefined();
    });
});

describe("doneBody", () => {
    it("is the filed report, else the sealed evidence, on a done run only", () => {
        expect(doneBody(run({ status: "done", report: "# Report" }))).toBe("report");
        expect(doneBody(run({ status: "done", report: "  " }))).toBe("evidence");
        expect(doneBody(run())).toBeNull();
    });
});

describe("doneBodyHasDiff", () => {
    it("offers the diff from a sealed evidence body", () => {
        expect(doneBodyHasDiff(run({ status: "done", evidence: {} as RunEvidence }))).toBe(true);
        expect(doneBodyHasDiff(run({ status: "done" }))).toBe(false);
    });
    it("offers it from a filed report", () => {
        expect(doneBodyHasDiff(run({ status: "done", report: "the lead's summary" }))).toBe(true);
    });
    it("offers none before the run is done", () => {
        expect(doneBodyHasDiff(run({ evidence: {} as RunEvidence }))).toBe(false);
    });
});
