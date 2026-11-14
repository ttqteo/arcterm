// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import type { AgentVM } from "./agentsviewmodel";
import { NO_LINEAGE, type Lineage, type RunInfo } from "./runlineage";
import {
    FLOAT_TAB_MAX,
    floatTabOrder,
    floatTabs,
    floatTabUnits,
    foldedList,
    parseTabPins,
    withTabPin,
    workingCount,
    type FloatTab,
} from "./sproutroster";

const a = (id: string, state: AgentVM["state"], kind?: string): AgentVM =>
    ({ id, name: id, task: "", state, kind }) as AgentVM;
const ids = (list: AgentVM[]) => list.map((x) => x.id);
const tids = (list: FloatTab[]) => list.map((x) => x.agent.id);

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
        expect(tids(tabs.shown)).toEqual(["x", "y", "t1", "t2"]);
        expect(tabs.rest).toEqual([]);
    });
    it("reaches a plain terminal while an agent floats", () =>
        expect(tids(floatTabs([a("x", "idle")], [t("t1")], "x").shown)).toContain("t1"));
    it("lists a terminal once when it is also an agent's", () =>
        expect(tids(floatTabs([a("x", "idle"), a("y", "idle")], [a("x", "idle", "terminal")], "x").shown)).toEqual([
            "x",
            "y",
        ]));
    it("shows the one agent's tab, the way back from Translate", () =>
        expect(tids(floatTabs([a("x", "idle")], [], "x").shown)).toEqual(["x"]));
    it("shows no tabs when nothing floats", () => expect(floatTabs([], [], null)).toEqual({ shown: [], rest: [] }));
    it("shows a trans terminal opened from Setup → Tools as an ordinary tab", () => {
        const trans = { ...t("tr"), toolId: "trans" } as AgentVM;
        const tabs = floatTabs([a("x", "idle")], [trans], "x");
        expect(tids(tabs.shown)).toEqual(["x", "tr"]);
        expect(tabs.rest).toEqual([]);
        expect(ids(floatTabOrder([a("x", "idle")], [trans], "x", NO_LINEAGE))).toEqual(["x", "tr"]);
    });
    it("cuts at FLOAT_TAB_MAX and keeps the rest for the +N menu", () => {
        const agents = "abcdefg".split("").map((id) => a(id, "idle"));
        const tabs = floatTabs(agents, [], "a");
        expect(tabs.shown).toHaveLength(FLOAT_TAB_MAX);
        expect(tids([...tabs.shown, ...tabs.rest])).toEqual("abcdefg".split(""));
    });
    it("keeps the tab in view among those shown past the cut", () => {
        const agents = "abcdefg".split("").map((id) => a(id, "idle"));
        const tabs = floatTabs(agents, [], "g");
        expect(tids(tabs.shown)).toContain("g");
        expect(tids(tabs.rest)).not.toContain("g");
    });
    it("shows a run as its lead, not as every session the run spawned", () => {
        const tabs = floatTabs(runAgents, [], "x", run);
        expect(tids(tabs.shown)).toEqual(["x", "lead"]);
        expect(tabs.rest).toEqual([]);
    });
    it("stands the run's tab for its worker in view, with no tab of the worker's own", () => {
        const tabs = floatTabs(runAgents, [], "w1", run);
        expect(tids(tabs.shown)).toEqual(["x", "lead"]);
        expect(tabs.shown[1].members).toEqual(["lead", "w1", "w2", "rev"]);
    });
    it("shows a run whose lead is gone as one tab named by the run, opening the worker that most needs you", () => {
        const leadless: Lineage = { ...run, runs: { r1: { runId: "r1", title: "Fix tabs" } as RunInfo } };
        const tabs = floatTabs(runAgents.slice(2), [], null, { ...leadless, roles: { ...run.roles, lead: undefined } });
        expect(tabs.shown).toHaveLength(1);
        expect(tabs.shown[0]).toMatchObject({ key: "run:r1", label: "Fix tabs", members: ["w1", "w2", "rev"] });
        expect(tabs.shown[0].agent.id).toBe("w2");
    });
    it("folds a brainstorm's builder check and judge into the brainstorming agent's tab", () => {
        const owner = { ...a("b", "idle"), builderCheck: { runId: "rc" }, brainstormJudge: { runId: "rj" } } as AgentVM;
        const check = { ...a("c", "working"), runId: "rc" } as AgentVM;
        const judge = { ...a("j", "working"), runId: "rj" } as AgentVM;
        const tabs = floatTabs([check, owner, judge], [], "c");
        expect(tids(tabs.shown)).toEqual(["b"]);
        expect(tabs.shown[0].members).toEqual(["b", "c", "j"]);
    });
    it("tabs a worker whose run the lineage does not hold", () => {
        const orphan: Lineage = { roles: { w1: { kind: "worker", leadRunId: "gone", taskId: "t1" } }, runs: {} };
        expect(tids(floatTabs([a("x", "idle"), a("w1", "idle")], [], "x", orphan).shown)).toEqual(["x", "w1"]);
    });
    it("does not bring a hidden worker back as a terminal", () =>
        expect(tids(floatTabs(runAgents, [a("w1", "idle", "terminal")], "x", run).shown)).toEqual(["x", "lead"]));
    describe("pinned", () => {
        const six = "abcdef".split("").map((id) => a(id, "idle"));
        it("puts the pinned tabs first, in the order they were pinned", () => {
            const tabs = floatTabs(six.slice(0, 4), [], "a", NO_LINEAGE, Infinity, ["d", "b"]);
            expect(tids(tabs.shown)).toEqual(["d", "b", "a", "c"]);
            expect(tabs.shown.map((t) => !!t.pinned)).toEqual([true, true, false, false]);
        });
        it("never cuts a pinned tab, however little room there is", () => {
            const tabs = floatTabs(six, [], "e", NO_LINEAGE, 10, ["f", "c"]);
            expect(tids(tabs.shown)).toEqual(["f", "c", "e"]);
            expect(tids(tabs.rest)).toEqual(["a", "b", "d"]);
        });
        it("keeps the one in view in the last unpinned place past the cut", () => {
            const tabs = floatTabs(six, [], "e", NO_LINEAGE, 4 + 3 * 44 + 2 * 4 + 4 + 32, ["f"]);
            expect(tids(tabs.shown)).toEqual(["f", "a", "e"]);
        });
        it("ignores a pin whose tab is gone", () =>
            expect(tids(floatTabs(six.slice(0, 2), [], "a", NO_LINEAGE, Infinity, ["zz", "b"]).shown)).toEqual([
                "b",
                "a",
            ]));
        it("pins a run with no lead by its run, whichever worker stands for it", () => {
            const units = floatTabUnits(runAgents.slice(2), [], { ...run, roles: { ...run.roles, lead: undefined } });
            expect(withTabPin([], units[0].key, true, units)).toEqual(["run:r1"]);
        });
    });
    describe("in the room the ledge has", () => {
        const six = "abcdef".split("").map((id) => a(id, "idle"));
        // 4px inset, then 44px per tab and 4px between; "+N" takes 4px and 32px more
        it("shows every tab that fits", () =>
            expect(tids(floatTabs(six.slice(0, 3), [], "a", NO_LINEAGE, 4 + 3 * 44 + 2 * 4).shown)).toEqual([
                "a",
                "b",
                "c",
            ]));
        it("cuts to what fits beside +N and keeps the rest for its menu", () => {
            const tabs = floatTabs(six.slice(0, 3), [], "a", NO_LINEAGE, 4 + 3 * 44 + 2 * 4 - 1);
            expect(tids(tabs.shown)).toEqual(["a", "b"]);
            expect(tids(tabs.rest)).toEqual(["c"]);
        });
        it("never shows more than FLOAT_TAB_MAX, however wide", () =>
            expect(floatTabs(six, [], "a", NO_LINEAGE, 2000).shown).toHaveLength(FLOAT_TAB_MAX));
        it("keeps the one in view when only one fits", () =>
            expect(tids(floatTabs(six, [], "e", NO_LINEAGE, 10).shown)).toEqual(["e"]));
    });
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
    it("keeps a worker in view, right after its run's tab", () =>
        expect(ids(floatTabOrder(runAgents, [], "w1", run))).toEqual(["x", "lead", "w1"]));
});

describe("withTabPin", () => {
    const units = floatTabUnits([a("x", "idle"), a("y", "idle"), a("z", "idle")], [], NO_LINEAGE);
    it("adds a pin at the end", () => expect(withTabPin(["y"], "x", true, units)).toEqual(["y", "x"]));
    it("removes a pin", () => expect(withTabPin(["y", "x"], "y", false, units)).toEqual(["x"]));
    it("drops the pins of closed agents on any change", () =>
        expect(withTabPin(["gone", "y"], "z", true, units)).toEqual(["y", "z"]));
});

describe("parseTabPins", () => {
    it("reads a stored list", () => expect(parseTabPins('["a","b"]')).toEqual(["a", "b"]));
    it("reads nothing as no pins", () => expect(parseTabPins(null)).toEqual([]));
    it("drops what is not a string and survives junk", () => {
        expect(parseTabPins('["a",3,null]')).toEqual(["a"]);
        expect(parseTabPins("{nope")).toEqual([]);
        expect(parseTabPins('{"a":1}')).toEqual([]);
    });
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
