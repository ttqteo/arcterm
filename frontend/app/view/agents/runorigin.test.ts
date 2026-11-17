// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
    brainstormRunSuperseded,
    finishedRun,
    HIDDEN_RUNS_CAP,
    hideableOriginRuns,
    originLinks,
    originName,
    originRunInfo,
    parseHiddenRuns,
    runOrigin,
    runsStartedBy,
    startedRunsShown,
    startedRunsText,
    withHiddenRuns,
    type OriginRun,
} from "./runorigin";

describe("runOrigin", () => {
    const roster = [
        { id: "tab-a", name: "fix the job queue" },
        { id: "tab-b", name: "loom" },
    ];
    const ended = {
        id: "s-1",
        runtime: "claude",
        task: "plan the float window",
        transcriptpath: "/t/s-1.jsonl",
    } as SessionActivity;

    it("is nothing for a run started from the cockpit", () => {
        expect(runOrigin({}, roster, [ended])).toBeNull();
        expect(runOrigin(undefined, roster, [ended])).toBeNull();
    });

    it("names the live session that started the run", () => {
        expect(runOrigin({ origintabid: "tab-a", origintranscript: "/t/x.jsonl" }, roster, null)).toEqual({
            kind: "live",
            tabId: "tab-a",
            name: "fix the job queue",
        });
    });

    // its tab is gone, but Conversation History still has the session by its transcript
    it("finds an ended session by its transcript", () => {
        expect(runOrigin({ origintabid: "tab-gone", origintranscript: "/t/s-1.jsonl" }, roster, [ended])).toEqual({
            kind: "ended",
            name: "plan the float window",
            sel: "claude:s-1",
        });
    });

    it("lands an ended run session on its run, with it in view", () => {
        const lead = { ...ended, runid: "r-9", role: "lead" } as SessionActivity;
        expect(runOrigin({ origintabid: "tab-gone", origintranscript: "/t/s-1.jsonl" }, roster, [lead])).toEqual({
            kind: "ended",
            name: "plan the float window",
            sel: "run:r-9",
            member: "lead",
        });
    });

    it("calls an ended session with no task untitled", () => {
        const untitled = { ...ended, task: "" } as SessionActivity;
        expect(runOrigin({ origintabid: "tab-gone", origintranscript: "/t/s-1.jsonl" }, roster, [untitled])).toEqual(
            expect.objectContaining({ kind: "ended", name: "an untitled session" })
        );
    });

    it("says the session is gone when neither the roster nor the history has it", () => {
        expect(runOrigin({ origintabid: "tab-gone", origintranscript: "/t/other.jsonl" }, roster, [ended])).toEqual({
            kind: "gone",
        });
        expect(runOrigin({ origintabid: "tab-gone" }, roster, [ended])).toEqual({ kind: "gone" });
        // history not loaded yet
        expect(runOrigin({ origintabid: "tab-gone", origintranscript: "/t/s-1.jsonl" }, roster, null)).toEqual({
            kind: "gone",
        });
    });
});

describe("runsStartedBy", () => {
    const me = { id: "tab-a", transcriptPath: "/t/now.jsonl" };
    const run = (oid: string, more: Partial<Run>) =>
        ({ oid, goal: oid, status: "executing", createdts: 0, origintabid: "tab-a", ...more }) as Run;

    it("lists the runs this session started and no other", () => {
        const runs = [run("r1", {}), run("r2", { origintabid: "tab-b" }), run("r3", { origintabid: undefined })];
        expect(runsStartedBy(me, runs).map((r) => r.oid)).toEqual(["r1"]);
    });

    // the tab outlives its session: a run the tab's earlier session started is not this one's
    it("leaves out a run an earlier session in the same tab started", () => {
        const runs = [run("r1", { origintranscript: "/t/now.jsonl" }), run("r2", { origintranscript: "/t/old.jsonl" })];
        expect(runsStartedBy(me, runs).map((r) => r.oid)).toEqual(["r1"]);
    });

    it("keeps a run when either transcript is unknown", () => {
        expect(runsStartedBy(me, [run("r1", {})]).map((r) => r.oid)).toEqual(["r1"]);
        expect(
            runsStartedBy({ id: "tab-a" }, [run("r1", { origintranscript: "/t/old.jsonl" })]).map((r) => r.oid)
        ).toEqual(["r1"]);
    });

    it("puts the runs still going first, then the newest", () => {
        const runs = [
            run("old-done", { status: "done", createdts: 1 }),
            run("new-done", { status: "cancelled", createdts: 4 }),
            run("old-going", { createdts: 2 }),
            run("new-going", { status: "blocked", createdts: 3 }),
        ];
        expect(runsStartedBy(me, runs).map((r) => r.oid)).toEqual(["new-going", "old-going", "new-done", "old-done"]);
    });
});

