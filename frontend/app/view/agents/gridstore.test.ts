// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { globalStore } from "@/app/store/jotaiStore";
import { atom } from "jotai";
import { beforeEach, describe, expect, it } from "vitest";
import { centerModeAtom } from "./agentcenter";
import { EMPTY_PROJECT_GRIDS, type GridState } from "./agentgrid";
import {
    agentGridAtom,
    canOpenInSplit,
    currentGrid,
    dropAgentOnGrid,
    eligibleIds,
    endSplit,
    endSplitOf,
    isInSplit,
    openInSplit,
    projectGridsAtom,
    removeFromGrid,
    removeFromSplit,
    treeSplits,
    type GridModel,
} from "./gridstore";

const g = (ids: string[], focused: string | null = ids[0] ?? null): GridState => ({ ids, focused });

// a roster of live agents, each with a terminal, plain terminals beside them, and the surface's focus
function model(ids: string[], focus?: string, terminalIds: string[] = []): GridModel {
    return {
        focusIdAtom: atom<string | undefined>(focus),
        agentsAtom: atom(ids.map((id) => ({ id, blockId: `blk-${id}` }))),
        terminalsAtom: atom(terminalIds.map((id) => ({ id, blockId: `blk-${id}` }))),
    };
}

beforeEach(() => {
    globalStore.set(projectGridsAtom, EMPTY_PROJECT_GRIDS);
    globalStore.set(centerModeAtom, "terminal");
});

describe("agentGridAtom", () => {
    it("reads back a repaired grid, not whatever was written", () => {
        globalStore.set(agentGridAtom, { ids: ["a", "a", "b"], focused: "gone" });
        expect(globalStore.get(agentGridAtom)).toEqual(g(["a", "b"], "a"));
    });
});

describe("eligibleIds", () => {
    it("keeps the agents that have a terminal, in order, and drops the rest", () => {
        const agents = [
            { id: "a", blockId: "blk-a" },
            { id: "p" },
            { id: "q", blockId: undefined },
            { id: "b", blockId: "blk-b" },
        ];
        expect([...eligibleIds(agents)]).toEqual(["a", "b"]);
    });
    it("is empty for an empty roster", () => {
        expect(eligibleIds([]).size).toBe(0);
    });
    it("takes agents and terminals together, and skips a terminal with no block", () => {
        const agents = [{ id: "a", blockId: "blk-a" }];
        const terminals = [{ id: "t", blockId: "blk-t" }, { id: "q" }];
        expect([...eligibleIds([...agents, ...terminals])]).toEqual(["a", "t"]);
    });
});

describe("currentGrid", () => {
    it("drops agents that are not live and keeps the rest in order", () => {
        globalStore.set(agentGridAtom, g(["a", "b", "c"]));
        // b leaves the top row, so a widens over it
        expect(currentGrid(model(["a", "c"], "a"))).toEqual({
            ...g(["a", "c"], "a"),
            places: [
                { row: 1, col: 1, rowSpan: 1, colSpan: 2 },
                { row: 2, col: 1, rowSpan: 1, colSpan: 2 },
            ],
        });
    });
    it("does not count an agent with no terminal", () => {
        const m: GridModel = {
            focusIdAtom: atom<string | undefined>("a"),
            agentsAtom: atom([{ id: "a", blockId: "blk-a" }, { id: "p" }]),
            terminalsAtom: atom([{ id: "t", blockId: "blk-t" }, { id: "q" }]),
        };
        globalStore.set(agentGridAtom, g(["a", "p"]));
        expect(currentGrid(m).ids).toEqual(["a"]);
    });
    it("counts a terminal with a block as a cell, and not one without", () => {
        const m: GridModel = {
            focusIdAtom: atom<string | undefined>("a"),
            agentsAtom: atom([{ id: "a", blockId: "blk-a" }]),
            terminalsAtom: atom([{ id: "t", blockId: "blk-t" }, { id: "q" }]),
        };
        globalStore.set(agentGridAtom, g(["a", "t", "q"]));
        expect(currentGrid(m).ids).toEqual(["a", "t"]);
    });
    it("puts a focused terminal in the grid, as it does an agent", () => {
        expect(currentGrid(model(["a"], "t", ["t"]))).toEqual(g(["t"], "t"));
    });
    it("puts the focused live agent in the grid even when the stored one is empty", () => {
        expect(currentGrid(model(["a", "b"], "b"))).toEqual(g(["b"], "b"));
    });
});

