import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.hoisted(() => ({
    BoardListCommand: vi.fn(),
    BoardTalkCommand: vi.fn(),
}));

vi.mock("@/app/store/wshclientapi", () => ({ RpcApi: rpc }));
vi.mock("@/app/store/wshrpcutil", () => ({ TabRpcClient: {} }));
vi.mock("@/app/store/wps", () => ({ waveEventSubscribeSingle: () => () => {} }));

import { globalStore } from "@/app/store/jotaiStore";
import {
    boardListAtom,
    boardTalkAtom,
    boardsOfAgent,
    findBoardByName,
    liveBoardApply,
    loadBoardList,
    loadBoardTalk,
    onBoardUpdate,
    onLiveBoardRegistered,
    registerLiveBoard,
} from "./boardstore";

function board(id: string, over: Partial<BoardInfo> = {}): BoardInfo {
    return { id, name: id, project: "arcterm", path: `/${id}.excalidraw`, createdts: 1, activets: 1, ...over };
}

function talk(boardId: string, turns: BoardTurn[] = []): BoardTalk {
    return { project: "arcterm", boardid: boardId, turns };
}

function turn(id: string): BoardTurn {
    return { id, ts: 1, kind: "ask", state: "answered", question: "How does it fit?" };
}

beforeEach(() => {
    vi.resetAllMocks();
    rpc.BoardListCommand.mockResolvedValue({ boards: [] });
    rpc.BoardTalkCommand.mockImplementation(async (_c, data: CommandBoardRefData) => talk(data.boardid));
});

describe("loadBoardList", () => {
    it("reads a project's boards into its atom, and every project's under the empty name", async () => {
        rpc.BoardListCommand.mockResolvedValue({ boards: [board("b1")] });
        await loadBoardList("arcterm");
        expect(rpc.BoardListCommand).toHaveBeenCalledWith({}, { project: "arcterm" });
        expect(globalStore.get(boardListAtom("arcterm"))?.map((b) => b.id)).toEqual(["b1"]);
        await loadBoardList("");
        expect(rpc.BoardListCommand).toHaveBeenLastCalledWith({}, { project: "" });
        expect(globalStore.get(boardListAtom(""))?.map((b) => b.id)).toEqual(["b1"]);
    });

    it("leaves a list unread until it is read", () => {
        expect(globalStore.get(boardListAtom("never-read"))).toBeNull();
    });

    it("lands only the latest of two overlapping reads", async () => {
        let first!: (v: BoardListRtnData) => void;
        rpc.BoardListCommand.mockImplementationOnce(() => new Promise((r) => (first = r))).mockResolvedValueOnce({
            boards: [board("b2")],
        });
        const older = loadBoardList("p-overlap");
        await loadBoardList("p-overlap");
        first({ boards: [] });
        await older;
        expect(globalStore.get(boardListAtom("p-overlap"))?.map((b) => b.id)).toEqual(["b2"]);
    });

    it("does not keep a failed read as read, so the next hook retries it", async () => {
        rpc.BoardListCommand.mockRejectedValueOnce(new Error("wavesrv is down"));
        await expect(loadBoardList("p-fail")).rejects.toThrow("wavesrv is down");
        rpc.BoardListCommand.mockClear();
        onBoardUpdate({ project: "p-fail", boardid: "b1", what: "list" });
        await new Promise((r) => setTimeout(r, 10));
        expect(rpc.BoardListCommand.mock.calls.map((c) => c[1].project)).not.toContain("p-fail");
    });
});

describe("loadBoardTalk", () => {
    it("keeps the board's agent and turns", async () => {
        const agent: BoardAgent = { tabid: "tab1", title: "claude · arcterm", readts: 5 };
        rpc.BoardTalkCommand.mockResolvedValueOnce({ ...talk("b8", [turn("t1")]), agent });
        await loadBoardTalk("arcterm", "b8");
        expect(rpc.BoardTalkCommand).toHaveBeenCalledWith({}, { project: "arcterm", boardid: "b8" });
        expect(globalStore.get(boardTalkAtom("b8"))).toMatchObject({ agent, turns: [{ id: "t1" }] });
    });

    it("lands only the latest of two overlapping reads", async () => {
        let first!: (v: BoardTalk) => void;
        rpc.BoardTalkCommand.mockImplementationOnce(() => new Promise((r) => (first = r))).mockResolvedValueOnce(
            talk("b7", [turn("t2")])
        );
        const older = loadBoardTalk("arcterm", "b7");
        await loadBoardTalk("arcterm", "b7");
        first(talk("b7"));
        await older;
        expect(globalStore.get(boardTalkAtom("b7"))?.turns.map((t) => t.id)).toEqual(["t2"]);
    });

    it("reads a talk with no turns as empty", async () => {
        rpc.BoardTalkCommand.mockResolvedValueOnce({ project: "arcterm", boardid: "b9" });
        await loadBoardTalk("arcterm", "b9");
        expect(globalStore.get(boardTalkAtom("b9"))?.turns).toEqual([]);
    });
});

