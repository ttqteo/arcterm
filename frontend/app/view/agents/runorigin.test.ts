// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { runOrigin, runsStartedBy, startedRunsText } from "./runorigin";

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
