import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => [] as string[]);

vi.mock("../agents/agentview", () => ({
    setAgentView: (id: string, view: string) => calls.push(`view:${id}:${view}`),
}));
vi.mock("../agents/chatmodestore", () => ({
    setChatMode: (id: string, mode: string) => calls.push(`chat:${id}:${mode}`),
}));

import { globalStore } from "@/app/store/jotaiStore";
import { atom, type PrimitiveAtom } from "jotai";
import { centerModeAtom } from "../agents/agentcenter";
import { EMPTY_PROJECT_GRIDS } from "../agents/agentgrid";
import { agentGridAtom, currentGrid, projectGridsAtom, removeBoardCell } from "../agents/gridstore";
import { boardEntriesAtom, openBoardIdsAtom } from "./boardentries";
import {
    boardMaxAtom,
    boardSplitAtom,
    closeBoard,
    openBoard,
    pruneBoardEntries,
    setBoardMax,
    switchBoard,
    type BoardOpenModel,
} from "./boardsplitstore";

// a roster of live agents in one project, each with a terminal; focusing an agent is what openTerminal does
function model(ids: string[]): BoardOpenModel {
    const focusIdAtom = atom<string | undefined>(undefined) as PrimitiveAtom<string | undefined>;
    return {
        focusIdAtom,
        agentsAtom: atom(ids.map((id) => ({ id, blockId: `blk-${id}`, project: "arcterm" }))),
        terminalsAtom: atom([]),
        openTerminal: (id) => {
            calls.push(`focus:${id}`);
            globalStore.set(focusIdAtom, id);
        },
    };
}

// The node environment has no localStorage, so a Map-backed one stands in as window.localStorage (jotai reads it per call).
const stored = new Map<string, string>();

beforeEach(() => {
    stored.clear();
    vi.stubGlobal("window", {
        localStorage: {
            getItem: (k: string) => stored.get(k) ?? null,
            setItem: (k: string, v: string) => void stored.set(k, v),
            removeItem: (k: string) => void stored.delete(k),
        },
    });
    calls.length = 0;
    globalStore.set(projectGridsAtom, EMPTY_PROJECT_GRIDS);
    globalStore.set(boardEntriesAtom, {});
    globalStore.set(centerModeAtom, "terminal");
});

afterEach(() => {
    vi.unstubAllGlobals();
});

describe("openBoard", () => {
    it("focuses the agent, puts its terminal slot and Chat back, then opens the board", () => {
        const m = model(["a1"]);
        openBoard(m, "a1", "arcterm", "b1");
        expect(calls).toEqual(["focus:a1", "view:a1:terminal", "chat:a1:chat"]);
        expect(globalStore.get(boardSplitAtom("a1"))).toEqual({ project: "arcterm", boardId: "b1" });
    });

    it("gives a lone agent a board cell right of it", () => {
        const m = model(["a1"]);
        openBoard(m, "a1", "arcterm", "b1");
        expect(globalStore.get(agentGridAtom)).toEqual({ ids: ["a1", "board:a1"], focused: "a1" });
        expect(globalStore.get(m.focusIdAtom)).toBe("a1");
    });

    it("keeps one board cell when another board of the agent opens, and switches the board", () => {
        const m = model(["a1"]);
        openBoard(m, "a1", "arcterm", "b1");
        openBoard(m, "a1", "arcterm", "b2");
        expect(globalStore.get(agentGridAtom).ids).toEqual(["a1", "board:a1"]);
        expect(globalStore.get(boardSplitAtom("a1"))?.boardId).toBe("b2");
    });

    it("keeps each agent's board apart", () => {
        const m = model(["a1", "a2"]);
        openBoard(m, "a1", "arcterm", "b1");
        expect(globalStore.get(boardSplitAtom("a2"))).toBeNull();
        openBoard(m, "a2", "arcterm", "b2");
        expect(globalStore.get(boardSplitAtom("a1"))?.boardId).toBe("b1");
        expect(globalStore.get(boardSplitAtom("a2"))?.boardId).toBe("b2");
    });

    it("persists the entry in localStorage under agent.boards, with no expanded field", () => {
        openBoard(model(["a1"]), "a1", "arcterm", "b1");
        expect(JSON.parse(stored.get("agent.boards") ?? "null")).toEqual({
            a1: { project: "arcterm", boardId: "b1" },
        });
    });
});

describe("closeBoard", () => {
    it("clears the entry, so the board cell no longer holds a place in the grid", () => {
        const m = model(["a1"]);
        openBoard(m, "a1", "arcterm", "b1");
        closeBoard("a1");
        expect(globalStore.get(boardSplitAtom("a1"))).toBeNull();
        expect(currentGrid(m).ids).toEqual(["a1"]);
    });

    it("clears Expand with it", () => {
        openBoard(model(["a1"]), "a1", "arcterm", "b1");
        setBoardMax("a1", true);
        closeBoard("a1");
        expect(globalStore.get(boardMaxAtom("a1"))).toBe(false);
    });

    it("then removeBoardCell sheds the cell from the stored grid and leaves the agent's", () => {
        const m = model(["a1"]);
        openBoard(m, "a1", "arcterm", "b1");
        closeBoard("a1");
        removeBoardCell(m, "a1");
        expect(globalStore.get(agentGridAtom).ids).toEqual(["a1"]);
    });
});

describe("switchBoard", () => {
    it("switches the open board to another, and does nothing to a closed one", () => {
        switchBoard("a1", "b2");
        expect(globalStore.get(boardSplitAtom("a1"))).toBeNull();
        openBoard(model(["a1"]), "a1", "arcterm", "b1");
        switchBoard("a1", "b2");
        expect(globalStore.get(boardSplitAtom("a1"))).toEqual({ project: "arcterm", boardId: "b2" });
    });
});

describe("boardMaxAtom", () => {
    it("is per agent and starts off", () => {
        setBoardMax("a1", true);
        expect(globalStore.get(boardMaxAtom("a1"))).toBe(true);
        expect(globalStore.get(boardMaxAtom("a2"))).toBe(false);
        setBoardMax("a1", false);
    });
});

describe("pruneBoardEntries", () => {
    it("drops the entries of agents that are not live", () => {
        const m = model(["a1", "a2"]);
        openBoard(m, "a1", "arcterm", "b1");
        openBoard(m, "a2", "arcterm", "b2");
        pruneBoardEntries(new Set(["a2"]));
        expect([...globalStore.get(openBoardIdsAtom)]).toEqual(["a2"]);
        pruneBoardEntries(new Set());
        expect(globalStore.get(openBoardIdsAtom).size).toBe(0);
        expect(JSON.parse(stored.get("agent.boards") ?? "null")).toEqual({});
    });
});

describe("a stored entry that is not one", () => {
    it("is ignored rather than trusted", () => {
        globalStore.set(boardEntriesAtom, {
            a1: { project: 3 },
            a2: null,
            a3: { project: "p", boardId: "b" },
        } as never);
        expect([...globalStore.get(openBoardIdsAtom)]).toEqual(["a3"]);
    });
});
