// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { HOME_PROJECT, type ProjectTreeRow } from "./agentsidebarmodel";
import type { AgentVM } from "./agentsviewmodel";
import { peekGroups, peekShown, peekStripItems } from "./treepeekmodel";

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

    it("draws a sleeping agent that kept its question as asking, and one asleep without it as before", () => {
        const kept = vm("kept", { state: "asking", sleeping: { since: 1, freedBytes: 0, asking: true } });
        const plain = vm("plain", { state: "asking", sleeping: { since: 1, freedBytes: 0 } });
        const idle = vm("idle", { sleeping: { since: 1, freedBytes: 0 } });
        const rows = [group("p"), parent(kept, "p"), parent(plain, "p"), parent(idle, "p")];
        expect(peekGroups(rows, byIdOf([kept, plain, idle]), nameOf)[0].rows).toMatchObject([
            { id: "kept", dot: "asking" },
            { id: "plain", dot: "idle" },
            { id: "idle", dot: "idle" },
        ]);
    });

    it("names the no-folder group as the tree does", () => {
        const t = vm("t", { kind: "terminal" });
        expect(peekGroups([group(HOME_PROJECT), terminal(t, HOME_PROJECT)], byIdOf([t]), nameOf)[0].label).toBe(
            "No folder"
        );
    });
});

describe("peekGroups with a split", () => {
    const place = { row: 1, col: 1, rowSpan: 1, colSpan: 1 };
    const board = { boardProject: "p", boardId: "x", name: "the board", chatId: "b", chat: "", activets: 0 };
    function splitRow(cells: AgentVM[], shown: boolean, withBoard: boolean): ProjectTreeRow {
        return {
            kind: "split",
            project: "p",
            shown,
            cells: [
                ...(withBoard ? [{ id: "board:p/x", place, board }] : []),
                ...cells.map((v) => ({ id: v.id, vm: v, place, menu: "agent" as const })),
            ],
        } as ProjectTreeRow;
    }

    it("lists a split's cells together in grid order, a board's cell among them with no digit", () => {
        const a = vm("a");
        const b = vm("b", { state: "working" });
        const c = vm("c");
        const rows = [group("p"), parent(a, "p"), splitRow([b], true, true), parent(c, "p")];
        const split = { key: "p", shown: true };
        expect(peekGroups(rows, byIdOf([a, b, c]), nameOf)[0].rows).toEqual([
            { id: "a", name: "name a", dot: "idle", terminal: false, digit: 1 },
            { id: "board:p/x", name: "the board", dot: "idle", terminal: false, split, board: { pick: "b" } },
            { id: "b", name: "name b", dot: "working", terminal: false, digit: 2, split },
            { id: "c", name: "name c", dot: "idle", terminal: false, digit: 3 },
        ]);
    });

    it("frames no split whose other cells the roster does not know", () => {
        const b = vm("b");
        const rows = [group("p"), splitRow([b, vm("gone")], false, false)];
        expect(peekGroups(rows, byIdOf([b]), nameOf)[0].rows).toEqual([
            { id: "b", name: "name b", dot: "idle", terminal: false, digit: 1 },
        ]);
    });
});

describe("peekStripItems", () => {
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
        expect(peekStripItems(groups)).toEqual([
            { key: "1", gapBefore: false, dots: [{ id: "1", dot: "idle", gapBefore: false, board: false }] },
            { key: "2", gapBefore: true, dots: [{ id: "2", dot: "asking", gapBefore: true, board: false }] },
            { key: "3", gapBefore: false, dots: [{ id: "3", dot: "working", gapBefore: false, board: false }] },
        ]);
    });

    it("runs a split's dots together, its board as a square", () => {
        const split = { key: "p", shown: true };
        const groups = [
            {
                project: "p",
                label: "p",
                rows: [
                    { id: "a", name: "", dot: "idle" as const, terminal: false },
                    { id: "b", name: "", dot: "working" as const, terminal: false, split },
                    { id: "board:p/x", name: "", dot: "idle" as const, terminal: false, split, board: { pick: "b" } },
                ],
            },
        ];
        expect(peekStripItems(groups)).toEqual([
            { key: "a", gapBefore: false, dots: [{ id: "a", dot: "idle", gapBefore: false, board: false }] },
            {
                key: "split:p:p",
                split,
                gapBefore: false,
                dots: [
                    { id: "b", dot: "working", gapBefore: false, board: false },
                    { id: "board:p/x", dot: "idle", gapBefore: false, board: true },
                ],
            },
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