describe("startedRunsText", () => {
    it("names a single run by its goal's first line", () => {
        expect(startedRunsText([{ goal: "Add paging to /orders\nwith a cursor", status: "executing" }])).toBe(
            "Add paging to /orders"
        );
        expect(startedRunsText([{ goal: "  ", status: "done" }])).toBe("an untitled run");
    });

    it("counts several, and how many are still going", () => {
        const going = { goal: "a", status: "executing" };
        const done = { goal: "b", status: "done" };
        expect(startedRunsText([going, done, done])).toBe("3 runs, 1 active");
        expect(startedRunsText([done, done])).toBe("2 runs");
    });

    it("leaves cancelled runs out of the count", () => {
        const going = { goal: "a", status: "executing" };
        const done = { goal: "b", status: "done" };
        const cancelled = { goal: "c", status: "cancelled" };
        expect(startedRunsText([going, done, cancelled])).toBe("2 runs, 1 active");
        // one left once the cancelled one is out reads by its goal
        expect(startedRunsText([going, cancelled, cancelled])).toBe("a");
    });

    it("reads the newest cancelled run, marked, when cancelled runs are all there is", () => {
        const old = { goal: "old plan", status: "cancelled", createdts: 1 };
        const fresh = { goal: "new plan\nmore", status: "cancelled", createdts: 5 };
        expect(startedRunsText([old, fresh])).toBe("new plan · cancelled");
        expect(startedRunsShown([old, fresh])).toEqual([fresh]);
        expect(startedRunsShown([])).toEqual([]);
    });
});