describe("board:update reloads", () => {
    it("reloads a loaded project's list and the every-project list on list, talk and answer", async () => {
        await loadBoardList("arcterm");
        await loadBoardList("");
        await loadBoardList("other");
        rpc.BoardListCommand.mockClear();
        for (const what of ["list", "talk", "answer", "something-else"]) {
            onBoardUpdate({ project: "arcterm", boardid: "b1", what });
        }
        await vi.waitFor(() => expect(rpc.BoardListCommand).toHaveBeenCalledTimes(6));
        const asked = rpc.BoardListCommand.mock.calls.map((c) => c[1].project);
        expect(new Set(asked)).toEqual(new Set(["arcterm", ""]));
    });

    it("reloads a loaded board's talk on talk and answer events, from the project it was read for", async () => {
        await loadBoardTalk("arcterm", "b1");
        rpc.BoardTalkCommand.mockClear();
        rpc.BoardTalkCommand.mockResolvedValue(talk("b1", [turn("t1")]));
        onBoardUpdate({ project: "arcterm", boardid: "b1", what: "talk" });
        onBoardUpdate({ project: "arcterm", boardid: "b1", what: "answer" });
        await vi.waitFor(() => expect(rpc.BoardTalkCommand).toHaveBeenCalledTimes(2));
        expect(rpc.BoardTalkCommand).toHaveBeenLastCalledWith({}, { project: "arcterm", boardid: "b1" });
        await vi.waitFor(() => expect(globalStore.get(boardTalkAtom("b1"))?.turns.map((t) => t.id)).toEqual(["t1"]));
    });

    it("leaves an unread project and board alone, and a missing event", () => {
        onBoardUpdate({ project: "p-unread", boardid: "b-unread", what: "talk" });
        onBoardUpdate(undefined);
        // the every-project list, read by an earlier test, still reloads; the unread project's does not
        expect(rpc.BoardListCommand.mock.calls.map((c) => c[1].project)).not.toContain("p-unread");
        expect(rpc.BoardTalkCommand).not.toHaveBeenCalled();
    });

    it("warns, and keeps what it had, when a reload fails", async () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        rpc.BoardListCommand.mockResolvedValue({ boards: [board("b1")] });
        await loadBoardList("p-warn");
        rpc.BoardListCommand.mockRejectedValue(new Error("wavesrv is down"));
        onBoardUpdate({ project: "p-warn", what: "list" });
        await vi.waitFor(() => expect(warn).toHaveBeenCalled());
        expect(globalStore.get(boardListAtom("p-warn"))?.map((b) => b.id)).toEqual(["b1"]);
        warn.mockRestore();
    });
});

describe("boardsOfAgent", () => {
    it("keeps the agent's boards in the list's order", () => {
        const list = [
            board("b1", { agenttabid: "tabA" }),
            board("b2", { agenttabid: "tabB" }),
            board("b3", { agenttabid: "tabA" }),
            board("b4"),
        ];
        expect(boardsOfAgent(list, "tabA").map((b) => b.id)).toEqual(["b1", "b3"]);
        expect(boardsOfAgent(list, "none")).toEqual([]);
        expect(boardsOfAgent(null, "tabA")).toEqual([]);
    });
});

describe("findBoardByName", () => {
    const list = [
        board("old", { name: "Startup flow", activets: 10 }),
        board("new", { name: " startup FLOW ", activets: 50 }),
        board("other", { name: "Auth", activets: 99 }),
    ];

    it("finds a name trimmed and in any case, taking the most recently active", () => {
        expect(findBoardByName(list, "startup flow")?.id).toBe("new");
        expect(findBoardByName(list, "  AUTH ")?.id).toBe("other");
    });

    it("finds nothing for an unknown or empty name, or no list", () => {
        expect(findBoardByName(list, "Missing")).toBeUndefined();
        expect(findBoardByName(list, "  ")).toBeUndefined();
        expect(findBoardByName(null, "Auth")).toBeUndefined();
    });
});

describe("the open canvas registry", () => {
    it("hands answers to the newest canvas, and back to the one before it when that closes", () => {
        const first = vi.fn(async () => ["a"]);
        const second = vi.fn(async () => ["b"]);
        const dropFirst = registerLiveBoard("arcterm", "b-live", first);
        const dropSecond = registerLiveBoard("arcterm", "b-live", second);
        expect(liveBoardApply("b-live")).toBe(second);
        dropSecond();
        expect(liveBoardApply("b-live")).toBe(first);
        dropFirst();
        expect(liveBoardApply("b-live")).toBeUndefined();
    });

    it("tells listeners which board opened, until they stop listening", () => {
        const heard = vi.fn();
        const stop = onLiveBoardRegistered(heard);
        const drop = registerLiveBoard("arcterm", "b-heard", vi.fn());
        expect(heard).toHaveBeenCalledWith("arcterm", "b-heard");
        stop();
        drop();
        const dropAgain = registerLiveBoard("arcterm", "b-heard", vi.fn());
        expect(heard).toHaveBeenCalledOnce();
        dropAgain();
    });
});
