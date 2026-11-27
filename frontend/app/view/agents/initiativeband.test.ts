// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { bandRows, canWorkOn, carryForward, doneIsAdvance, firstWorkOn, holderTag, switchPlan } from "./initiativeband";

type Ref = { kind: string; oref: string; ts: number };
const me = (ts = 1): Ref => ({ kind: "agent", oref: "agent:t1", ts });
const other = (ts = 1): Ref => ({ kind: "agent", oref: "agent:t2", ts });
const run: Ref = { kind: "run", oref: "run:r1", ts: 1 };
const chunk = (label: string, status: string, workrefs?: Ref[]) => ({
    label,
    status,
    ...(workrefs ? { workrefs } : {}),
});

// board A: a pending chunk before the agent's own (the first of the order of work, so it is next), a done chunk the
// agent held, its own, two pending to follow, one held by another tab, and chunks that are in the plan but not in the
// window (one past the next two, a proposed one)
const board = {
    oid: "7655bf18",
    chunks: [
        chunk("Intro", "pending"),
        chunk("Decide", "done", [me(10)]),
        chunk("Build", "active", [me(20)]),
        chunk("Scenario", "pending"),
        chunk("Polish", "pending"),
        chunk("Docs", "pending"),
        chunk("Review", "active", [other()]),
        chunk("Idea", "proposed"),
    ],
};

describe("canWorkOn", () => {
    it("is true for a pending, active, blocked or deferred chunk nobody holds", () => {
        for (const status of ["pending", "active", "blocked", "deferred"]) {
            expect(canWorkOn(chunk("X", status))).toBe(true);
            expect(canWorkOn({ label: "X", status, workrefs: [] })).toBe(true);
        }
    });

    it("is false for a chunk anyone holds, the agent itself or a run included", () => {
        expect(canWorkOn(chunk("X", "pending", [me()]))).toBe(false);
        expect(canWorkOn(chunk("X", "pending", [other()]))).toBe(false);
        expect(canWorkOn(chunk("X", "active", [run]))).toBe(false);
    });

    it("is false for a done, skipped or proposed chunk", () => {
        for (const status of ["done", "skipped", "proposed"]) {
            expect(canWorkOn(chunk("X", status))).toBe(false);
        }
    });
});