describe("dropAgentOnGrid", () => {
    it("adds a cell, focuses it and moves the surface's focus to it", () => {
        const m = model(["a", "b"], "a");
        globalStore.set(agentGridAtom, g(["a"]));
        dropAgentOnGrid(m, "b", 0, "right");
        expect(globalStore.get(agentGridAtom)).toEqual(g(["a", "b"], "b"));
        expect(globalStore.get(m.focusIdAtom)).toBe("b");
    });
    it("starts from the agent on screen when the stored grid is empty", () => {
        const m = model(["a", "b"], "a");
        dropAgentOnGrid(m, "b", 0, "right");
        expect(globalStore.get(agentGridAtom)).toEqual(g(["a", "b"], "b"));
    });
    it("swaps two cells and focuses the dragged one", () => {
        const m = model(["a", "b", "c"], "a");
        globalStore.set(agentGridAtom, g(["a", "b", "c"], "a"));
        dropAgentOnGrid(m, "c", 0, "center");
        expect(globalStore.get(agentGridAtom)).toEqual(g(["c", "b", "a"], "c"));
        expect(globalStore.get(m.focusIdAtom)).toBe("c");
    });
    it("ignores an agent that is not live", () => {
        const m = model(["a"], "a");
        globalStore.set(agentGridAtom, g(["a"]));
        globalStore.set(centerModeAtom, "history");
        dropAgentOnGrid(m, "ghost", 0, "right");
        expect(globalStore.get(agentGridAtom)).toEqual(g(["a"]));
        expect(globalStore.get(m.focusIdAtom)).toBe("a");
        expect(globalStore.get(centerModeAtom)).toBe("history");
    });
    it("brings the terminal back over History, as every route that chooses an agent does", () => {
        const m = model(["a", "b"], "a");
        globalStore.set(agentGridAtom, g(["a"]));
        globalStore.set(centerModeAtom, "history");
        dropAgentOnGrid(m, "b", 0, "right");
        expect(globalStore.get(centerModeAtom)).toBe("terminal");
    });
    it("writes the surface's focus before the grid, so a subscriber never sees the new grid with the old focus", () => {
        const m = model(["a", "b"], "a");
        const focusWhenGridChanged: (string | undefined)[] = [];
        // subscribe first and seed second: mounting a subscriber on a storage atom re-reads storage, which in the
        // node environment (no localStorage) resets the stored value
        const unsub = globalStore.sub(agentGridAtom, () => focusWhenGridChanged.push(globalStore.get(m.focusIdAtom)));
        try {
            globalStore.set(agentGridAtom, g(["a"]));
            focusWhenGridChanged.length = 0;
            dropAgentOnGrid(m, "b", 0, "right");
            expect(focusWhenGridChanged).toEqual(["b"]);
        } finally {
            unsub();
        }
    });
});

describe("endSplit", () => {
    it("keeps only the focused cell, and the focused agent stays on screen", () => {
        const m = model(["a", "b", "c"], "b");
        globalStore.set(agentGridAtom, g(["a", "b", "c"], "b"));
        endSplit(m);
        expect(globalStore.get(agentGridAtom)).toEqual(g(["b"], "b"));
        expect(globalStore.get(m.focusIdAtom)).toBe("b");
    });
    it("leaves a grid that is not split, and the centre, alone", () => {
        const m = model(["a", "b"], "a");
        globalStore.set(agentGridAtom, g(["a"], "a"));
        globalStore.set(centerModeAtom, "history");
        endSplit(m);
        expect(globalStore.get(agentGridAtom)).toEqual(g(["a"], "a"));
        expect(globalStore.get(centerModeAtom)).toBe("history");
    });
});