// the run chip on the session that started a run
describe("originLinks", () => {
    const dag = (status: string, states: string[]) =>
        ({ status, tasks: states.map((state, i) => ({ id: `t${i}`, state })) }) as unknown as TaskGroup;
    const run = (runId: string, more: Partial<OriginRun> = {}): OriginRun => ({
        runId,
        title: `Title ${runId}`,
        originId: "tab-a",
        createdTs: 100,
        ...more,
    });
    const byId = (...runs: OriginRun[]) => Object.fromEntries(runs.map((r) => [r.runId, r]));
    const entry = (id: string, more: Partial<RunQueueEntry> = {}, tab = "tab-a"): RunQueueEntry =>
        ({
            id,
            title: `Plan ${id}`,
            projectpath: "/p/arcterm",
            queuedts: 200,
            state: "waiting",
            data: { origintabid: tab },
            ...more,
        }) as RunQueueEntry;
    const label = (agentId: string, runs: Record<string, OriginRun>, queue: RunQueueEntry[] = []) =>
        originLinks(agentId, runs, queue)?.label;

    it("is nothing when the session started no run and queued no plan", () => {
        expect(originLinks("tab-a", {}, [])).toBeNull();
        expect(originLinks("tab-a", byId(run("r1", { originId: "tab-b" })), [entry("q1", {}, "tab-b")])).toBeNull();
        expect(originLinks("tab-a", byId(run("r1", { originId: undefined })), [])).toBeNull();
    });

    it("says how many of a running run's tasks are done, and leaves its title to the tooltip", () => {
        const runs = byId(run("r1", { dag: dag("executing", ["done", "skipped", "running", "pending", "pending"]) }));
        expect(originLinks("tab-a", runs, [])).toEqual({
            label: "2/5",
            title: "Title r1 · 2/5",
            target: { kind: "run", runId: "r1" },
        });
    });

    it("has no words for a run with no plan yet, whose tooltip is its title alone", () => {
        expect(originLinks("tab-a", byId(run("r1", { status: "planning" })), [])).toEqual({
            label: "",
            title: "Title r1",
            target: { kind: "run", runId: "r1" },
        });
    });

    it("says a queued entry is a plan, and its place among the waiting ones", () => {
        const queue = [entry("q0", {}, "tab-b"), entry("q1")];
        expect(originLinks("tab-a", {}, queue)).toEqual({
            label: "plan queued #2",
            title: "Plan q1 · plan queued #2",
            target: { kind: "queued", entryId: "q1" },
        });
    });

    it("says a blocked entry is a blocked plan, which takes no place from the waiting ones", () => {
        const queue = [entry("q1", { state: "blocked", reason: "was held" }), entry("q2", {}, "tab-b")];
        expect(label("tab-a", {}, queue)).toBe("plan blocked");
        expect(label("tab-b", {}, queue)).toBe("plan queued #1");
    });

    it("says merged once the run's branch has landed", () => {
        const runs = byId(run("r1", { status: "done", land: { state: "landed" }, dag: dag("done", ["done"]) }));
        expect(originLinks("tab-a", runs, [])).toMatchObject({ label: "merged", title: "Title r1 · merged" });
    });

    it("says held when the run's branch is held back", () => {
        const runs = byId(
            run("r1", { status: "done", land: { state: "held", reason: "dirty" }, dag: dag("done", ["done"]) })
        );
        expect(label("tab-a", runs)).toBe("held");
    });

    it("reads a finished run that landed nothing, and a cancelled one, by what they are", () => {
        expect(label("tab-a", byId(run("r1", { status: "done" })))).toBe("done");
        expect(label("tab-a", byId(run("r1", { status: "cancelled" })))).toBe("cancelled");
        // a done run with a branch to land and no land yet is still on its way in
        expect(label("tab-a", byId(run("r1", { status: "done", landPath: "/w/wave-r1" })))).toBe("");
    });

    it("counts two or more as N runs and points at the newest", () => {
        const runs = byId(run("r1", { createdTs: 100 }), run("r2", { createdTs: 300 }));
        expect(originLinks("tab-a", runs, [])).toEqual({
            label: "2 runs",
            title: "2 runs · newest: Title r2",
            target: { kind: "run", runId: "r2" },
        });
        // a run and a queued entry are two links; the entry queued last is the newest
        expect(originLinks("tab-a", byId(run("r1", { createdTs: 100 })), [entry("q1", { queuedts: 500 })])).toEqual({
            label: "2 runs",
            title: "2 runs · newest: Plan q1 · plan queued #1",
            target: { kind: "queued", entryId: "q1" },
        });
    });

    it("leaves a cancelled run out of the count and out of the newest", () => {
        const runs = byId(
            run("r1", { createdTs: 100, dag: dag("executing", ["done", "pending"]) }),
            run("r2", { createdTs: 300, status: "cancelled" })
        );
        expect(originLinks("tab-a", runs, [])).toEqual({
            label: "1/2",
            title: "Title r1 · 1/2",
            target: { kind: "run", runId: "r1" },
        });
        // the dag's cancelled status counts too, and two live links still read as N runs without it
        const three = byId(
            run("r1", { createdTs: 100 }),
            run("r2", { createdTs: 200 }),
            run("r3", { createdTs: 300, dag: dag("cancelled", ["pending"]) })
        );
        expect(originLinks("tab-a", three, [])).toMatchObject({
            label: "2 runs",
            target: { kind: "run", runId: "r2" },
        });
    });

    it("reads cancelled, at the newest, when cancelled runs are all the session started", () => {
        const runs = byId(
            run("r1", { createdTs: 100, status: "cancelled" }),
            run("r2", { createdTs: 300, status: "cancelled" })
        );
        expect(originLinks("tab-a", runs, [])).toEqual({
            label: "cancelled",
            title: "Title r2 · cancelled",
            target: { kind: "run", runId: "r2" },
        });
    });
});

describe("brainstormRunSuperseded", () => {
    const queued = {
        label: "plan queued #1",
        title: "Build section 6 · plan queued #1",
        target: { kind: "queued", entryId: "q-1" },
    } as const;
    const other = { label: "2/5", title: "Build · 2/5", target: { kind: "run", runId: "run-new" } } as const;
    const same = { label: "cancelled", title: "Build · cancelled", target: { kind: "run", runId: "run-old" } } as const;

    it("drops a cancelled brainstorm run once the chip names a plan queued after it, or another run", () => {
        expect(brainstormRunSuperseded("run-old", "cancelled", queued)).toBe(true);
        expect(brainstormRunSuperseded("run-old", "cancelled", other)).toBe(true);
    });

    it("keeps it while it is all there is, or while it is still going", () => {
        expect(brainstormRunSuperseded("run-old", "cancelled", same)).toBe(false);
        expect(brainstormRunSuperseded("run-old", "cancelled", null)).toBe(false);
        expect(brainstormRunSuperseded("run-old", "executing", queued)).toBe(false);
        expect(brainstormRunSuperseded(undefined, "cancelled", queued)).toBe(false);
    });
});

