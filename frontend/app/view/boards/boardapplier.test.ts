import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.hoisted(() => ({
    BoardAnswerInboxCommand: vi.fn(),
    BoardAnswerAckCommand: vi.fn(),
    BoardReadCommand: vi.fn(),
    BoardSaveCommand: vi.fn(),
    BoardListCommand: vi.fn(),
    BoardTalkCommand: vi.fn(),
}));
const pushToast = vi.hoisted(() => vi.fn());
const openBoard = vi.hoisted(() => vi.fn());
const handlers = vi.hoisted(() => [] as ((event: { data: unknown }) => void)[]);

vi.mock("@/app/store/wshclientapi", () => ({ RpcApi: rpc }));
vi.mock("@/app/store/wshrpcutil", () => ({ TabRpcClient: {} }));
vi.mock("@/app/store/wps", () => ({
    waveEventSubscribeSingle: (sub: { handler: (event: { data: unknown }) => void }) => {
        handlers.push(sub.handler);
        return () => handlers.splice(handlers.indexOf(sub.handler), 1);
    },
}));
vi.mock("@/app/cockpit/notificationstore", () => ({ pushToast: (...a: unknown[]) => pushToast(...a) }));
vi.mock("./boardsplitstore", () => ({ openBoard: (...a: unknown[]) => openBoard(...a) }));
// the real landAnswer converts through Excalidraw; this one adds one rectangle per answer, and refuses a bad skeleton
vi.mock("./boardconvert", () => ({
    landAnswer: (scene: { elements: unknown[] }, answer: BoardAnswer) => {
        if (answer.add === "not json") {
            throw new Error("the skeleton is not a list of elements");
        }
        return {
            scene: {
                ...scene,
                elements: [
                    ...scene.elements,
                    { id: `${answer.id}-r`, type: "rectangle", x: 0, y: 0, width: 100, height: 50, isDeleted: false },
                ],
            },
            shapeIds: [`${answer.id}-r`],
            textIds: [],
        };
    },
}));

import { globalStore } from "@/app/store/jotaiStore";
import { atom, type PrimitiveAtom } from "jotai";
import type { SurfaceKey } from "../agents/agents";
import { startBoardApplier, type BoardApplierModel } from "./boardapplier";
import { parseBoardFile } from "./boardmodel";
import { boardListAtom, boardTalkAtom, registerLiveBoard } from "./boardstore";

const BOARD = "0a1b2c3d";
const OTHER_BOARD = "9f8e7d6c";
const AGENT = "tab-applier";
const OTHER = "tab-applier-other";

const model = {
    surfaceAtom: atom<SurfaceKey>("cockpit"),
    focusIdAtom: atom<string | undefined>(undefined),
    agentsAtom: atom([{ id: AGENT }, { id: OTHER }]),
    terminalsAtom: atom([]),
    openTerminal: vi.fn(),
} as unknown as BoardApplierModel;

function showAgent(surface: SurfaceKey, focusId: string | undefined): void {
    globalStore.set(model.surfaceAtom as PrimitiveAtom<SurfaceKey>, surface);
    globalStore.set(model.focusIdAtom as PrimitiveAtom<string | undefined>, focusId);
}

function answer(over: Partial<BoardAnswer> = {}): BoardAnswer {
    return {
        id: "a-1",
        project: "arcterm",
        boardid: BOARD,
        turnid: "t-1",
        add: '[{"type":"rectangle","x":0,"y":0}]',
        ts: 1,
        ...over,
    };
}

const emptyBoard = JSON.stringify({ arc: { name: "Startup", createdts: 1 }, elements: [], appState: {}, files: {} });

function readRtn(rev: string, over: Partial<BoardInfo> = {}): BoardReadRtnData {
    return {
        info: {
            id: BOARD,
            name: "Startup",
            project: "arcterm",
            path: "/b.excalidraw",
            createdts: 1,
            activets: 1,
            ...over,
        },
        data: emptyBoard,
        rev,
    };
}

