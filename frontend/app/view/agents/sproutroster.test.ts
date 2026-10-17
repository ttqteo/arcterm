// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import type { AgentVM } from "./agentsviewmodel";
import { NO_LINEAGE, type Lineage, type RunInfo } from "./runlineage";
import { FLOAT_TAB_MAX, floatTabOrder, floatTabs, foldedList, workingCount } from "./sproutroster";

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
    it("shows the one agent's tab, the way back from Note and Translate", () =>
        expect(ids(floatTabs([a("x", "idle")], [], "x").shown)).toEqual(["x"]));
    it("shows no tabs when nothing floats", () => expect(floatTabs([], [], null)).toEqual({ shown: [], rest: [] }));
    it("leaves the translate terminal out of the ledge's tabs", () => {
        const trans = { ...t("tr"), toolId: "trans" } as AgentVM;
        const tabs = floatTabs([a("x", "idle")], [trans], "x");
        expect(ids(tabs.shown)).toEqual(["x"]);
        expect(tabs.rest).toEqual([]);
    });
    it("floatTabOrder keeps the translate terminal for the switcher", () => {
        const trans = { ...t("tr"), toolId: "trans" } as AgentVM;
        expect(ids(floatTabOrder([a("x", "idle")], [trans], "x", NO_LINEAGE))).toEqual(["x", "tr"]);
    });
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

describe("floatTabOrder", () => {
    const agents = [a("x", "idle"), a("y", "idle")];
    const terminals = [a("t", "idle", "terminal")];
    it("lists the agents, then the plain terminals", () =>
        expect(ids(floatTabOrder(agents, terminals, "y", NO_LINEAGE))).toEqual(["x", "y", "t"]));
    it("does not cut", () => {
        const many = "abcdefg".split("").map((id) => a(id, "idle"));
        expect(floatTabOrder(many, [], "a", NO_LINEAGE)).toHaveLength(7);
    });
    it("skips a run's workers and stage sessions", () =>
        expect(ids(floatTabOrder(runAgents, [], "lead", run))).toEqual(["x", "lead"]));
    it("keeps a worker in view", () => expect(ids(floatTabOrder(runAgents, [], "w1", run))).toContain("w1"));
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
