// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
    originLinks,
    originName,
    originRunInfo,
    runOrigin,
    runsStartedBy,
    startedRunsText,
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
});

// the `→` line under the session that started a run
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

    it("is nothing when the session started no run and queued no plan", () => {
        expect(originLinks("tab-a", {}, [])).toBeNull();
        expect(originLinks("tab-a", byId(run("r1", { originId: "tab-b" })), [entry("q1", {}, "tab-b")])).toBeNull();
        expect(originLinks("tab-a", byId(run("r1", { originId: undefined })), [])).toBeNull();
    });

    it("names a running run by its title and how many of its tasks are done", () => {
        const runs = byId(run("r1", { dag: dag("executing", ["done", "skipped", "running", "pending", "pending"]) }));
        expect(originLinks("tab-a", runs, [])).toEqual({
            text: "→ Title r1 · 2/5",
            target: { kind: "run", runId: "r1" },
        });
    });

    it("names a run with no plan yet by its title alone", () => {
        expect(originLinks("tab-a", byId(run("r1", { status: "planning" })), [])?.text).toBe("→ Title r1");
    });

    it("says a queued entry's place among the waiting ones", () => {
        const queue = [entry("q0", {}, "tab-b"), entry("q1")];
        expect(originLinks("tab-a", {}, queue)).toEqual({
            text: "→ Queued #2",
            target: { kind: "queued", entryId: "q1" },
        });
    });

    it("says a blocked entry is blocked, which takes no place from the waiting ones", () => {
        const queue = [entry("q1", { state: "blocked", reason: "was held" }), entry("q2", {}, "tab-b")];
        expect(originLinks("tab-a", {}, queue)?.text).toBe("→ Blocked");
        expect(originLinks("tab-b", {}, queue)?.text).toBe("→ Queued #1");
    });

    it("says merged once the run's branch has landed", () => {
        const runs = byId(run("r1", { status: "done", land: { state: "landed" }, dag: dag("done", ["done"]) }));
        expect(originLinks("tab-a", runs, [])?.text).toBe("→ merged");
    });

    it("says held when the run's branch is held back", () => {
        const runs = byId(
            run("r1", { status: "done", land: { state: "held", reason: "dirty" }, dag: dag("done", ["done"]) })
        );
        expect(originLinks("tab-a", runs, [])?.text).toBe("→ held");
    });

    it("reads a finished run that landed nothing, and a cancelled one, by what they are", () => {
        expect(originLinks("tab-a", byId(run("r1", { status: "done" })), [])?.text).toBe("→ done");
        expect(originLinks("tab-a", byId(run("r1", { status: "cancelled" })), [])?.text).toBe("→ cancelled");
        // a done run with a branch to land and no land yet is still on its way in
        expect(originLinks("tab-a", byId(run("r1", { status: "done", landPath: "/w/wave-r1" })), [])?.text).toBe(
            "→ Title r1"
        );
    });

    it("counts two or more as N runs and points at the newest", () => {
        const runs = byId(run("r1", { createdTs: 100 }), run("r2", { createdTs: 300 }));
        expect(originLinks("tab-a", runs, [])).toEqual({ text: "→ 2 runs", target: { kind: "run", runId: "r2" } });
        // a run and a queued entry are two links; the entry queued last is the newest
        expect(originLinks("tab-a", byId(run("r1", { createdTs: 100 })), [entry("q1", { queuedts: 500 })])).toEqual({
            text: "→ 2 runs",
            target: { kind: "queued", entryId: "q1" },
        });
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
