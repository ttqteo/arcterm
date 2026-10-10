// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import type { AgentVM } from "./agentsviewmodel";
import { foldedList, switcherAgents } from "./sproutroster";

const a = (id: string, state: AgentVM["state"], kind?: string): AgentVM =>
    ({ id, name: id, task: "", state, kind }) as AgentVM;
const ids = (list: AgentVM[]) => list.map((x) => x.id);

describe("switcherAgents", () => {
    it("lists every agent in roster order", () => {
        const agents = [a("x", "idle"), a("y", "asking"), a("z", "working")];
        expect(switcherAgents(agents, [], "x")).toEqual({ shown: agents, more: 0 });
    });
    it("leads with a floated terminal, which is not an agent", () => {
        expect(ids(switcherAgents([a("x", "idle")], [a("t", "idle", "terminal")], "t").shown)).toEqual(["t", "x"]);
    });
    it("cuts at six and counts the rest", () => {
        const agents = "abcdefgh".split("").map((id) => a(id, "idle"));
        const cut = switcherAgents(agents, [], "a");
        expect(ids(cut.shown)).toEqual(["a", "b", "c", "d", "e", "f"]);
        expect(cut.more).toBe(2);
    });
    it("keeps the agent in view among the dots past the cut", () => {
        const agents = "abcdefgh".split("").map((id) => a(id, "idle"));
        expect(ids(switcherAgents(agents, [], "h").shown)).toEqual(["a", "b", "c", "d", "e", "h"]);
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
});
