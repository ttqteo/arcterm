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
import {
    agentGridAtom,
    currentGrid,
    dropAgentOnGrid,
    openInSplit,
    projectGridsAtom,
    removeFromGrid,
} from "../agents/gridstore";
import { boardEntriesAtom, openBoardsAtom } from "./boardentries";
import {
    boardMaxAtom,
    boardOpenAtom,
    closeBoard,
    hiddenBoardsAtom,
    openBoard,
    removeBoardFromList,
    setBoardMax,
    switchBoard,
    turnsFoldedAtom,
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
    globalStore.set(boardEntriesAtom, []);
    globalStore.set(hiddenBoardsAtom, {});
    globalStore.set(centerModeAtom, "terminal");
});

afterEach(() => {
    vi.unstubAllGlobals();
});

const B1 = { project: "arcterm", boardId: "b1" };
const B2 = { project: "arcterm", boardId: "b2" };
const open = () => [...globalStore.get(openBoardsAtom).keys()];

describe("openBoard", () => {
    it("focuses the agent, puts its terminal slot and Chat back, then opens the board", () => {
        const m = model(["a1"]);
        openBoard(m, "a1", "arcterm", "b1");
        expect(calls).toEqual(["focus:a1", "view:a1:terminal", "chat:a1:chat"]);
        expect(globalStore.get(boardOpenAtom("arcterm/b1"))).toBe(true);
    });

    it("gives a lone agent a board cell right of it", () => {
        const m = model(["a1"]);
        openBoard(m, "a1", "arcterm", "b1");
        expect(globalStore.get(agentGridAtom)).toEqual({ ids: ["a1", "board:arcterm/b1"], focused: "a1" });
        expect(globalStore.get(m.focusIdAtom)).toBe("a1");
    });

    it("opens a second board as a cell of its own: [agent | board | board]", () => {
        const m = model(["a1"]);
        openBoard(m, "a1", "arcterm", "b1");
        openBoard(m, "a1", "arcterm", "b2");
        expect(globalStore.get(agentGridAtom).ids).toEqual(
            expect.arrayContaining(["a1", "board:arcterm/b1", "board:arcterm/b2"])
        );
        expect(open()).toEqual(["arcterm/b1", "arcterm/b2"]);
    });

    it("keeps a board's cell when the chat it was opened from leaves the grid", () => {
        const m = model(["a1", "a2"]);
        openBoard(m, "a1", "arcterm", "b1");
        expect(openInSplit(m, "a2")).toBe(true);
        removeFromGrid(m, "a1");
        expect(globalStore.get(agentGridAtom).ids).toEqual(expect.arrayContaining(["a2", "board:arcterm/b1"]));
        expect(globalStore.get(agentGridAtom).ids).toHaveLength(2);
        expect(globalStore.get(agentGridAtom).focused).toBe("a2");
    });

    it("never focuses a board dropped on the grid: the focused cell keeps it", () => {
        const m = model(["a1", "a2"]);
        openBoard(m, "a1", "arcterm", "b1");
        expect(openInSplit(m, "a2")).toBe(true);
        dropAgentOnGrid(m, "board:arcterm/b1", 0, "left");
        expect(globalStore.get(agentGridAtom).ids[0]).toBe("board:arcterm/b1");
        expect(globalStore.get(m.focusIdAtom)).toBe("a2");
    });

    it("persists the open boards in localStorage under agent.openboards", () => {
        openBoard(model(["a1"]), "a1", "arcterm", "b1");
        expect(JSON.parse(stored.get("agent.openboards") ?? "null")).toEqual([B1]);
    });
});

describe("closeBoard", () => {
    it("closes the board and sheds its cell from the grid, the agent's staying", () => {
        const m = model(["a1"]);
        openBoard(m, "a1", "arcterm", "b1");
        closeBoard(m, B1);
        expect(globalStore.get(boardOpenAtom("arcterm/b1"))).toBe(false);
        expect(currentGrid(m).ids).toEqual(["a1"]);
        expect(globalStore.get(agentGridAtom).ids).toEqual(["a1"]);
    });

    it("clears Expand with it", () => {
        const m = model(["a1"]);
        openBoard(m, "a1", "arcterm", "b1");
        setBoardMax(B1, true);
        closeBoard(m, B1);
        expect(globalStore.get(boardMaxAtom("arcterm/b1"))).toBe(false);
    });
});

