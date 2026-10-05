// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { globalStore } from "@/app/store/jotaiStore";
import { atom } from "jotai";
import { beforeEach, describe, expect, it } from "vitest";
import { centerModeAtom } from "./agentcenter";
import { EMPTY_GRID, type GridState } from "./agentgrid";
import {
    agentGridAtom,
    canOpenInSplit,
    currentGrid,
    dropAgentOnGrid,
    openInSplit,
    removeFromGrid,
    type GridModel,
} from "./gridstore";

const g = (ids: string[], focused: string | null = ids[0] ?? null): GridState => ({ ids, focused });

// a roster of live agents, each with a terminal, and the surface's focus
function model(ids: string[], focus?: string): GridModel {
    return {
        focusIdAtom: atom<string | undefined>(focus),
        agentsAtom: atom(ids.map((id) => ({ id, blockId: `blk-${id}` }))),
    };
}

beforeEach(() => {
    globalStore.set(agentGridAtom, EMPTY_GRID);
    globalStore.set(centerModeAtom, "terminal");
});

describe("agentGridAtom", () => {
    it("reads back a repaired grid, not whatever was written", () => {
        globalStore.set(agentGridAtom, { ids: ["a", "a", "b"], focused: "gone" });
        expect(globalStore.get(agentGridAtom)).toEqual(g(["a", "b"], "a"));
    });
});

describe("currentGrid", () => {
    it("drops agents that are not live and keeps the rest in order", () => {
        globalStore.set(agentGridAtom, g(["a", "b", "c"]));
        expect(currentGrid(model(["a", "c"], "a"))).toEqual(g(["a", "c"], "a"));
    });
    it("does not count an agent with no terminal", () => {
        const m: GridModel = {
            focusIdAtom: atom<string | undefined>("a"),
            agentsAtom: atom([{ id: "a", blockId: "blk-a" }, { id: "p" }]),
        };
        globalStore.set(agentGridAtom, g(["a", "p"]));
        expect(currentGrid(m).ids).toEqual(["a"]);
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
});

describe("removeFromGrid", () => {
    it("hands focus, in the grid and on the surface, to the cell that takes the slot", () => {
        const m = model(["a", "b", "c"], "b");
        globalStore.set(agentGridAtom, g(["a", "b", "c"], "b"));
        removeFromGrid(m, "b");
        expect(globalStore.get(agentGridAtom)).toEqual(g(["a", "c"], "c"));
        expect(globalStore.get(m.focusIdAtom)).toBe("c");
    });
    it("keeps focus where it was when another cell goes", () => {
        const m = model(["a", "b", "c"], "a");
        globalStore.set(agentGridAtom, g(["a", "b", "c"], "a"));
        removeFromGrid(m, "c");
        expect(globalStore.get(agentGridAtom)).toEqual(g(["a", "b"], "a"));
        expect(globalStore.get(m.focusIdAtom)).toBe("a");
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
    it("inserts right after the focused cell", () => {
        const m = model(["a", "b", "c", "d"], "b");
        globalStore.set(agentGridAtom, g(["a", "b", "c"], "b"));
        expect(openInSplit(m, "d")).toBe(true);
        expect(globalStore.get(agentGridAtom)).toEqual(g(["a", "b", "d", "c"], "d"));
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
});
