// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import type { AgentVM } from "./agentsviewmodel";
import type { Lineage, RunInfo } from "./runlineage";
import { FLOAT_TAB_MAX, floatTabs, foldedList, stepFloatTab, workingCount } from "./sproutroster";

const a = (id: string, state: AgentVM["state"], kind?: string): AgentVM =>
    ({ id, name: id, task: "", state, kind }) as AgentVM;
const ids = (list: AgentVM[]) => list.map((x) => x.id);

// run r1 led by "lead", worked by "w1" and "w2", its plan reviewed by "rev"
const run: Lineage = {
    roles: {
        lead: { kind: "lead", runId: "r1" },
        w1: { kind: "worker", leadRunId: "r1", taskId: "t1" },
        w2: { kind: "worker", leadRunId: "r1", taskId: "t2" },
        rev: { kind: "stage", leadRunId: "r1", stageRole: "planreview" },
    },
    runs: { r1: { runId: "r1" } as RunInfo },
};
const runAgents = [a("x", "idle"), a("lead", "idle"), a("w1", "working"), a("w2", "asking"), a("rev", "working")];

describe("floatTabs", () => {
    const t = (id: string) => a(id, "idle", "terminal");
    it("lists every agent in roster order, then every plain terminal", () => {
        const tabs = floatTabs([a("x", "idle"), a("y", "asking")], [t("t1"), t("t2")], "x");
        expect(ids(tabs.shown)).toEqual(["x", "y", "t1", "t2"]);
        expect(tabs.rest).toEqual([]);
    });
    it("reaches a plain terminal while an agent floats", () =>
        expect(ids(floatTabs([a("x", "idle")], [t("t1")], "x").shown)).toContain("t1"));
    it("lists a terminal once when it is also an agent's", () =>
        expect(ids(floatTabs([a("x", "idle"), a("y", "idle")], [a("x", "idle", "terminal")], "x").shown)).toEqual([
            "x",
            "y",
        ]));
    it("shows no tabs for a float with nothing to switch to", () =>
        expect(floatTabs([a("x", "idle")], [], "x")).toEqual({ shown: [], rest: [] }));
    it("cuts at FLOAT_TAB_MAX and keeps the rest for the +N menu", () => {
        const agents = "abcdefg".split("").map((id) => a(id, "idle"));
        const tabs = floatTabs(agents, [], "a");
        expect(tabs.shown).toHaveLength(FLOAT_TAB_MAX);
        expect(ids([...tabs.shown, ...tabs.rest])).toEqual("abcdefg".split(""));
    });
    it("keeps the tab in view among those shown past the cut", () => {
        const agents = "abcdefg".split("").map((id) => a(id, "idle"));
        const tabs = floatTabs(agents, [], "g");
        expect(ids(tabs.shown)).toContain("g");
        expect(ids(tabs.rest)).not.toContain("g");
    });
    it("shows a run as its lead, not as every session the run spawned", () => {
        const tabs = floatTabs(runAgents, [], "x", run);
        expect(ids(tabs.shown)).toEqual(["x", "lead"]);
        expect(tabs.rest).toEqual([]);
    });
    it("keeps a run's worker while it is the one in view", () =>
        expect(ids(floatTabs(runAgents, [], "w1", run).shown)).toEqual(["x", "lead", "w1"]));
    it("tabs a worker whose run the lineage does not hold", () => {
        const orphan: Lineage = { roles: { w1: { kind: "worker", leadRunId: "gone", taskId: "t1" } }, runs: {} };
        expect(ids(floatTabs([a("x", "idle"), a("w1", "idle")], [], "x", orphan).shown)).toEqual(["x", "w1"]);
    });
    it("does not bring a hidden worker back as a terminal", () =>
        expect(ids(floatTabs(runAgents, [a("w1", "idle", "terminal")], "x", run).shown)).toEqual(["x", "lead"]));
});

describe("stepFloatTab", () => {
    const agents = [a("x", "idle"), a("y", "idle")];
    const terminals = [a("t", "idle", "terminal")];
    it("steps from the last agent to the first terminal", () =>
        expect(stepFloatTab(agents, terminals, "y", 1)).toBe("t"));
    it("wraps around both ends", () => {
        expect(stepFloatTab(agents, terminals, "t", 1)).toBe("x");
        expect(stepFloatTab(agents, terminals, "x", -1)).toBe("t");
    });
    it("reaches tabs past the cut", () => {
        const many = "abcdefg".split("").map((id) => a(id, "idle"));
        expect(stepFloatTab(many, [], "f", 1)).toBe("g");
    });
    it("has nowhere to go with one tab", () => expect(stepFloatTab([a("x", "idle")], [], "x", 1)).toBeNull());
    it("skips a run's workers and stage sessions", () => {
        expect(stepFloatTab(runAgents, [], "lead", 1, run)).toBe("x");
        expect(stepFloatTab(runAgents, [], "x", -1, run)).toBe("lead");
    });
    it("steps on from a worker in view", () => expect(stepFloatTab(runAgents, [], "w1", 1, run)).toBe("x"));
});

describe("foldedList", () => {
    it("puts what needs you first, then what works, each in roster order", () => {
        const agents = [a("i1", "idle"), a("w1", "working"), a("q1", "asking"), a("w2", "working"), a("q2", "asking")];
        expect(ids(foldedList(agents, [], null).shown)).toEqual(["q1", "q2", "w1", "w2"]);
    });
    it("shows four and counts the rest as +N", () => {
        const agents = [a("i1", "idle"), ...["a", "b", "c", "d"].map((id) => a(id, "working"))];
        const list = foldedList(agents, [], null);
        expect(ids(list.shown)).toEqual(["a", "b", "c", "d"]);
        expect(list.more).toBe(1);
    });
    it("lists a floated terminal too", () => {
        expect(ids(foldedList([a("x", "idle")], [a("t", "idle", "terminal")], "t").shown)).toEqual(["t", "x"]);
    });
    it("is empty with no agents", () => expect(foldedList([], [], null)).toEqual({ shown: [], more: 0 }));
    it("leaves a run's workers and stage sessions to its lead", () =>
        expect(foldedList(runAgents, [], null, run)).toEqual({ shown: [runAgents[0], runAgents[1]], more: 0 }));
    it("keeps the worker in view", () =>
        expect(ids(foldedList(runAgents, [], "w2", run).shown)).toEqual(["w2", "x", "lead"]));
});

describe("workingCount", () => {
    it("counts the agents that are working, not those idle or asking", () => {
        expect(workingCount([a("x", "working"), a("y", "asking"), a("z", "working"), a("w", "idle")])).toBe(2);
        expect(workingCount([])).toBe(0);
    });
});