describe("bandRows", () => {
    it("lists the rows in plan order, with the next two chunks as the order of work names them", () => {
        const { window } = bandRows(board, "t1");
        // Intro comes first in the plan and is first among the equal pending chunks, so it is next though it is before the
        // agent's own chunk
        expect(window.map((r) => [r.label, r.kind])).toEqual([
            ["Intro", "next"],
            ["Decide", "done"],
            ["Build", "mine"],
            ["Scenario", "next"],
            ["Review", "other"],
        ]);
        expect(window.map((r) => r.n)).toEqual([1, 2, 3, 4, 7]);
        expect(window.some((r) => r.label === "Polish")).toBe(false);
    });

    it("lists the next rows in the order of work, a row keeping the number of its place in the plan", () => {
        // the agent is on chunk 1; chunk 2 is low, 3 unset, 4 critical: the next two are 4, then 3 (never 2)
        const effort = {
            chunks: [
                chunk("Build", "active", [me(20)]),
                { ...chunk("Low", "pending"), priority: "low" },
                chunk("Plain", "pending"),
                { ...chunk("Hot", "pending"), priority: "critical" },
            ],
        };
        const { window, all } = bandRows(effort, "t1");
        expect(window.map((r) => [r.label, r.kind, r.n])).toEqual([
            ["Build", "mine", 1],
            ["Hot", "next", 4],
            ["Plain", "next", 3],
        ]);
        // the full list is in plan order whatever the levels are
        expect(all.map((r) => [r.label, r.kind])).toEqual([
            ["Build", "mine"],
            ["Low", "plan"],
            ["Plain", "next"],
            ["Hot", "next"],
        ]);
    });

    it("moves only the next rows: the done, mine and other rows keep their places in the plan", () => {
        const effort = {
            chunks: [
                chunk("Intro", "pending"),
                chunk("Decide", "done", [me(10)]),
                chunk("Build", "active", [me(20)]),
                chunk("Review", "active", [other()]),
                { ...chunk("Docs", "pending"), priority: "critical" },
            ],
        };
        // Docs (critical) and Intro (unset) are next, Docs first: they swap the two next places, and no other row moves
        expect(bandRows(effort, "t1").window.map((r) => [r.label, r.kind])).toEqual([
            ["Docs", "next"],
            ["Decide", "done"],
            ["Build", "mine"],
            ["Review", "other"],
            ["Intro", "next"],
        ]);
    });

    it("picks the next two by priority, leaving out a lower-ranked pending chunk", () => {
        const effort = {
            chunks: [
                { ...chunk("Scenario", "pending"), priority: "low" },
                chunk("Build", "active", [me(20)]),
                chunk("Polish", "pending"),
                { ...chunk("Docs", "pending"), priority: "high" },
                chunk("Ship", "pending"),
            ],
        };
        const { window } = bandRows(effort, "t1");
        // Docs (high), then Polish (unset, the first of the equal ones); Ship (unset) and Scenario (low) are not next
        expect(window.map((r) => [r.label, r.kind])).toEqual([
            ["Build", "mine"],
            ["Docs", "next"],
            ["Polish", "next"],
        ]);
    });

    it("offers Work on this only on a chunk nobody holds that is not settled", () => {
        const { window } = bandRows(board, "t1");
        expect(window.map((r) => [r.label, r.workOn])).toEqual([
            ["Intro", true],
            ["Decide", false],
            ["Build", false],
            ["Scenario", true],
            ["Review", false],
        ]);
    });

    it("lists every non-proposed chunk in plan order in `all`, the window's rows with their kinds and the rest as plan", () => {
        const { all, total } = bandRows(board, "t1");
        expect(total).toBe(7);
        expect(all.map((r) => [r.label, r.kind, r.workOn])).toEqual([
            ["Intro", "next", true],
            ["Decide", "done", false],
            ["Build", "mine", false],
            ["Scenario", "next", true],
            ["Polish", "plan", true],
            ["Docs", "plan", true],
            ["Review", "other", false],
        ]);
    });

    it("names each row's holders, the agent's own included", () => {
        const { window } = bandRows(board, "t1");
        const byLabel = Object.fromEntries(window.map((r) => [r.label, r.holders]));
        expect(byLabel.Build).toEqual([{ kind: "agent", id: "t1" }]);
        expect(byLabel.Review).toEqual([{ kind: "agent", id: "t2" }]);
        expect(byLabel.Scenario).toEqual([]);
        expect(bandRows({ chunks: [chunk("A", "active", [run])] }, "t1").all[0].holders).toEqual([
            { kind: "run", id: "r1" },
        ]);
    });

    it("keeps the last done chunk the agent held: the one whose workref is the newest", () => {
        const effort = {
            chunks: [
                chunk("A", "done", [me(50)]),
                chunk("B", "done", [me(30)]),
                chunk("C", "done", [other(99)]),
                chunk("D", "active", [me(60)]),
            ],
        };
        expect(bandRows(effort, "t1").window.map((r) => [r.label, r.kind])).toEqual([
            ["A", "done"],
            ["D", "mine"],
        ]);
    });

    it("lists an agent that holds no chunk with the next ones from the top of the plan", () => {
        const effort = { chunks: [chunk("A", "pending"), chunk("B", "pending"), chunk("C", "pending")] };
        expect(bandRows(effort, "t1").window.map((r) => [r.label, r.kind])).toEqual([
            ["A", "next"],
            ["B", "next"],
        ]);
    });

    it("shows a chunk another holder has as other even when it is among the next ones", () => {
        const effort = {
            chunks: [chunk("A", "active", [me()]), chunk("B", "pending", [other()]), chunk("C", "pending")],
        };
        expect(bandRows(effort, "t1").window.map((r) => [r.label, r.kind])).toEqual([
            ["A", "mine"],
            ["B", "other"],
            ["C", "next"],
        ]);
    });

    it("lists a chunk only a run holds as other, and leaves a settled chunk someone else held out of the window", () => {
        const effort = {
            chunks: [chunk("A", "active", [me()]), chunk("B", "blocked", [run]), chunk("C", "done", [other()])],
        };
        expect(bandRows(effort, "t1").window.map((r) => [r.label, r.kind])).toEqual([
            ["A", "mine"],
            ["B", "other"],
        ]);
    });

    it("is empty for an initiative with no chunks", () => {
        expect(bandRows({}, "t1")).toEqual({ window: [], all: [], total: 0 });
        expect(bandRows({ chunks: [] }, "t1")).toEqual({ window: [], all: [], total: 0 });
    });

    it("numbers a chunk by its place in the plan, a proposed chunk before it counted", () => {
        const effort = { chunks: [chunk("P", "proposed"), chunk("A", "pending")] };
        expect(bandRows(effort, "t1").all.map((r) => [r.label, r.n])).toEqual([["A", 2]]);
    });
});