function emit(data: BoardUpdateData): void {
    handlers.forEach((h) => h({ data }));
}

const tick = () => new Promise((r) => setTimeout(r, 15));

let stop: () => void = () => {};

beforeEach(() => {
    vi.resetAllMocks();
    rpc.BoardAnswerInboxCommand.mockResolvedValue([]);
    rpc.BoardAnswerAckCommand.mockResolvedValue(undefined);
    rpc.BoardListCommand.mockResolvedValue({ boards: [] });
    rpc.BoardReadCommand.mockResolvedValue(readRtn("rev-1"));
    rpc.BoardSaveCommand.mockResolvedValue({ rev: "rev-2" });
    rpc.BoardTalkCommand.mockResolvedValue({ project: "arcterm", boardid: BOARD, turns: [] });
    globalStore.set(boardTalkAtom(BOARD), null);
    globalStore.set(boardListAtom("arcterm"), null);
    globalStore.set(boardListAtom(""), null);
    showAgent("cockpit", undefined);
});

afterEach(() => {
    stop();
});

describe("landing answers", () => {
    it("saves an answer for a closed board under the rev read, then acks it with its shape ids", async () => {
        const order: string[] = [];
        rpc.BoardAnswerInboxCommand.mockResolvedValue([answer()]);
        rpc.BoardSaveCommand.mockImplementation(async () => (order.push("save"), { rev: "rev-2" }));
        rpc.BoardAnswerAckCommand.mockImplementation(async () => void order.push("ack"));
        stop = startBoardApplier(model);
        emit({ project: "arcterm", boardid: BOARD, what: "answer" });
        await vi.waitFor(() => expect(order).toEqual(["save", "ack"]));
        expect(rpc.BoardAnswerInboxCommand).toHaveBeenCalledWith({}, { project: "arcterm", boardid: BOARD });
        const save = rpc.BoardSaveCommand.mock.calls[0][1];
        expect(save).toMatchObject({ project: "arcterm", boardid: BOARD, baserev: "rev-1" });
        expect(parseBoardFile(save.data).elements.map((el) => el.id)).toEqual(["a-1-r"]);
        expect(rpc.BoardAnswerAckCommand.mock.calls[0][1]).toEqual({
            project: "arcterm",
            boardid: BOARD,
            answerid: "a-1",
            turnid: "t-1",
            shapeids: ["a-1-r"],
        });
        expect(pushToast).not.toHaveBeenCalled();
    });

    it("re-reads and lands again when the save lost to another writer", async () => {
        rpc.BoardAnswerInboxCommand.mockResolvedValue([answer()]);
        rpc.BoardReadCommand.mockResolvedValueOnce(readRtn("rev-1")).mockResolvedValueOnce(readRtn("rev-9"));
        rpc.BoardSaveCommand.mockResolvedValueOnce({ conflict: true }).mockResolvedValueOnce({ rev: "rev-10" });
        stop = startBoardApplier(model);
        emit({ project: "arcterm", boardid: BOARD, what: "answer" });
        await vi.waitFor(() => expect(rpc.BoardAnswerAckCommand).toHaveBeenCalledOnce());
        expect(rpc.BoardReadCommand).toHaveBeenCalledTimes(2);
        expect(rpc.BoardSaveCommand.mock.calls.map((c) => c[1].baserev)).toEqual(["rev-1", "rev-9"]);
        expect(parseBoardFile(rpc.BoardSaveCommand.mock.calls[1][1].data).elements).toHaveLength(1);
        expect(rpc.BoardAnswerAckCommand.mock.calls[0][1]).toMatchObject({ shapeids: ["a-1-r"] });
        expect(rpc.BoardAnswerAckCommand.mock.calls[0][1].error).toBeUndefined();
    });

    it("fails the turn after three saves in a row lose to another writer", async () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        rpc.BoardAnswerInboxCommand.mockResolvedValue([answer()]);
        rpc.BoardSaveCommand.mockResolvedValue({ conflict: true });
        stop = startBoardApplier(model);
        emit({ project: "arcterm", boardid: BOARD, what: "answer" });
        await vi.waitFor(() => expect(rpc.BoardAnswerAckCommand).toHaveBeenCalledOnce());
        expect(rpc.BoardSaveCommand).toHaveBeenCalledTimes(3);
        const ack = rpc.BoardAnswerAckCommand.mock.calls[0][1];
        expect(ack.error).toMatch(/changed under 3 saves/);
        expect(ack.shapeids).toBeUndefined();
        warn.mockRestore();
    });

    it("hands an open board's answer to its canvas, saves nothing itself, and acks the canvas's shape ids", async () => {
        const apply = vi.fn(async () => ["s1", "s2"]);
        const unregister = registerLiveBoard("arcterm", BOARD, apply);
        try {
            stop = startBoardApplier(model);
            rpc.BoardAnswerInboxCommand.mockResolvedValue([answer()]);
            emit({ project: "arcterm", boardid: BOARD, what: "answer" });
            await vi.waitFor(() => expect(rpc.BoardAnswerAckCommand).toHaveBeenCalledOnce());
            expect(apply).toHaveBeenCalledWith(expect.objectContaining({ id: "a-1" }));
            expect(rpc.BoardReadCommand).not.toHaveBeenCalled();
            expect(rpc.BoardSaveCommand).not.toHaveBeenCalled();
            expect(rpc.BoardAnswerAckCommand.mock.calls[0][1].shapeids).toEqual(["s1", "s2"]);
        } finally {
            unregister();
        }
    });

    it("reads a board's inbox when its canvas opens after start, and lands the waiting answer", async () => {
        stop = startBoardApplier(model);
        await vi.waitFor(() => expect(rpc.BoardListCommand).toHaveBeenCalled());
        rpc.BoardAnswerInboxCommand.mockResolvedValue([answer()]);
        const apply = vi.fn(async () => ["s1"]);
        const unregister = registerLiveBoard("arcterm", BOARD, apply);
        try {
            await vi.waitFor(() => expect(rpc.BoardAnswerAckCommand).toHaveBeenCalledOnce());
            expect(rpc.BoardAnswerInboxCommand).toHaveBeenLastCalledWith({}, { project: "arcterm", boardid: BOARD });
            expect(apply).toHaveBeenCalledWith(expect.objectContaining({ id: "a-1" }));
        } finally {
            unregister();
        }
    });

    it("takes an answer once, however many times the inbox lists it", async () => {
        rpc.BoardAnswerInboxCommand.mockResolvedValue([answer()]);
        stop = startBoardApplier(model);
        emit({ project: "arcterm", boardid: BOARD, what: "answer" });
        emit({ project: "arcterm", boardid: BOARD, what: "answer" });
        await vi.waitFor(() => expect(rpc.BoardAnswerAckCommand).toHaveBeenCalledOnce());
        await tick();
        emit({ project: "arcterm", boardid: BOARD, what: "answer" });
        await tick();
        expect(rpc.BoardSaveCommand).toHaveBeenCalledOnce();
        expect(rpc.BoardAnswerAckCommand).toHaveBeenCalledOnce();
    });
});