describe("removeFromGrid", () => {
    it("hands focus, in the grid and on the surface, to the cell that takes the slot", () => {
        const m = model(["a", "b", "c"], "b");
        globalStore.set(agentGridAtom, g(["a", "b", "c"], "b"));
        removeFromGrid(m, "b");
        expect(globalStore.get(agentGridAtom)).toEqual({
            ...g(["a", "c"], "c"),
            places: [
                { row: 1, col: 1, rowSpan: 1, colSpan: 2 },
                { row: 2, col: 1, rowSpan: 1, colSpan: 2 },
            ],
        });
        expect(globalStore.get(m.focusIdAtom)).toBe("c");
    });
    it("keeps focus where it was when another cell goes", () => {
        const m = model(["a", "b", "c"], "a");
        globalStore.set(agentGridAtom, g(["a", "b", "c"], "a"));
        removeFromGrid(m, "c");
        expect(globalStore.get(agentGridAtom)).toEqual(g(["a", "b"], "a"));
        expect(globalStore.get(m.focusIdAtom)).toBe("a");
    });
    it("leaves the grid, the focus and the centre alone for an agent that has no cell", () => {
        const m = model(["a", "b", "c"], "a");
        globalStore.set(agentGridAtom, g(["a", "b"], "a"));
        globalStore.set(centerModeAtom, "history");
        removeFromGrid(m, "c"); // live, but not a cell
        removeFromGrid(m, "ghost");
        expect(globalStore.get(agentGridAtom)).toEqual(g(["a", "b"], "a"));
        expect(globalStore.get(m.focusIdAtom)).toBe("a");
        expect(globalStore.get(centerModeAtom)).toBe("history");
    });
});

describe("openInSplit", () => {
    it("adds the agent beside the focused cell and focuses it", () => {
        const m = model(["a", "b"], "a");
        globalStore.set(agentGridAtom, g(["a"]));
        expect(openInSplit(m, "b")).toBe(true);
        expect(globalStore.get(agentGridAtom)).toEqual(g(["a", "b"], "b"));
        expect(globalStore.get(m.focusIdAtom)).toBe("b");
    });
    it("starts from the agent on screen when the stored grid is empty", () => {
        const m = model(["a", "b"], "a");
        expect(openInSplit(m, "b")).toBe(true);
        expect(globalStore.get(agentGridAtom)).toEqual(g(["a", "b"], "b"));
    });
    it("splits the cell that can when the focused one cannot (a one-square cell)", () => {
        const m = model(["a", "b", "c", "d"], "b");
        globalStore.set(agentGridAtom, g(["a", "b", "c"], "b"));
        expect(openInSplit(m, "d")).toBe(true);
        expect(globalStore.get(agentGridAtom)).toEqual(g(["a", "b", "c", "d"], "d"));
    });
    it("does nothing for an agent that already has a cell, on a full grid, or for a ghost", () => {
        const m = model(["a", "b", "c", "d", "e"], "a");
        globalStore.set(agentGridAtom, g(["a", "b", "c", "d"], "a"));
        globalStore.set(centerModeAtom, "history");
        expect(openInSplit(m, "e")).toBe(false);
        expect(openInSplit(m, "b")).toBe(false);
        expect(openInSplit(m, "ghost")).toBe(false);
        expect(globalStore.get(agentGridAtom)).toEqual(g(["a", "b", "c", "d"], "a"));
        expect(globalStore.get(centerModeAtom)).toBe("history");
    });
    it("brings the terminal back over History when it opens the split", () => {
        const m = model(["a", "b"], "a");
        globalStore.set(agentGridAtom, g(["a"]));
        globalStore.set(centerModeAtom, "session");
        expect(openInSplit(m, "b")).toBe(true);
        expect(globalStore.get(centerModeAtom)).toBe("terminal");
    });
    it("opens a terminal beside the focused agent and focuses it", () => {
        const m = model(["a", "b"], "a", ["t"]);
        globalStore.set(agentGridAtom, g(["a", "b"], "a"));
        expect(openInSplit(m, "t")).toBe(true);
        // a is one square wide, so it splits along its height: t under it, b keeping the right column
        expect(globalStore.get(agentGridAtom)).toEqual({
            ...g(["a", "b", "t"], "t"),
            places: [
                { row: 1, col: 1, rowSpan: 1, colSpan: 1 },
                { row: 1, col: 2, rowSpan: 2, colSpan: 1 },
                { row: 2, col: 1, rowSpan: 1, colSpan: 1 },
            ],
        });
        expect(globalStore.get(m.focusIdAtom)).toBe("t");
    });
});