describe("holderTag", () => {
    const nameOf = (id: string) => (id === "t2" ? "Claude 2" : undefined);

    it("is this agent for the agent's own tab", () => {
        expect(holderTag({ kind: "agent", id: "t1" }, "t1", nameOf)).toBe("this agent");
    });

    it("is the roster name of another agent, or an agent when it is not in the roster", () => {
        expect(holderTag({ kind: "agent", id: "t2" }, "t1", nameOf)).toBe("Claude 2");
        expect(holderTag({ kind: "agent", id: "t3" }, "t1", nameOf)).toBe("an agent");
    });

    it("is a run for a run", () => {
        expect(holderTag({ kind: "run", id: "r1" }, "t1", nameOf)).toBe("a run");
    });
});

describe("firstWorkOn", () => {
    it("is the index of the first row that offers Work on this, or -1", () => {
        const { window } = bandRows(board, "t1");
        expect(firstWorkOn(window)).toBe(0);
        expect(firstWorkOn(window.filter((r) => !r.workOn))).toBe(-1);
        expect(firstWorkOn([])).toBe(-1);
    });
});

describe("switchPlan", () => {
    const effort = {
        oid: "7655bf18",
        chunks: [
            chunk("A", "done", [me(1)]),
            chunk("B", "active", [me(2)]),
            chunk("C", "pending"),
            chunk("D", "active", [other()]),
            chunk("E", "blocked"),
        ],
    };
    const attach = (c: string) => ({ op: "attachWork", chunk: c, kind: "agent", oref: "agent:t1" });
    const detach = (c: string) => ({ op: "detachWork", chunk: c, kind: "agent", oref: "agent:t1" });
    const status = (c: string, s: string) => ({ op: "setChunkStatus", chunk: c, status: s });

    it("from an active chunk no one else holds: detach and demote it, attach and activate the chosen one", () => {
        const p = switchPlan(effort, "t1", "C");
        expect(p.detach).toEqual([detach("B"), status("B", "pending")]);
        expect(p.attach).toEqual([attach("C"), status("C", "active")]);
        expect(p.rollback).toEqual([attach("B"), status("B", "active")]);
    });

    it("words the line with the chunk's place in the plan and the initiative's oref", () => {
        expect(switchPlan(effort, "t1", "C").line).toBe("initiative: switched you to chunk 3 C (effort:7655bf18)");
        expect(switchPlan(effort, "t1", "E").line).toBe("initiative: switched you to chunk 5 E (effort:7655bf18)");
    });

    it("does not demote an old chunk another tab or a run also holds", () => {
        const shared = { ...effort, chunks: [chunk("B", "active", [me(2), other()]), chunk("C", "pending")] };
        const p = switchPlan(shared, "t1", "C");
        expect(p.detach).toEqual([detach("B")]);
        expect(p.rollback).toEqual([attach("B")]);
        const withRun = { ...effort, chunks: [chunk("B", "active", [me(2), run]), chunk("C", "pending")] };
        expect(switchPlan(withRun, "t1", "C").detach).toEqual([detach("B")]);
    });

    it("does not touch the status of an old chunk that was not active", () => {
        const e = { ...effort, chunks: [chunk("B", "blocked", [me(2)]), chunk("C", "pending")] };
        const p = switchPlan(e, "t1", "C");
        expect(p.detach).toEqual([detach("B")]);
        expect(p.rollback).toEqual([attach("B")]);
    });

    it("has no detach and no rollback for an agent with no chunk, and its settled chunks keep their workrefs", () => {
        const e = { ...effort, chunks: [chunk("A", "done", [me(1)]), chunk("C", "pending")] };
        const p = switchPlan(e, "t1", "C");
        expect(p.detach).toBeNull();
        expect(p.rollback).toBeNull();
        expect(p.attach).toEqual([attach("C"), status("C", "active")]);
    });

    it("adds no status op when the chosen chunk is already active", () => {
        expect(switchPlan(effort, "t1", "D").attach).toEqual([attach("D")]);
    });

    it("sends a chunk whose label is all digits by its label, never a position", () => {
        const e = { oid: "o", chunks: [chunk("2", "pending"), chunk("1", "pending")] };
        expect(switchPlan(e, "t1", "2").attach).toEqual([attach("=2"), status("=2", "active")]);
        const own = { oid: "o", chunks: [chunk("5", "active", [me()]), chunk("C", "pending")] };
        const p = switchPlan(own, "t1", "C");
        expect(p.detach).toEqual([detach("=5"), status("=5", "pending")]);
        expect(p.rollback).toEqual([attach("=5"), status("=5", "active")]);
    });

    it("leaves the oref out of the line for an initiative with no oid", () => {
        expect(switchPlan({ chunks: [chunk("C", "pending")] }, "t1", "C").line).toBe(
            "initiative: switched you to chunk 1 C"
        );
    });

    it("writes a label on one line", () => {
        const e = { oid: "o", chunks: [chunk("two\nlines  here", "pending")] };
        expect(switchPlan(e, "t1", "two\nlines  here").line).toBe(
            "initiative: switched you to chunk 1 two lines here (effort:o)"
        );
    });

    it("is a plan that does nothing for the chunk the agent is already on", () => {
        const p = switchPlan(effort, "t1", "B");
        expect(p.detach).toBeNull();
        expect(p.attach).toEqual([]);
        expect(p.rollback).toBeNull();
    });

    it("throws for a chunk the initiative does not have", () => {
        expect(() => switchPlan(effort, "t1", "Nope")).toThrow(/Nope/);
    });
});

