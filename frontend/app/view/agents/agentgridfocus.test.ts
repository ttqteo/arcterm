// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The one focus rule: whatever writes focusIdAtom, AgentSurface reconciles the grid against it (reconcileGrid). The
// keyboard's ways in are modelled as the focus writes they make: the tab the Ctrl+Tab switcher opens
// (tabswitcherstore.ts openFromSwitcher) and the pure moveCursor that step (buildAgentBindings) is built on; the
// wrappers themselves, which read atoms, are not driven here.

import { describe, expect, it } from "vitest";
import { reconcileGrid, type GridState } from "./agentgrid";
import { moveCursor } from "./agentsviewmodel";
import { resolveShownAgent } from "./cockpitsurfacemodel";

const roster = ["a", "b", "c", "d", "e"];
const live = new Set(roster);
const g = (ids: string[], focused: string | null = ids[0] ?? null): GridState => ({ ids, focused });

// what the surface does after any write to focusIdAtom
const settle = (s: GridState, focusId: string | undefined, eligible: ReadonlySet<string> = live) =>
    reconcileGrid(s, { focusId, eligible, seeded: true });
// Ctrl+Tab: the switcher opens the tab picked, here the next one in the roster, wrapping
const ctrlTab = (s: GridState) => settle(s, roster[(roster.indexOf(s.focused ?? "") + 1) % roster.length]);
// the arrows and j/k: step() clamps at the ends of the order
const arrow = (s: GridState, delta: number) => settle(s, moveCursor(roster, s.focused ?? undefined, delta));

describe("Ctrl+Tab", () => {
    it("onto an agent that has a cell focuses that cell and leaves the layout alone", () => {
        expect(ctrlTab(g(["a", "b"], "a"))).toEqual(g(["a", "b"], "b"));
    });
    it("onto an agent with no cell shows it alone and keeps the split", () => {
        expect(settle(g(["a", "b"], "b"), "c")).toEqual(g(["a", "b"], "b"));
    });
    it("onto an agent with no cell, from a grid of one, moves the grid with it", () => {
        expect(ctrlTab(g(["b"], "b"))).toEqual(g(["c"], "c"));
    });
    it("wraps from the last agent to the first", () => {
        expect(ctrlTab(g(["a", "e"], "e"))).toEqual(g(["a", "e"], "a"));
    });
    it("round the whole roster the split never changes, and coming back to one of its cells shows it again", () => {
        const s = g(["a", "c"], "a");
        const trail = ["b", "c", "d", "e", "a"].map((id) => settle(s, id));
        expect(trail).toEqual([
            g(["a", "c"], "a"), // b is no cell: shown alone, the split kept as it was
            g(["a", "c"], "c"), // c is a cell: the split shows, focused on c
            g(["a", "c"], "a"),
            g(["a", "c"], "a"),
            g(["a", "c"], "a"),
        ]);
    });
});

describe("the arrows and j/k", () => {
    it("step the roster and follow the same rule", () => {
        expect(arrow(g(["a", "c"], "c"), -1)).toEqual(g(["a", "c"], "c"));
        expect(arrow(g(["a", "b"], "a"), 1)).toEqual(g(["a", "b"], "b"));
        expect(arrow(g(["b"], "b"), 1)).toEqual(g(["c"], "c"));
    });
    it("clamp at the ends, so the grid does not change there", () => {
        expect(arrow(g(["a", "e"], "e"), 1)).toEqual(g(["a", "e"], "e"));
        expect(arrow(g(["a", "b"], "a"), -1)).toEqual(g(["a", "b"], "a"));
    });
});

describe("a click on a tree row or a cell", () => {
    it("is the same rule: an agent in the split takes focus, any other shows alone and leaves the split", () => {
        const s = g(["a", "b", "c", "d"], "b");
        expect(settle(s, "e")).toEqual(s);
        expect(settle(s, "c")).toEqual(g(["a", "b", "c", "d"], "c"));
    });
});

describe("what is in focus", () => {
    // terminal ids are eligible beside the agents' (gridstore eligibleIds of both rosters)
    const withTerm = new Set([...roster, "term"]);
    it("a terminal with a block takes a cell by the agents' rule, and a done worker leaves the grid untouched", () => {
        const s = g(["a", "b"], "a");
        expect(settle(s, "term", withTerm)).toEqual(s);
        expect(settle(g(["a"], "a"), "term", withTerm)).toEqual(g(["term"], "term"));
        expect(settle(g(["a", "term"], "a"), "term", withTerm)).toEqual(g(["a", "term"], "term"));
        expect(settle(s, "ended-worker")).toEqual(s);
        expect(settle(settle(s, "ended-worker"), "b")).toEqual(g(["a", "b"], "b"));
    });
    it("a terminal that has no block is not a cell, so it leaves the grid untouched too", () => {
        const s = g(["a", "b"], "a");
        expect(settle(s, "term")).toEqual(s);
    });
});

describe("an agent that exits", () => {
    it("hands focus to the neighbouring cell, which the surface then resumes on", () => {
        const s = g(["a", "b", "c"], "b");
        const eligible = new Set(["a", "c"]);
        // the focused agent is gone, so nothing is in focus and the surface resolves what to show (firstInOrder is
        // "a" so that skipping the grid would be seen)
        const { agent } = resolveShownAgent({
            focused: undefined,
            agents: [{ id: "a" }, { id: "c" }],
            terminals: [],
            firstInOrder: "a",
            grid: s,
            eligible,
            seeded: true,
        });
        expect(agent?.id).toBe("c");
        // b leaves the top row, so a widens over it: a above, c below
        expect(settle(s, agent?.id, eligible)).toEqual({
            ...g(["a", "c"], "c"),
            places: [
                { row: 1, col: 1, rowSpan: 1, colSpan: 2 },
                { row: 2, col: 1, rowSpan: 1, colSpan: 2 },
            ],
        });
    });
});
