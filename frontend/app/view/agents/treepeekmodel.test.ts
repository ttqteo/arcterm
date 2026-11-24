// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { HOME_PROJECT, type ProjectTreeRow } from "./agentsidebarmodel";
import type { AgentVM } from "./agentsviewmodel";
import { peekDots, peekGroups, peekShown } from "./treepeekmodel";

function vm(id: string, over: Partial<AgentVM> = {}): AgentVM {
    return { id, name: `name ${id}`, task: "", state: "idle", ...over };
}

function group(project: string): ProjectTreeRow {
    return { kind: "group", project, agents: 0, terminals: 0, services: 0, attn: 0, running: 0, open: true };
}

function parent(agent: AgentVM, project: string): ProjectTreeRow {
    return { kind: "parent", agent, project } as ProjectTreeRow;
}

function terminal(t: AgentVM, project: string): ProjectTreeRow {
    return { kind: "terminal", project, terminal: t };
}

const byIdOf = (vms: AgentVM[]) => new Map(vms.map((v) => [v.id, v]));
const nameOf = (v: AgentVM) => v.name;

describe("peekGroups", () => {
    it("groups rows by project folder in the tree's order, with their state", () => {
        const a = vm("a", { state: "working" });
        const b = vm("b", { state: "asking" });
        const c = vm("c", { sleeping: { since: 1, freedBytes: 0 } });
        const t = vm("t", { kind: "terminal", running: true });
        const rows = [
            group("arcterm"),
            parent(a, "arcterm"),
            group("thesis"),
            parent(b, "thesis"),
            parent(c, "thesis"),
            { kind: "divider", project: "thesis" } as ProjectTreeRow,
            terminal(t, "thesis"),
        ];
        expect(peekGroups(rows, byIdOf([a, b, c, t]), nameOf)).toEqual([
            {
                project: "arcterm",
                label: "arcterm",
                rows: [{ id: "a", name: "name a", dot: "working", terminal: false, digit: 1 }],
            },
            {
                project: "thesis",
                label: "thesis",
                rows: [
                    { id: "b", name: "name b", dot: "asking", terminal: false, digit: 2 },
                    { id: "c", name: "name c", dot: "idle", terminal: false, digit: 3 },
                    { id: "t", name: "name t", dot: "working", terminal: true, digit: 4 },
                ],
            },
        ]);
    });

    it("keeps an unknown id's place in the digit count, so a digit is the Alt+N that reaches its row", () => {
        const a = vm("a");
        const rows = [
            group("p"),
            { kind: "service", project: "p", serviceId: "s", tabId: "svc" } as ProjectTreeRow,
            parent(a, "p"),
        ];
        expect(peekGroups(rows, byIdOf([a]), nameOf)[0].rows[0].digit).toBe(2);
    });

    it("numbers only the first nine and leaves out a folder with no rows", () => {
        const vms = Array.from({ length: 10 }, (_, i) => vm(`a${i}`));
        const rows = [group("folded"), group("p"), ...vms.map((v) => parent(v, "p"))];
        const groups = peekGroups(rows, byIdOf(vms), nameOf);
        expect(groups.map((g) => g.project)).toEqual(["p"]);
        expect(groups[0].rows.map((r) => r.digit)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, undefined]);
    });

    it("marks an agent with unread turns, which an asking one still outranks", () => {
        const a = vm("a");
        const b = vm("b", { state: "working" });
        const c = vm("c", { state: "asking" });
        const d = vm("d", { sleeping: { since: 1, freedBytes: 0 } });
        const rows = [group("p"), parent(a, "p"), parent(b, "p"), parent(c, "p"), parent(d, "p")];
        const unread = new Map([
            ["a", 2],
            ["b", 1],
            ["c", 1],
            ["d", 3],
        ]);
        expect(peekGroups(rows, byIdOf([a, b, c, d]), nameOf, unread)[0].rows).toMatchObject([
            { id: "a", dot: "unread", unread: 2 },
            { id: "b", dot: "unread", unread: 1 },
            { id: "c", dot: "asking", unread: 1 },
            { id: "d", dot: "unread", unread: 3 },
        ]);
    });

    it("names the no-folder group as the tree does", () => {
        const t = vm("t", { kind: "terminal" });
        expect(peekGroups([group(HOME_PROJECT), terminal(t, HOME_PROJECT)], byIdOf([t]), nameOf)[0].label).toBe(
            "No folder"
        );
    });
});

describe("peekDots", () => {
    it("marks where a new project starts", () => {
        const groups = [
            { project: "a", label: "a", rows: [{ id: "1", name: "", dot: "idle" as const, terminal: false }] },
            {
                project: "b",
                label: "b",
                rows: [
                    { id: "2", name: "", dot: "asking" as const, terminal: false },
                    { id: "3", name: "", dot: "working" as const, terminal: false },
                ],
            },
        ];
        expect(peekDots(groups)).toEqual([
            { id: "1", dot: "idle", gapBefore: false },
            { id: "2", dot: "asking", gapBefore: true },
            { id: "3", dot: "working", gapBefore: false },
        ]);
    });
});

describe("peekShown", () => {
    it("shows only on a folded tree, on a pause or with Alt held", () => {
        expect(peekShown({ folded: true, hoverOpen: true, altHeld: false })).toBe(true);
        expect(peekShown({ folded: true, hoverOpen: false, altHeld: true })).toBe(true);
        expect(peekShown({ folded: true, hoverOpen: false, altHeld: false })).toBe(false);
        expect(peekShown({ folded: false, hoverOpen: true, altHeld: true })).toBe(false);
    });
});