describe("carryForward", () => {
    const before = { chunks: [chunk("C1", "active", [me()]), chunk("C2", "pending"), chunk("C3", "pending")] };

    it("is the chunk the write made active when no one holds it", () => {
        const after = { chunks: [chunk("C1", "done", [me()]), chunk("C2", "active"), chunk("C3", "pending")] };
        expect(carryForward(before, after, "t1")).toBe("C2");
    });

    it("is null when someone holds the chunk that became active, a run included", () => {
        const heldByAgent = {
            chunks: [chunk("C1", "done", [me()]), chunk("C2", "active", [other()]), chunk("C3", "pending")],
        };
        expect(carryForward(before, heldByAgent, "t1")).toBeNull();
        const heldByRun = { chunks: [chunk("C1", "done", [me()]), chunk("C2", "active", [run])] };
        expect(carryForward(before, heldByRun, "t1")).toBeNull();
    });

    it("is null when nothing new became active", () => {
        expect(carryForward(before, before, "t1")).toBeNull();
        const done = { chunks: [chunk("C1", "done", [me()]), chunk("C2", "done"), chunk("C3", "done")] };
        expect(carryForward(before, done, "t1")).toBeNull();
    });

    it("is null when the agent still holds a live chunk (the server lets it hold one)", () => {
        const b = { chunks: [chunk("C1", "active", [me()]), chunk("C2", "pending", [me()]), chunk("C3", "pending")] };
        const after = { chunks: [chunk("C1", "done", [me()]), chunk("C2", "pending", [me()]), chunk("C3", "active")] };
        expect(carryForward(b, after, "t1")).toBeNull();
    });

    it("takes only a chunk that was not active before", () => {
        const b = { chunks: [chunk("C1", "active", [other()]), chunk("C2", "active", [me()]), chunk("C3", "pending")] };
        const after = {
            chunks: [chunk("C1", "active", [other()]), chunk("C2", "done", [me()]), chunk("C3", "pending")],
        };
        expect(carryForward(b, after, "t1")).toBeNull();
    });
});

describe("doneIsAdvance", () => {
    it("is true for the first active chunk in plan order", () => {
        const effort = { chunks: [chunk("A", "done"), chunk("B", "active"), chunk("C", "active")] };
        expect(doneIsAdvance(effort, "B")).toBe(true);
    });

    it("is false for a second active chunk, and for one that is not active", () => {
        const effort = {
            chunks: [chunk("A", "done"), chunk("B", "active"), chunk("C", "active"), chunk("D", "pending")],
        };
        expect(doneIsAdvance(effort, "C")).toBe(false);
        expect(doneIsAdvance(effort, "D")).toBe(false);
        expect(doneIsAdvance(effort, "Nope")).toBe(false);
        expect(doneIsAdvance({}, "A")).toBe(false);
    });
});