describe("answers that cannot land", () => {
    beforeEach(() => {
        vi.spyOn(console, "warn").mockImplementation(() => {});
    });
    afterEach(() => {
        vi.restoreAllMocks();
    });

    async function ackedWith(): Promise<CommandBoardAnswerAckData> {
        await vi.waitFor(() => expect(rpc.BoardAnswerAckCommand).toHaveBeenCalledOnce());
        return rpc.BoardAnswerAckCommand.mock.calls[0][1];
    }

    it("acks with the error when the board's file won't open, and saves nothing", async () => {
        rpc.BoardAnswerInboxCommand.mockResolvedValue([answer()]);
        rpc.BoardReadCommand.mockResolvedValue(readRtn("rev-1", { loaderror: "not valid JSON at line 3" }));
        stop = startBoardApplier(model);
        emit({ project: "arcterm", boardid: BOARD, what: "answer" });
        const ack = await ackedWith();
        expect(ack.error).toMatch(/won't open: not valid JSON at line 3/);
        expect(ack).toMatchObject({ answerid: "a-1", turnid: "t-1" });
        expect(ack.shapeids).toBeUndefined();
        expect(rpc.BoardSaveCommand).not.toHaveBeenCalled();
    });

    it("acks with the error when the board can't be read", async () => {
        rpc.BoardAnswerInboxCommand.mockResolvedValue([answer()]);
        rpc.BoardReadCommand.mockRejectedValue(new Error("no such board"));
        stop = startBoardApplier(model);
        emit({ project: "arcterm", boardid: BOARD, what: "answer" });
        expect((await ackedWith()).error).toBe("no such board");
    });

    it("acks with the error when the answer is malformed", async () => {
        rpc.BoardAnswerInboxCommand.mockResolvedValue([answer({ add: "not json" })]);
        stop = startBoardApplier(model);
        emit({ project: "arcterm", boardid: BOARD, what: "answer" });
        expect((await ackedWith()).error).toMatch(/not a list of elements/);
        expect(rpc.BoardSaveCommand).not.toHaveBeenCalled();
    });

    it("acks with the error when the open canvas can't land it", async () => {
        const unregister = registerLiveBoard("arcterm", BOARD, async () => {
            throw new Error("the board is not open");
        });
        try {
            rpc.BoardAnswerInboxCommand.mockResolvedValue([answer()]);
            stop = startBoardApplier(model);
            emit({ project: "arcterm", boardid: BOARD, what: "answer" });
            expect((await ackedWith()).error).toBe("the board is not open");
        } finally {
            unregister();
        }
    });

    // an ack that does not get through is tried again after a second, three times in all
    describe("when an ack does not get through", () => {
        beforeEach(() => {
            vi.useFakeTimers({ toFake: ["setTimeout"] });
        });
        afterEach(() => {
            vi.useRealTimers();
        });

        it("tries the ack again, and says the failure once it can", async () => {
            rpc.BoardAnswerInboxCommand.mockResolvedValue([answer({ add: "not json" })]);
            rpc.BoardAnswerAckCommand.mockRejectedValueOnce(new Error("wavesrv is down")).mockResolvedValue(undefined);
            stop = startBoardApplier(model);
            emit({ project: "arcterm", boardid: BOARD, what: "answer" });
            await vi.waitFor(() => expect(rpc.BoardAnswerAckCommand).toHaveBeenCalledTimes(1));
            await vi.advanceTimersByTimeAsync(1000);
            await vi.waitFor(() => expect(rpc.BoardAnswerAckCommand).toHaveBeenCalledTimes(2));
            expect(rpc.BoardAnswerAckCommand.mock.calls.map((c) => typeof c[1].error)).toEqual(["string", "string"]);
        });

        it("lands a failed answer again on the next read when its failure never got through", async () => {
            rpc.BoardAnswerInboxCommand.mockResolvedValue([answer({ add: "not json" })]);
            rpc.BoardAnswerAckCommand.mockRejectedValue(new Error("wavesrv is down"));
            stop = startBoardApplier(model);
            emit({ project: "arcterm", boardid: BOARD, what: "answer" });
            await vi.advanceTimersByTimeAsync(2000);
            await vi.waitFor(() => expect(rpc.BoardAnswerAckCommand).toHaveBeenCalledTimes(3));
            rpc.BoardAnswerAckCommand.mockResolvedValue(undefined);
            emit({ project: "arcterm", boardid: BOARD, what: "answer" });
            await vi.waitFor(() => expect(rpc.BoardAnswerAckCommand).toHaveBeenCalledTimes(4));
            expect(typeof rpc.BoardAnswerAckCommand.mock.calls[3][1].error).toBe("string");
        });

        it("acks a landed answer again on the next read, without landing it twice", async () => {
            rpc.BoardAnswerInboxCommand.mockResolvedValue([answer()]);
            rpc.BoardAnswerAckCommand.mockRejectedValue(new Error("wavesrv is down"));
            stop = startBoardApplier(model);
            emit({ project: "arcterm", boardid: BOARD, what: "answer" });
            await vi.advanceTimersByTimeAsync(2000);
            await vi.waitFor(() => expect(rpc.BoardAnswerAckCommand).toHaveBeenCalledTimes(3));
            expect(rpc.BoardSaveCommand).toHaveBeenCalledOnce();
            rpc.BoardAnswerAckCommand.mockResolvedValue(undefined);
            emit({ project: "arcterm", boardid: BOARD, what: "answer" });
            await vi.waitFor(() => expect(rpc.BoardAnswerAckCommand).toHaveBeenCalledTimes(4));
            expect(rpc.BoardAnswerAckCommand.mock.calls[3][1]).toMatchObject({ answerid: "a-1", shapeids: ["a-1-r"] });
            expect(rpc.BoardAnswerAckCommand.mock.calls[3][1].error).toBeUndefined();
            expect(rpc.BoardSaveCommand).toHaveBeenCalledOnce();
        });
    });
});

describe("one answer in flight per board", () => {
    it("lands a board's answers oldest first, each after the one before it is acked", async () => {
        const events: string[] = [];
        let releaseFirst!: () => void;
        // the inbox lists them newest first; the second must wait for the first's ack
        rpc.BoardAnswerInboxCommand.mockResolvedValue([
            answer({ id: "a-2", turnid: "t-2", ts: 20 }),
            answer({ id: "a-1", turnid: "t-1", ts: 10 }),
        ]);
        rpc.BoardSaveCommand.mockImplementation(async (_c, data: CommandBoardSaveData) => {
            const ids = parseBoardFile(data.data).elements.map((el) => el.id);
            events.push(`save:${ids.at(-1)}`);
            if (ids.at(-1) === "a-1-r") {
                await new Promise<void>((r) => (releaseFirst = r));
            }
            return { rev: "rev-2" };
        });
        rpc.BoardAnswerAckCommand.mockImplementation(async (_c, data: CommandBoardAnswerAckData) => {
            events.push(`ack:${data.answerid}`);
        });
        stop = startBoardApplier(model);
        emit({ project: "arcterm", boardid: BOARD, what: "answer" });
        await vi.waitFor(() => expect(events).toEqual(["save:a-1-r"]));
        await tick();
        expect(events).toEqual(["save:a-1-r"]);
        releaseFirst();
        await vi.waitFor(() => expect(events).toEqual(["save:a-1-r", "ack:a-1", "save:a-2-r", "ack:a-2"]));
    });

    it("does not hold one board's answer behind another's", async () => {
        let releaseFirst!: () => void;
        rpc.BoardAnswerInboxCommand.mockImplementation(async (_c, ref: CommandBoardRefData) => [
            answer({ id: `a-${ref.boardid}`, boardid: ref.boardid }),
        ]);
        rpc.BoardSaveCommand.mockImplementation(async (_c, data: CommandBoardSaveData) => {
            if (data.boardid === BOARD) {
                await new Promise<void>((r) => (releaseFirst = r));
            }
            return { rev: "rev-2" };
        });
        stop = startBoardApplier(model);
        emit({ project: "arcterm", boardid: BOARD, what: "answer" });
        emit({ project: "arcterm", boardid: OTHER_BOARD, what: "answer" });
        await vi.waitFor(() => expect(rpc.BoardAnswerAckCommand).toHaveBeenCalledOnce());
        expect(rpc.BoardAnswerAckCommand.mock.calls[0][1]).toMatchObject({
            boardid: OTHER_BOARD,
            shapeids: [`a-${OTHER_BOARD}-r`],
        });
        expect(rpc.BoardAnswerAckCommand.mock.calls[0][1].error).toBeUndefined();
        releaseFirst();
        await vi.waitFor(() => expect(rpc.BoardAnswerAckCommand).toHaveBeenCalledTimes(2));
        expect(rpc.BoardAnswerAckCommand.mock.calls[1][1]).toMatchObject({
            boardid: BOARD,
            shapeids: ["a-" + BOARD + "-r"],
        });
    });
});

describe("waiting answers at start", () => {
    it("reads the inbox of a board with a turn answering, and no other", async () => {
        rpc.BoardListCommand.mockResolvedValue({
            boards: [
                { id: BOARD, name: "A", project: "arcterm", path: "", createdts: 1, activets: 1, state: "answering" },
                { id: OTHER_BOARD, name: "B", project: "arcterm", path: "", createdts: 1, activets: 1 },
                { id: "c3c3c3c3", name: "C", project: "wave", path: "", createdts: 1, activets: 1, state: "failed" },
                { id: "d4d4d4d4", name: "D", project: "wave", path: "", createdts: 1, activets: 1, state: "answering" },
            ],
        });
        rpc.BoardAnswerInboxCommand.mockResolvedValue([]);
        stop = startBoardApplier(model);
        await vi.waitFor(() => expect(rpc.BoardAnswerInboxCommand).toHaveBeenCalledTimes(2));
        expect(rpc.BoardListCommand).toHaveBeenCalledWith({}, { project: "" });
        expect(rpc.BoardAnswerInboxCommand.mock.calls.map((c) => c[1])).toEqual([
            { project: "arcterm", boardid: BOARD },
            { project: "wave", boardid: "d4d4d4d4" },
        ]);
    });

    it("lands the answer it finds", async () => {
        rpc.BoardListCommand.mockResolvedValue({
            boards: [
                { id: BOARD, name: "A", project: "arcterm", path: "", createdts: 1, activets: 1, state: "answering" },
            ],
        });
        rpc.BoardAnswerInboxCommand.mockResolvedValue([answer()]);
        stop = startBoardApplier(model);
        await vi.waitFor(() => expect(rpc.BoardAnswerAckCommand).toHaveBeenCalledOnce());
        expect(rpc.BoardAnswerAckCommand.mock.calls[0][1].shapeids).toEqual(["a-1-r"]);
    });

    it("warns, and carries on, when the boards can't be listed", async () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        rpc.BoardListCommand.mockRejectedValue(new Error("wavesrv is down"));
        stop = startBoardApplier(model);
        await vi.waitFor(() => expect(warn).toHaveBeenCalled());
        warn.mockRestore();
    });
});