describe("a terminal as a cell", () => {
    it("can be dropped on a cell, and takes it by the agents' rule", () => {
        const m = model(["a", "b"], "a", ["t"]);
        globalStore.set(agentGridAtom, g(["a", "b"], "a"));
        dropAgentOnGrid(m, "t", 1, "center");
        expect(globalStore.get(agentGridAtom)).toEqual(g(["a", "t"], "t"));
        expect(globalStore.get(m.focusIdAtom)).toBe("t");
    });
    it("leaves a terminal with no block alone", () => {
        const m: GridModel = {
            focusIdAtom: atom<string | undefined>("a"),
            agentsAtom: atom([{ id: "a", blockId: "blk-a" }]),
            terminalsAtom: atom([{ id: "q" }]),
        };
        globalStore.set(agentGridAtom, g(["a"]));
        dropAgentOnGrid(m, "q", 0, "right");
        expect(canOpenInSplit(m, "q")).toBe(false);
        expect(globalStore.get(agentGridAtom)).toEqual(g(["a"]));
    });
    it("goes with the x on its cell, the shell keeps running", () => {
        const m = model(["a"], "a", ["t"]);
        globalStore.set(agentGridAtom, g(["a", "t"], "t"));
        removeFromGrid(m, "t");
        expect(globalStore.get(agentGridAtom)).toEqual(g(["a"], "a"));
    });
});

describe("canOpenInSplit", () => {
    it("is true for a live agent with no cell and room in the grid", () => {
        const m = model(["a", "b"], "a");
        globalStore.set(agentGridAtom, g(["a"]));
        expect(canOpenInSplit(m, "b")).toBe(true);
    });
    it("is false for an agent that is a cell, a ghost, or when the grid is full", () => {
        const m = model(["a", "b", "c", "d", "e"], "a");
        globalStore.set(agentGridAtom, g(["a", "b", "c", "d"], "a"));
        expect(canOpenInSplit(m, "a")).toBe(false);
        expect(canOpenInSplit(m, "e")).toBe(false);
        expect(canOpenInSplit(m, "ghost")).toBe(false);
    });
    it("is true for a live terminal with a block", () => {
        const m = model(["a"], "a", ["t"]);
        globalStore.set(agentGridAtom, g(["a"]));
        expect(canOpenInSplit(m, "t")).toBe(true);
    });
});

describe("one grid per project", () => {
    // agents a, b in project x; c and terminal t in project y; terminal h names no project (Home)
    function projectModel(focus: string): GridModel {
        return {
            focusIdAtom: atom<string | undefined>(focus),
            agentsAtom: atom([
                { id: "a", blockId: "blk-a", project: "x" },
                { id: "b", blockId: "blk-b", project: "x" },
                { id: "c", blockId: "blk-c", project: "y" },
            ]),
            terminalsAtom: atom([
                { id: "t", blockId: "blk-t", project: "y" },
                { id: "h", blockId: "blk-h" },
            ]),
        };
    }

    it("opens a tab of the focused tab's project in the split, and not another project's", () => {
        const m = projectModel("a");
        expect(canOpenInSplit(m, "b")).toBe(true);
        expect(canOpenInSplit(m, "c")).toBe(false);
        expect(canOpenInSplit(m, "t")).toBe(false);
        expect(canOpenInSplit(m, "h")).toBe(false);
        expect(openInSplit(m, "c")).toBe(false);
        expect(currentGrid(m)).toEqual(g(["a"]));
    });
    it("does not drop another project's tab on the grid", () => {
        const m = projectModel("a");
        dropAgentOnGrid(m, "t", 0, "right");
        expect(currentGrid(m)).toEqual(g(["a"]));
        expect(globalStore.get(m.focusIdAtom)).toBe("a");
    });
    it("shows each project's own split, and keeps the other's while away", () => {
        const onX = projectModel("a");
        openInSplit(onX, "b");
        const onY = projectModel("c");
        expect(currentGrid(onY)).toEqual(g(["c"]));
        openInSplit(onY, "t");
        expect(currentGrid(onY)).toEqual(g(["c", "t"], "t"));
        expect(currentGrid(projectModel("b"))).toEqual(g(["a", "b"], "b"));
        expect(globalStore.get(projectGridsAtom).grids).toEqual({ x: g(["a", "b"], "b"), y: g(["c", "t"], "t") });
    });
    it("gives the terminals with no project a split of their own", () => {
        const m = projectModel("h");
        expect(currentGrid(m)).toEqual(g(["h"]));
        expect(canOpenInSplit(m, "a")).toBe(false);
    });
});

