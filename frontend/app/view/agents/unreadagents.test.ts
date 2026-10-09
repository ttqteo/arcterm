// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import type { AgentState } from "./agentsviewmodel";
import type { RunInfo } from "./runlineage";
import { latestUnreadId, nestedIds, nextUnread, sameCounts, unreadLabel, viewingIds } from "./unreadagents";

const states = (o: Record<string, AgentState>) => new Map(Object.entries(o));
const roster = (o: Record<string, AgentState>) => Object.entries(o).map(([id, state]) => ({ id, state }));
const noIds = new Set<string>();

describe("nextUnread", () => {
    const counts = (o: Record<string, number>) => new Map(Object.entries(o));
    const none = counts({});

    it("counts a turn that finished out of view", () => {
        const out = nextUnread(
            none,
            states({ a: "working", b: "working" }),
            roster({ a: "idle", b: "working" }),
            noIds
        );
        expect(out).toEqual(counts({ a: 1 }));
    });

    it("adds each further turn that finishes before you look", () => {
        // it went back to work unseen: the count stays, and the next finish adds one
        const working = nextUnread(counts({ a: 1 }), states({ a: "idle" }), roster({ a: "working" }), noIds);
        expect(working).toEqual(counts({ a: 1 }));
        expect(nextUnread(working, states({ a: "working" }), roster({ a: "idle" }), noIds)).toEqual(counts({ a: 2 }));
    });

    it("does not count a run's workers or stage sessions, only top-level agents", () => {
        const out = nextUnread(
            counts({ w: 2 }),
            states({ lead: "working", w: "working", s: "working" }),
            roster({ lead: "idle", w: "idle", s: "idle" }),
            noIds,
            new Set(["w", "s"])
        );
        expect(out).toEqual(counts({ lead: 1 }));
    });

    it("does not count one that finished in view", () => {
        expect(nextUnread(none, states({ a: "working" }), roster({ a: "idle" }), new Set(["a"])).size).toBe(0);
    });

    it("does not count one that was idle already, or that went to asking", () => {
        const out = nextUnread(none, states({ a: "idle", b: "working" }), roster({ a: "idle", b: "asking" }), noIds);
        expect(out.size).toBe(0);
    });

    it("keeps the count while it stays idle out of view", () => {
        expect(nextUnread(counts({ a: 3 }), states({ a: "idle" }), roster({ a: "idle" }), noIds)).toEqual(
            counts({ a: 3 })
        );
    });

    it("clears it once it is in view, or asking (the Cockpit's attention badge counts that)", () => {
        expect(nextUnread(counts({ a: 2 }), states({ a: "idle" }), roster({ a: "idle" }), new Set(["a"])).size).toBe(0);
        expect(nextUnread(counts({ a: 2 }), states({ a: "idle" }), roster({ a: "asking" }), noIds).size).toBe(0);
    });

    it("drops an agent that left the roster", () => {
        expect(nextUnread(counts({ a: 1 }), states({ a: "idle" }), [], noIds).size).toBe(0);
    });

    it("does not count an agent seen for the first time", () => {
        expect(nextUnread(none, new Map(), roster({ a: "idle" }), noIds).size).toBe(0);
    });
});

describe("unreadLabel", () => {
    it("is the count, capped at 9+", () => {
        expect(unreadLabel(1)).toBe("1");
        expect(unreadLabel(9)).toBe("9");
        expect(unreadLabel(10)).toBe("9+");
        expect(unreadLabel(250)).toBe("9+");
    });
});

describe("latestUnreadId", () => {
    const agents = [{ id: "a", idleSince: 100 }, { id: "b", idleSince: 300 }, { id: "c" }, { id: "d", idleSince: 200 }];
    const unread = (...ids: string[]) => new Map(ids.map((id) => [id, 1]));

    it("is the unread agent that went idle last", () => {
        expect(latestUnreadId(unread("a", "d"), agents)).toBe("d");
        expect(latestUnreadId(unread("a", "b", "d"), agents)).toBe("b");
    });

    it("ranks an agent with no idleSince oldest, and keeps roster order on a tie", () => {
        expect(latestUnreadId(unread("c", "a"), agents)).toBe("a");
        expect(latestUnreadId(unread("c"), agents)).toBe("c");
        const tied = [
            { id: "x", idleSince: 5 },
            { id: "y", idleSince: 5 },
        ];
        expect(latestUnreadId(unread("y", "x"), tied)).toBe("x");
    });

    it("is undefined when nothing in the roster is unread", () => {
        expect(latestUnreadId(unread(), agents)).toBeUndefined();
        expect(latestUnreadId(unread("gone"), agents)).toBeUndefined();
    });
});

describe("viewingIds", () => {
    const grid = { ids: ["a", "b"], focused: "a" };

    it("is the focused agent, or the whole grid when it is a cell", () => {
        expect([...viewingIds(true, true, "terminal", "a", grid)].sort()).toEqual(["a", "b"]);
        expect([...viewingIds(true, true, "terminal", "c", grid)]).toEqual(["c"]);
    });

    it("is nothing off the Agent surface, or with History, a session or a run over the terminal", () => {
        expect(viewingIds(true, false, "terminal", "a", grid).size).toBe(0);
        for (const center of ["history", "session", "run"] as const) {
            expect(viewingIds(true, true, center, "a", grid).size).toBe(0);
        }
        expect(viewingIds(true, true, "terminal", undefined, grid).size).toBe(0);
    });

    it("sees nothing while the window is not focused", () => {
        expect(viewingIds(false, true, "terminal", "a", grid).size).toBe(0);
    });
});

describe("sameCounts", () => {
    it("compares ids and their counts", () => {
        const m = (o: Record<string, number>) => new Map(Object.entries(o));
        expect(sameCounts(m({ a: 1, b: 2 }), m({ b: 2, a: 1 }))).toBe(true);
        expect(sameCounts(m({ a: 1 }), m({ a: 2 }))).toBe(false);
        expect(sameCounts(m({ a: 1 }), m({ a: 1, b: 1 }))).toBe(false);
        expect(sameCounts(m({ a: 1 }), m({ b: 1 }))).toBe(false);
    });
});

describe("nestedIds", () => {
    const run = (runId: string, dag?: RunInfo["dag"]): RunInfo => ({
        runId,
        channelId: "c",
        title: "",
        project: "p",
        dag,
    });

    it("picks workers and stage sessions, and a lead still talking its plan through does not count among them", () => {
        const out = nestedIds({
            roles: {
                lead: { kind: "lead", runId: "r" },
                w: { kind: "worker", leadRunId: "r", taskId: "t-1" },
                s: { kind: "stage", leadRunId: "r", stageRole: "review" },
            },
            runs: { r: run("r") },
        });
        expect(out).toEqual(new Set(["w", "s"]));
    });

    it("picks a lead whose plan the engine runs, since the engine wakes it for every task and merge", () => {
        const out = nestedIds({
            roles: { lead: { kind: "lead", runId: "r" }, other: { kind: "lead", runId: "q" } },
            runs: { r: run("r", { runid: "r" } as RunInfo["dag"]), q: run("q") },
        });
        expect(out).toEqual(new Set(["lead"]));
    });
});