describe("the toast for a drawing the agent asked for", () => {
    const requestTalk = (state: string): BoardTalk => ({
        project: "arcterm",
        boardid: BOARD,
        turns: [
            { id: "t-ask", ts: 1, kind: "ask", state: "answered", added: 2 },
            { id: "t-req", ts: 2, kind: "request", state, added: 9, changed: 2 },
        ],
    });

    function board(over: Partial<BoardInfo> = {}): BoardInfo {
        return {
            id: BOARD,
            name: "Startup flow",
            project: "arcterm",
            path: "",
            createdts: 1,
            activets: 1,
            agenttabid: AGENT,
            ...over,
        };
    }

    const answered = (turnid: string): BoardUpdateData => ({
        project: "arcterm",
        boardid: BOARD,
        what: "talk",
        turnid,
        state: "answered",
    });

    beforeEach(() => {
        rpc.BoardTalkCommand.mockResolvedValue(requestTalk("answered"));
        rpc.BoardListCommand.mockResolvedValue({ boards: [board()] });
    });

    it("toasts an answered request once, naming the board and what was drawn, with Open on the agent's board", async () => {
        stop = startBoardApplier(model);
        emit(answered("t-req"));
        emit(answered("t-req"));
        await vi.waitFor(() => expect(pushToast).toHaveBeenCalledOnce());
        await tick();
        expect(pushToast).toHaveBeenCalledOnce();
        const toast = pushToast.mock.calls[0][0];
        expect(toast).toMatchObject({
            title: "The drawer drew on Startup flow",
            message: "+9 shapes, 2 changed",
            level: "info",
            action: { label: "Open" },
        });
        toast.action.run();
        expect(openBoard).toHaveBeenCalledWith(model, AGENT, "arcterm", BOARD);
    });

    it("never toasts your own ask, a turn that is not answered, or an event with no turn", async () => {
        stop = startBoardApplier(model);
        emit(answered("t-ask"));
        emit({ ...answered("t-req"), state: "failed" });
        emit({ ...answered("t-req"), state: "answering" });
        emit({ project: "arcterm", boardid: BOARD, what: "talk", state: "answered" });
        emit({ project: "arcterm", what: "talk", turnid: "t-req", state: "answered" });
        await tick();
        expect(pushToast).not.toHaveBeenCalled();
    });

    it("reads the turn from the talk already loaded, without asking wavesrv", async () => {
        globalStore.set(boardTalkAtom(BOARD), requestTalk("answered"));
        stop = startBoardApplier(model);
        emit(answered("t-req"));
        await vi.waitFor(() => expect(pushToast).toHaveBeenCalledOnce());
        expect(rpc.BoardTalkCommand).not.toHaveBeenCalled();
    });

    it("stays quiet while the Agent surface shows the board's agent focused", async () => {
        showAgent("agent", AGENT);
        stop = startBoardApplier(model);
        emit(answered("t-req"));
        await vi.waitFor(() => expect(rpc.BoardListCommand).toHaveBeenCalled());
        await tick();
        expect(pushToast).not.toHaveBeenCalled();
    });

    it("toasts while another surface shows the agent focused", async () => {
        showAgent("cockpit", AGENT);
        stop = startBoardApplier(model);
        emit(answered("t-req"));
        await vi.waitFor(() => expect(pushToast).toHaveBeenCalledOnce());
    });

    it("toasts while the Agent surface shows another agent", async () => {
        showAgent("agent", OTHER);
        stop = startBoardApplier(model);
        emit(answered("t-req"));
        await vi.waitFor(() => expect(pushToast).toHaveBeenCalledOnce());
    });

    it("toasts again when a retried turn is answered again", async () => {
        stop = startBoardApplier(model);
        emit(answered("t-req"));
        await vi.waitFor(() => expect(pushToast).toHaveBeenCalledTimes(1));
        emit({ ...answered("t-req"), state: "answering" });
        emit(answered("t-req"));
        await vi.waitFor(() => expect(pushToast).toHaveBeenCalledTimes(2));
    });

    it("offers no Open once the agent's tab is gone", async () => {
        rpc.BoardListCommand.mockResolvedValue({ boards: [board({ agenttabid: "tab-closed" })] });
        stop = startBoardApplier(model);
        emit(answered("t-req"));
        await vi.waitFor(() => expect(pushToast).toHaveBeenCalledOnce());
        expect(pushToast.mock.calls[0][0].action).toBeUndefined();
    });

    it("still names something when the board list can't be read", async () => {
        vi.spyOn(console, "warn").mockImplementation(() => {});
        rpc.BoardListCommand.mockRejectedValue(new Error("wavesrv is down"));
        stop = startBoardApplier(model);
        emit(answered("t-req"));
        await vi.waitFor(() => expect(pushToast).toHaveBeenCalledOnce());
        expect(pushToast.mock.calls[0][0]).toMatchObject({ title: `The drawer drew on board ${BOARD}` });
        expect(pushToast.mock.calls[0][0].action).toBeUndefined();
    });

    it("stops listening when stopped", async () => {
        stop = startBoardApplier(model);
        stop();
        emit(answered("t-req"));
        emit({ project: "arcterm", boardid: BOARD, what: "answer" });
        await tick();
        expect(pushToast).not.toHaveBeenCalled();
        expect(rpc.BoardAnswerInboxCommand).not.toHaveBeenCalled();
    });
});