describe("originRunInfo", () => {
    it("reads a run the lineage has no agent for as the tree does", () => {
        const run = {
            oid: "r1",
            goal: "Do the thing\nmore",
            status: "executing",
            origintabid: "tab-a",
            landpath: "/w/wave-r1",
            createdts: 7,
        } as unknown as Run;
        expect(originRunInfo(run, undefined)).toEqual({
            runId: "r1",
            title: "Do the thing",
            originId: "tab-a",
            status: "executing",
            landPath: "/w/wave-r1",
            land: undefined,
            createdTs: 7,
            dag: undefined,
        });
        expect(originRunInfo({ ...run, origintabid: "" } as Run, undefined).originId).toBeUndefined();
    });
});

// the `from` text on a run's row
describe("originName", () => {
    const agents = [
        { id: "tab-a", name: "Rail chắt lọc" },
        { id: "tab-b", name: "loom" },
    ];

    it("is the name of the session that started the run while its tab is in the roster", () => {
        expect(originName({ originId: "tab-a" }, agents)).toBe("Rail chắt lọc");
    });

    it("is nothing for a run started from the cockpit", () => {
        expect(originName({ originId: undefined }, agents)).toBeNull();
        expect(originName({}, agents)).toBeNull();
    });

    it("is nothing once the origin tab is gone", () => {
        expect(originName({ originId: "tab-gone" }, agents)).toBeNull();
    });
});

describe("hiding finished runs from the chip", () => {
    const run = (runId: string, more: Partial<OriginRun> = {}): OriginRun => ({
        runId,
        title: `Title ${runId}`,
        originId: "tab-a",
        createdTs: 100,
        ...more,
    });
    const byId = (...runs: OriginRun[]) => Object.fromEntries(runs.map((r) => [r.runId, r]));
    const landed = { state: "landed" } as RunLand;
    const held = { state: "held" } as RunLand;

    it("counts a run as finished once it landed, failed, was cancelled, or is done with nothing to land", () => {
        expect(finishedRun({ status: "done", land: landed })).toBe(true);
        expect(finishedRun({ status: "failed" })).toBe(true);
        expect(finishedRun({ status: "cancelled" })).toBe(true);
        expect(finishedRun({ status: "done" })).toBe(true);
    });

    it("keeps a run that still waits: running, a held land, a done branch not landed yet", () => {
        expect(finishedRun({ status: "executing" })).toBe(false);
        expect(finishedRun({ status: "done", land: held })).toBe(false);
        expect(finishedRun({ status: "done", landPath: "/w/run" })).toBe(false);
    });

    it("leaves hidden runs out of the chip, and drops the chip when they were all there was", () => {
        const runs = byId(run("r1", { status: "done", land: landed }), run("r2", { status: "done", land: landed }));
        expect(originLinks("tab-a", runs, [])?.label).toBe("2 runs");
        expect(originLinks("tab-a", runs, [], new Set(["r1"]))?.label).toBe("merged");
        expect(originLinks("tab-a", runs, [], new Set(["r1", "r2"]))).toBeNull();
    });

    it("offers the finished runs of that session to hide, not running ones, other sessions' or hidden ones", () => {
        const runs = byId(
            run("r1", { status: "done", land: landed }),
            run("r2", { status: "executing" }),
            run("r3", { status: "failed", originId: "tab-b" }),
            run("r4", { status: "cancelled" })
        );
        expect(hideableOriginRuns("tab-a", runs, new Set()).sort()).toEqual(["r1", "r4"]);
        expect(hideableOriginRuns("tab-a", runs, new Set(["r1"]))).toEqual(["r4"]);
    });

    it("reads the stored list, and anything broken as none", () => {
        expect(parseHiddenRuns('["a","b"]')).toEqual(["a", "b"]);
        expect(parseHiddenRuns('["a",3]')).toEqual(["a"]);
        expect(parseHiddenRuns("{")).toEqual([]);
        expect(parseHiddenRuns(null)).toEqual([]);
    });

    it("adds each id once, newest last, and keeps only the newest past the cap", () => {
        expect(withHiddenRuns(["a", "b"], ["b", "c", "c"])).toEqual(["a", "b", "c"]);
        const full = Array.from({ length: HIDDEN_RUNS_CAP }, (_, i) => `r${i}`);
        const next = withHiddenRuns(full, ["new"]);
        expect(next).toHaveLength(HIDDEN_RUNS_CAP);
        expect(next[0]).toBe("r1");
        expect(next.at(-1)).toBe("new");
    });
});
