import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.hoisted(() => ({ BoardDeleteCommand: vi.fn() }));
const toasts = vi.hoisted(() => [] as unknown[]);

vi.mock("@/app/store/wshclientapi", () => ({ RpcApi: rpc }));
vi.mock("@/app/store/wshrpcutil", () => ({ TabRpcClient: {} }));
vi.mock("@/app/cockpit/notificationstore", () => ({ pushToast: (t: unknown) => toasts.push(t) }));
vi.mock("../agents/agentview", () => ({ setAgentView: () => {} }));
vi.mock("../agents/chatmodestore", () => ({ setChatMode: () => {} }));

import { globalStore } from "@/app/store/jotaiStore";
import { atom, type PrimitiveAtom } from "jotai";
import { boardAloneAtom, centerModeAtom } from "../agents/agentcenter";
import { EMPTY_PROJECT_GRIDS } from "../agents/agentgrid";
import { projectGridsAtom } from "../agents/gridstore";
import { boardEntriesAtom, openBoardsAtom } from "../boards/boardentries";
import { hiddenBoardsAtom, openBoard, type BoardOpenModel } from "../boards/boardsplitstore";
import { deleteBoard } from "./boarddelete";
import { libraryBoardSelAtom } from "./librarystore";

function model(): BoardOpenModel {
    const focusIdAtom = atom<string | undefined>(undefined) as PrimitiveAtom<string | undefined>;
    return {
        focusIdAtom,
        agentsAtom: atom([{ id: "a1", blockId: "blk-a1", project: "arcterm" }]),
        terminalsAtom: atom([]),
        openTerminal: (id) => globalStore.set(focusIdAtom, id),
    };
}

const stored = new Map<string, string>();
const B1 = { project: "arcterm", boardId: "b1" };
const B2 = { project: "arcterm", boardId: "b2" };

beforeEach(() => {
    stored.clear();
    vi.stubGlobal("window", {
        localStorage: {
            getItem: (k: string) => stored.get(k) ?? null,
            setItem: (k: string, v: string) => void stored.set(k, v),
            removeItem: (k: string) => void stored.delete(k),
        },
    });
    toasts.length = 0;
    rpc.BoardDeleteCommand.mockReset();
    globalStore.set(projectGridsAtom, EMPTY_PROJECT_GRIDS);
    globalStore.set(boardEntriesAtom, []);
    globalStore.set(hiddenBoardsAtom, {});
    globalStore.set(centerModeAtom, "terminal");
    globalStore.set(boardAloneAtom, null);
    globalStore.set(libraryBoardSelAtom, null);
});

afterEach(() => {
    vi.unstubAllGlobals();
});

describe("deleteBoard", () => {
    it("lets go of everything that showed the board: its cell, the centre showing it alone, Library's open board", async () => {
        const m = model();
        openBoard(m, "a1", B1.project, B1.boardId);
        openBoard(m, "a1", B2.project, B2.boardId);
        globalStore.set(boardAloneAtom, B1);
        globalStore.set(centerModeAtom, "board");
        globalStore.set(libraryBoardSelAtom, B1);
        globalStore.set(hiddenBoardsAtom, { "arcterm/b1": 5 });
        rpc.BoardDeleteCommand.mockResolvedValue(undefined);

        expect(await deleteBoard(m, B1)).toBe(true);
        expect(rpc.BoardDeleteCommand).toHaveBeenCalledWith(expect.anything(), { project: "arcterm", boardid: "b1" });
        expect([...globalStore.get(openBoardsAtom).keys()]).toEqual(["arcterm/b2"]);
        expect(globalStore.get(boardAloneAtom)).toBeNull();
        expect(globalStore.get(centerModeAtom)).toBe("terminal");
        expect(globalStore.get(libraryBoardSelAtom)).toBeNull();
        expect(globalStore.get(hiddenBoardsAtom)).toEqual({});
    });

    it("leaves another board shown alone as it is", async () => {
        const m = model();
        globalStore.set(boardAloneAtom, B2);
        globalStore.set(centerModeAtom, "board");
        rpc.BoardDeleteCommand.mockResolvedValue(undefined);
        await deleteBoard(m, B1);
        expect(globalStore.get(boardAloneAtom)).toEqual(B2);
        expect(globalStore.get(centerModeAtom)).toBe("board");
    });

    it("on a refusal says why and keeps the board where it was", async () => {
        const m = model();
        openBoard(m, "a1", B1.project, B1.boardId);
        globalStore.set(libraryBoardSelAtom, B1);
        rpc.BoardDeleteCommand.mockRejectedValue(new Error("a turn is drawing on this board: stop it first"));
        expect(await deleteBoard(m, B1)).toBe(false);
        expect(toasts).toHaveLength(1);
        expect([...globalStore.get(openBoardsAtom).keys()]).toEqual(["arcterm/b1"]);
        expect(globalStore.get(libraryBoardSelAtom)).toEqual(B1);
    });
});