describe("splits of another project", () => {
    // a and b are project p's, c and d project q's; q's split is shown
    function twoProjects(focus: string): GridModel {
        return {
            focusIdAtom: atom<string | undefined>(focus),
            agentsAtom: atom([
                { id: "a", blockId: "blk-a", project: "p" },
                { id: "b", blockId: "blk-b", project: "p" },
                { id: "c", blockId: "blk-c", project: "q" },
                { id: "d", blockId: "blk-d", project: "q" },
            ]),
            terminalsAtom: atom([]),
        };
    }
    beforeEach(() => {
        globalStore.set(projectGridsAtom, { project: "q", grids: { p: g(["a", "b"]), q: g(["c", "d"]) } });
    });

    it("isInSplit is true for a cell of a split not on screen", () => {
        expect(isInSplit(twoProjects("c"), "a")).toBe(true);
    });
    it("removeFromSplit takes a cell out of its own project's split and leaves the focus", () => {
        const m = twoProjects("c");
        removeFromSplit(m, "a");
        expect(globalStore.get(projectGridsAtom).grids.p.ids).toEqual(["b"]);
        expect(globalStore.get(projectGridsAtom).grids.q.ids).toEqual(["c", "d"]);
        expect(globalStore.get(m.focusIdAtom)).toBe("c");
    });
    it("removeFromSplit on the shown split is removeFromGrid", () => {
        const m = twoProjects("c");
        removeFromSplit(m, "d");
        expect(globalStore.get(projectGridsAtom).grids.q.ids).toEqual(["c"]);
    });
    it("endSplitOf keeps only the focused cell of the cell's project", () => {
        const m = twoProjects("c");
        endSplitOf(m, "b");
        expect(globalStore.get(projectGridsAtom).grids.p.ids).toEqual(["a"]);
        expect(globalStore.get(projectGridsAtom).grids.q.ids).toEqual(["c", "d"]);
        expect(globalStore.get(m.focusIdAtom)).toBe("c");
    });
    it("endSplitOf on the shown split is endSplit: the focused cell stays", () => {
        const m = twoProjects("c");
        endSplitOf(m, "d");
        expect(globalStore.get(projectGridsAtom).grids.q.ids).toEqual(["c"]);
        expect(globalStore.get(projectGridsAtom).grids.p.ids).toEqual(["a", "b"]);
        expect(globalStore.get(m.focusIdAtom)).toBe("c");
    });
});

describe("treeSplits", () => {
    it("reconciles every grid against the roster, the docked terminal pruned", () => {
        const grids = { project: "p", grids: { p: g(["a", "t"]) } };
        const out = treeSplits(grids, {
            focusId: "a",
            agents: [{ id: "a", blockId: "blk-a", project: "p" }],
            terminals: [{ id: "t", blockId: "blk-t", project: "p" }],
            dockedId: "t",
            seeded: true,
        });
        expect(out.grids.p.ids).toEqual(["a"]);
    });
});
