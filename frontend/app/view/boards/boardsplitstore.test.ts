import { beforeEach, describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => [] as string[]);
const grid = vi.hoisted(() => ({ ids: ["a1"] as string[] }));

vi.mock("../agents/agentview", () => ({
    setAgentView: (id: string, view: string) => calls.push(`view:${id}:${view}`),
}));
vi.mock("../agents/chatmodestore", () => ({
    setChatMode: (id: string, mode: string) => calls.push(`chat:${id}:${mode}`),
}));
vi.mock("../agents/gridstore", () => ({
    currentGrid: () => {
        calls.push("grid");
        return { ids: grid.ids };
    },
}));

import { globalStore } from "@/app/store/jotaiStore";
import { atom, type PrimitiveAtom } from "jotai";
import {
    boardSplitAtom,
    closeBoard,
    openBoard,
    setBoardExpanded,
    splitExpanded,
    splitOpens,
    switchBoard,
    type BoardOpenModel,
} from "./boardsplitstore";

const model: BoardOpenModel = {
    focusIdAtom: atom<string | undefined>(undefined) as PrimitiveAtom<string | undefined>,
    agentsAtom: atom([]),
    terminalsAtom: atom([]),
    openTerminal: (id) => calls.push(`focus:${id}`),
};

beforeEach(() => {
    calls.length = 0;
    grid.ids = ["a1"];
    for (const id of ["a1", "a2"]) {
        closeBoard(id);
    }
});

describe("splitOpens", () => {
    it("opens half the cell for a lone cell, and expanded in a grid of more than one", () => {
        expect(splitOpens(0)).toEqual({ expanded: false });
        expect(splitOpens(1)).toEqual({ expanded: false });
        expect(splitOpens(2)).toEqual({ expanded: true });
        expect(splitOpens(4)).toEqual({ expanded: true });
    });
});

describe("splitExpanded", () => {
    const split = (expanded: boolean) => ({ project: "arcterm", boardId: "b1", expanded });

    it("is what the split says in a lone cell", () => {
        expect(splitExpanded(split(false), false)).toBe(false);
        expect(splitExpanded(split(true), false)).toBe(true);
    });

    it("is always expanded in a grid of several cells, even one that grew after the board opened", () => {
        expect(splitExpanded(split(false), true)).toBe(true);
        expect(splitExpanded(split(true), true)).toBe(true);
    });
});

describe("openBoard", () => {
    it("focuses the agent, puts its terminal slot and Chat back, then opens the split", () => {
        openBoard(model, "a1", "arcterm", "b1");
        expect(calls).toEqual(["focus:a1", "view:a1:terminal", "chat:a1:chat", "grid"]);
        expect(globalStore.get(boardSplitAtom("a1"))).toEqual({ project: "arcterm", boardId: "b1", expanded: false });
    });

    it("reads the grid after the agent is in focus, so a cell of a split opens expanded", () => {
        grid.ids = ["a1", "a2"];
        openBoard(model, "a1", "arcterm", "b1");
        expect(calls.indexOf("focus:a1")).toBeLessThan(calls.indexOf("grid"));
        expect(globalStore.get(boardSplitAtom("a1"))?.expanded).toBe(true);
    });

    it("keeps each agent's split apart", () => {
        openBoard(model, "a1", "arcterm", "b1");
        expect(globalStore.get(boardSplitAtom("a2"))).toBeNull();
        openBoard(model, "a2", "arcterm", "b2");
        expect(globalStore.get(boardSplitAtom("a1"))?.boardId).toBe("b1");
        expect(globalStore.get(boardSplitAtom("a2"))?.boardId).toBe("b2");
    });

    it("opens a board again on top of the one beside Chat", () => {
        openBoard(model, "a1", "arcterm", "b1");
        setBoardExpanded("a1", true);
        openBoard(model, "a1", "arcterm", "b2");
        expect(globalStore.get(boardSplitAtom("a1"))).toEqual({ project: "arcterm", boardId: "b2", expanded: false });
    });
});

describe("closeBoard, setBoardExpanded, switchBoard", () => {
    it("closes back to Chat alone", () => {
        openBoard(model, "a1", "arcterm", "b1");
        closeBoard("a1");
        expect(globalStore.get(boardSplitAtom("a1"))).toBeNull();
    });

    it("expands and collapses an open split, and does nothing to a closed one", () => {
        setBoardExpanded("a1", true);
        expect(globalStore.get(boardSplitAtom("a1"))).toBeNull();
        openBoard(model, "a1", "arcterm", "b1");
        setBoardExpanded("a1", true);
        expect(globalStore.get(boardSplitAtom("a1"))?.expanded).toBe(true);
        setBoardExpanded("a1", false);
        expect(globalStore.get(boardSplitAtom("a1"))?.expanded).toBe(false);
    });

    it("switches the open split to another board, keeping its width", () => {
        switchBoard("a1", "b2");
        expect(globalStore.get(boardSplitAtom("a1"))).toBeNull();
        openBoard(model, "a1", "arcterm", "b1");
        setBoardExpanded("a1", true);
        switchBoard("a1", "b2");
        expect(globalStore.get(boardSplitAtom("a1"))).toEqual({ project: "arcterm", boardId: "b2", expanded: true });
    });
});