describe("switchBoard", () => {
    it("puts the other board in the same square and closes the first", () => {
        const m = model(["a1"]);
        openBoard(m, "a1", "arcterm", "b1");
        switchBoard(m, B1, "b2");
        expect(globalStore.get(agentGridAtom).ids).toEqual(["a1", "board:arcterm/b2"]);
        expect(open()).toEqual(["arcterm/b2"]);
    });

    it("keeps one cell when the other board is already open", () => {
        const m = model(["a1"]);
        openBoard(m, "a1", "arcterm", "b1");
        openBoard(m, "a1", "arcterm", "b2");
        switchBoard(m, B1, "b2");
        expect(globalStore.get(agentGridAtom).ids).toEqual(["a1", "board:arcterm/b2"]);
        expect(open()).toEqual(["arcterm/b2"]);
    });

    it("keeps an expanded cell expanded on the other board", () => {
        const m = model(["a1"]);
        openBoard(m, "a1", "arcterm", "b1");
        setBoardMax(B1, true);
        switchBoard(m, B1, "b2");
        expect(globalStore.get(boardMaxAtom("arcterm/b2"))).toBe(true);
        expect(globalStore.get(boardMaxAtom("arcterm/b1"))).toBe(false);
        setBoardMax(B2, false);
    });

    it("does nothing for the board it shows", () => {
        const m = model(["a1"]);
        openBoard(m, "a1", "arcterm", "b1");
        switchBoard(m, B1, "b1");
        expect(open()).toEqual(["arcterm/b1"]);
    });
});

describe("removeBoardFromList", () => {
    it("closes an open board, hides it with its activets, and opening it again shows it", () => {
        const m = model(["a1"]);
        openBoard(m, "a1", "arcterm", "b1");
        removeBoardFromList(m, B1, 42);
        expect(globalStore.get(boardOpenAtom("arcterm/b1"))).toBe(false);
        expect(globalStore.get(agentGridAtom).ids).toEqual(["a1"]);
        expect(globalStore.get(hiddenBoardsAtom)).toEqual({ "arcterm/b1": 42 });
        openBoard(m, "a1", "arcterm", "b1");
        expect(globalStore.get(hiddenBoardsAtom)).toEqual({});
    });
});

describe("boardMaxAtom", () => {
    it("is per board and starts off", () => {
        setBoardMax(B1, true);
        expect(globalStore.get(boardMaxAtom("arcterm/b1"))).toBe(true);
        expect(globalStore.get(boardMaxAtom("arcterm/b2"))).toBe(false);
        setBoardMax(B1, false);
    });
});

describe("turnsFoldedAtom", () => {
    it("is per board, starts open and is kept in localStorage", () => {
        expect(globalStore.get(turnsFoldedAtom("arcterm/b1"))).toBe(false);
        globalStore.set(turnsFoldedAtom("arcterm/b1"), true);
        expect(globalStore.get(turnsFoldedAtom("arcterm/b1"))).toBe(true);
        expect(globalStore.get(turnsFoldedAtom("arcterm/b2"))).toBe(false);
        expect(JSON.parse(stored.get("board.turns.folded") ?? "null")).toEqual({ "arcterm/b1": true });
        globalStore.set(turnsFoldedAtom("arcterm/b1"), false);
        expect(JSON.parse(stored.get("board.turns.folded") ?? "null")).toEqual({});
    });
});

describe("a stored entry that is not one", () => {
    it("is ignored rather than trusted", () => {
        globalStore.set(boardEntriesAtom, [{ project: 3 }, null, B2] as never);
        expect(open()).toEqual(["arcterm/b2"]);
    });
});
