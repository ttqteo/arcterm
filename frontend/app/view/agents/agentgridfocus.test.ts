// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The one focus rule: whatever writes focusIdAtom, AgentSurface reconciles the grid against it (reconcileGrid). The
// keyboard's roster steps are modelled with the pure cycleId and moveCursor that cycleFocus (agents.tsx) and step
// (buildAgentBindings) are built on; the wrappers themselves, which read atoms, are not driven here.

import { describe, expect, it } from "vitest";
import { reconcileGrid, type GridState } from "./agentgrid";
import { cycleId, moveCursor } from "./agentsviewmodel";
import { resolveShownAgent } from "./cockpitsurfacemodel";

const roster = ["a", "b", "c", "d", "e"];
const live = new Set(roster);
const g = (ids: string[], focused: string | null = ids[0] ?? null): GridState => ({ ids, focused });

// what the surface does after any write to focusIdAtom
const settle = (s: GridState, focusId: string | undefined, eligible: ReadonlySet<string> = live) =>
    reconcileGrid(s, { focusId, eligible, seeded: true });
// Ctrl+Tab: cycleFocus wraps around the roster order
const ctrlTab = (s: GridState) => settle(s, cycleId(roster, s.focused ?? undefined, 1));
// the arrows and j/k: step() clamps at the ends of the order
const arrow = (s: GridState, delta: number) => settle(s, moveCursor(roster, s.focused ?? undefined, delta));

describe("Ctrl+Tab", () => {
    it("onto an agent that has a cell focuses that cell and leaves the layout alone", () => {
        expect(ctrlTab(g(["a", "b"], "a"))).toEqual(g(["a", "b"], "b"));
    });
    it("onto an agent with no cell replaces the focused cell", () => {
        expect(ctrlTab(g(["a", "b"], "b"))).toEqual(g(["a", "c"], "c"));
    });
    it("wraps from the last agent to the first", () => {
        expect(ctrlTab(g(["a", "e"], "e"))).toEqual(g(["a", "e"], "a"));
    });
    it("round the whole roster the grid never grows, and each step lands on the agent stepped to", () => {
        let s = g(["a", "b"], "a");
        const trail: GridState[] = [];
        for (let i = 0; i < 12; i++) {
            s = ctrlTab(s);
            trail.push(s);
        }
        expect(trail.every((t) => t.ids.length === 2)).toBe(true);
        expect(trail).toEqual([
            g(["a", "b"], "b"), // b has a cell: focus moves
            g(["a", "c"], "c"), // c has none: it takes b's cell
            g(["a", "d"], "d"),
            g(["a", "e"], "e"),
            g(["a", "e"], "a"), // wrapped to a, which has a cell
            g(["b", "e"], "b"), // b takes a's cell
            g(["c", "e"], "c"),
            g(["d", "e"], "d"),
            g(["d", "e"], "e"), // e has a cell
            g(["d", "a"], "a"), // wrapped to a, which takes e's cell
            g(["d", "b"], "b"),
            g(["d", "c"], "c"),
        ]);
    });
});

describe("the arrows and j/k", () => {
    it("step the roster and follow the same rule", () => {
        expect(arrow(g(["a", "c"], "c"), -1)).toEqual(g(["a", "b"], "b"));
        expect(arrow(g(["a", "b"], "a"), 1)).toEqual(g(["a", "b"], "b"));
    });
    it("clamp at the ends, so the grid does not change there", () => {
        expect(arrow(g(["a", "e"], "e"), 1)).toEqual(g(["a", "e"], "e"));
        expect(arrow(g(["a", "b"], "a"), -1)).toEqual(g(["a", "b"], "a"));
    });
});

describe("a click on a tree row or a cell", () => {
    it("is the same rule: an agent in the grid takes focus, any other replaces the focused cell", () => {
        const s = g(["a", "b", "c", "d"], "b");
        expect(settle(s, "e")).toEqual(g(["a", "e", "c", "d"], "e"));
        expect(settle(s, "c")).toEqual(g(["a", "b", "c", "d"], "c"));
    });
});

describe("what is in focus but is not a cell", () => {
    it("a terminal or a done worker leaves the grid untouched, and an agent brings it back", () => {
        const s = g(["a", "b"], "a");
        expect(settle(s, "term")).toEqual(s);
        expect(settle(settle(s, "term"), "b")).toEqual(g(["a", "b"], "b"));
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
        expect(settle(s, agent?.id, eligible)).toEqual(g(["a", "c"], "c"));
    });
});
