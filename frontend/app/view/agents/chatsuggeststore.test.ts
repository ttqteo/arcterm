// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.hoisted(() => ({
    ChatSuggestCommand: vi.fn(),
    ChatJudgeCommand: vi.fn(),
    ChatJudgeStopCommand: vi.fn(),
    ChatJudgeListCommand: vi.fn(),
}));

vi.mock("@/app/store/wshclientapi", () => ({ RpcApi: rpc }));
vi.mock("@/app/store/wshrpcutil", () => ({ TabRpcClient: {} }));

import { globalStore } from "@/app/store/jotaiStore";
import type { ModelSuggest } from "./chatsuggest";
import {
    chatJudgeAtom,
    liveJudgeAtom,
    loadChatJudges,
    modelSuggestAtom,
    requestDeepJudge,
    requestModelSuggest,
    resetChatJudges,
    runLiveJudge,
    stopDeepJudge,
} from "./chatsuggeststore";

const DATA: CommandChatSuggestData = { reply: "một câu trả lời dài", recent: ["làm đi"], question: false };

/** the answer stored under `key`, once the call has settled */
async function settled(key: string): Promise<ModelSuggest> {
    await vi.waitFor(() => expect(globalStore.get(modelSuggestAtom)[key]?.status).not.toBe("loading"));
    return globalStore.get(modelSuggestAtom)[key];
}

beforeEach(() => {
    globalStore.set(modelSuggestAtom, {});
    globalStore.set(chatJudgeAtom, {});
    globalStore.set(liveJudgeAtom, {});
    resetChatJudges();
    for (const f of Object.values(rpc)) {
        f.mockReset();
    }
});

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe("requestModelSuggest", () => {
    it("sends the data with the turn's key and whether it is a choice, and keeps the answer's replies", async () => {
        rpc.ChatSuggestCommand.mockResolvedValue({ replies: ["vẽ tôi xem"] });
        requestModelSuggest("k1", DATA);
        expect(globalStore.get(modelSuggestAtom)["k1"]).toEqual({ status: "loading" });
        const done = await settled("k1");
        expect(rpc.ChatSuggestCommand).toHaveBeenCalledTimes(1);
        expect(rpc.ChatSuggestCommand.mock.calls[0][1]).toEqual({ ...DATA, key: "k1", choice: false });
        expect(done).toEqual({ status: "done", replies: ["vẽ tôi xem"] });
    });

    it("keeps an empty list for an answer with no replies", async () => {
        rpc.ChatSuggestCommand.mockResolvedValueOnce({});
        requestModelSuggest("k2", DATA);
        expect(await settled("k2")).toEqual({ status: "done", replies: [] });
    });

    it("marks a call that threw failed", async () => {
        rpc.ChatSuggestCommand.mockRejectedValue(new Error("boom"));
        requestModelSuggest("k4", DATA);
        expect(await settled("k4")).toEqual({ status: "failed" });
    });

    it("asks a turn once: a second ask for the same key makes no second call", async () => {
        rpc.ChatSuggestCommand.mockResolvedValue({ replies: ["a"] });
        requestModelSuggest("k5", DATA);
        requestModelSuggest("k5", DATA);
        await settled("k5");
        requestModelSuggest("k5", DATA);
        expect(rpc.ChatSuggestCommand).toHaveBeenCalledTimes(1);
    });

    describe("the judge's part", () => {
        const asked = () => rpc.ChatSuggestCommand.mock.calls[0][1] as CommandChatSuggestData;

        it("marks a reply that ends in a choice question as a choice", async () => {
            rpc.ChatSuggestCommand.mockResolvedValue({ replies: [] });
            requestModelSuggest("c1", { reply: "Mình nghiêng A. A hay B?", recent: [], question: true });
            await settled("c1");
            expect(asked().key).toBe("c1");
            expect(asked().choice).toBe(true);
        });

        it("does not mark a yes-or-no question, or a reply with no question, as a choice", async () => {
            rpc.ChatSuggestCommand.mockResolvedValue({ replies: [] });
            requestModelSuggest("c2", { reply: "Should I build it?", question: true });
            requestModelSuggest("c3", { reply: "Đã xong.", question: false });
            await settled("c2");
            await settled("c3");
            expect(rpc.ChatSuggestCommand.mock.calls.map((c) => (c[1] as CommandChatSuggestData).choice)).toEqual([
                false,
                false,
            ]);
        });

        it("puts a returned record in the judge atom under the key, the chips' state keeping only the replies", async () => {
            const record: ChatJudgeRecord = {
                key: "j1",
                ts: 1,
                question: "A hay B?",
                options: [{ text: "A, sửa", desc: "sửa gốc" }, { text: "B, bỏ" }],
                pick: "A, sửa",
                reason: "gốc",
            };
            rpc.ChatSuggestCommand.mockResolvedValue({ replies: ["A, sửa", "B, bỏ"], judge: record });
            requestModelSuggest("j1", { reply: "A hay B?", question: true });
            expect(await settled("j1")).toEqual({ status: "done", replies: ["A, sửa", "B, bỏ"] });
            expect(globalStore.get(chatJudgeAtom)["j1"]).toEqual(record);
        });

        it("has the record in place before the chips' state says done", async () => {
            const record: ChatJudgeRecord = { key: "j2", ts: 1, question: "A hay B?", options: [{ text: "A" }] };
            rpc.ChatSuggestCommand.mockResolvedValue({ replies: ["A"], judge: record });
            const seen: boolean[] = [];
            const off = globalStore.sub(modelSuggestAtom, () => {
                if (globalStore.get(modelSuggestAtom)["j2"]?.status === "done") {
                    seen.push(globalStore.get(chatJudgeAtom)["j2"] != null);
                }
            });
            requestModelSuggest("j2", { reply: "A hay B?", question: true });
            await settled("j2");
            off();
            expect(seen).toEqual([true]);
        });

        it("leaves the judge atom alone for an answer with no record", async () => {
            rpc.ChatSuggestCommand.mockResolvedValue({ replies: ["ok"] });
            requestModelSuggest("j3", DATA);
            await settled("j3");
            expect(globalStore.get(chatJudgeAtom)).toEqual({});
        });
    });

    describe("the DEV fake", () => {
        it("takes the replies it answers, sync or as a promise, and makes no call", async () => {
            const fake = vi.fn(() => ["ok", "vẽ thử"]);
            vi.stubGlobal("window", { __chatSuggestFake: fake });
            requestModelSuggest("f1", DATA);
            expect(await settled("f1")).toEqual({ status: "done", replies: ["ok", "vẽ thử"] });
            expect(fake).toHaveBeenCalledWith({ ...DATA, key: "f1", choice: false });
            vi.stubGlobal("window", { __chatSuggestFake: () => Promise.resolve(["A"]) });
            requestModelSuggest("f2", DATA);
            expect(await settled("f2")).toEqual({ status: "done", replies: ["A"] });
            expect(rpc.ChatSuggestCommand).not.toHaveBeenCalled();
        });

        it("takes a whole answer, the record included", async () => {
            const record: ChatJudgeRecord = { key: "f3", ts: 1, question: "A hay B?", options: [{ text: "A" }] };
            vi.stubGlobal("window", { __chatSuggestFake: () => Promise.resolve({ replies: ["A"], judge: record }) });
            requestModelSuggest("f3", { reply: "A hay B?", question: true });
            expect(await settled("f3")).toEqual({ status: "done", replies: ["A"] });
            expect(globalStore.get(chatJudgeAtom)["f3"]).toEqual(record);
            expect(rpc.ChatSuggestCommand).not.toHaveBeenCalled();
        });

        it("marks a fake that throws failed", async () => {
            vi.stubGlobal("window", {
                __chatSuggestFake: () => {
                    throw new Error("no");
                },
            });
            requestModelSuggest("f4", DATA);
            expect(await settled("f4")).toEqual({ status: "failed" });
        });
    });
});

// ---- the deep judge ----

const K = "ag1:20:k";
const RECORD: ChatJudgeRecord = {
    key: K,
    ts: 1,
    question: "A hay B?",
    options: [{ text: "A, sửa" }, { text: "B, bỏ" }],
    pick: "A, sửa",
    reason: "A sửa đúng gốc",
};
const DONE: ChatJudgeRecord = {
    ...RECORD,
    deep: { state: "done", startts: 5000, endts: 9000, pick: "B, bỏ", reason: "B nhỏ hơn", model: "sonnet", files: 3 },
};

function seed(rec: ChatJudgeRecord = RECORD): void {
    globalStore.set(chatJudgeAtom, { [rec.key]: rec });
}
const stored = (key = K) => globalStore.get(chatJudgeAtom)[key];

function deferred<T>() {
    let resolve!: (v: T) => void;
    let reject!: (e: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

describe("requestDeepJudge", () => {
    it("goes reading at once, asks the judge with a 200 s timeout, and stores the record it answers", async () => {
        vi.spyOn(Date, "now").mockReturnValue(7000);
        seed();
        const call = deferred<ChatJudgeRecord>();
        rpc.ChatJudgeCommand.mockReturnValue(call.promise);
        requestDeepJudge(K, "/proj");
        expect(stored().deep).toEqual({ state: "reading", startts: 7000 });
        expect(stored().pick).toBe("A, sửa");
        expect(rpc.ChatJudgeCommand).toHaveBeenCalledTimes(1);
        expect(rpc.ChatJudgeCommand.mock.calls[0][1]).toEqual({ key: K, cwd: "/proj", retry: false });
        expect(rpc.ChatJudgeCommand.mock.calls[0][2]).toEqual({ timeout: 200_000 });
        call.resolve(DONE);
        await vi.waitFor(() => expect(stored().deep?.state).toBe("done"));
        expect(stored()).toEqual(DONE);
    });

    it("sets failed with the error's message when the call throws", async () => {
        seed();
        rpc.ChatJudgeCommand.mockRejectedValue(new Error("hết giờ sau 180 s"));
        requestDeepJudge(K, "/proj");
        await vi.waitFor(() => expect(stored().deep?.state).toBe("failed"));
        expect(stored().deep?.error).toBe("hết giờ sau 180 s");
        expect(stored().pick).toBe("A, sửa");
    });

    it("sets failed for a call that answers nothing", async () => {
        seed();
        rpc.ChatJudgeCommand.mockResolvedValue(null);
        requestDeepJudge(K, "/proj");
        await vi.waitFor(() => expect(stored().deep?.state).toBe("failed"));
        expect(stored().deep?.error).not.toBe("");
    });

    it("does nothing for a second call while one is in flight for the key", async () => {
        seed();
        const call = deferred<ChatJudgeRecord>();
        rpc.ChatJudgeCommand.mockReturnValue(call.promise);
        requestDeepJudge(K, "/proj");
        requestDeepJudge(K, "/proj");
        requestDeepJudge(K, "/proj", true);
        expect(rpc.ChatJudgeCommand).toHaveBeenCalledTimes(1);
        call.resolve(DONE);
        await vi.waitFor(() => expect(stored().deep?.state).toBe("done"));
    });

    it("frees the key once a call ends, so a failed one can be asked again", async () => {
        seed();
        rpc.ChatJudgeCommand.mockRejectedValueOnce(new Error("x"));
        requestDeepJudge(K, "/proj");
        await vi.waitFor(() => expect(stored().deep?.state).toBe("failed"));
        rpc.ChatJudgeCommand.mockResolvedValueOnce(DONE);
        requestDeepJudge(K, "/proj");
        await vi.waitFor(() => expect(stored().deep?.state).toBe("done"));
        expect(rpc.ChatJudgeCommand).toHaveBeenCalledTimes(2);
    });

    it("sends retry for a stopped record, and for a failed one", async () => {
        for (const state of ["stopped", "failed"]) {
            rpc.ChatJudgeCommand.mockReset();
            seed({ ...RECORD, deep: { state, startts: 1, endts: 2 } });
            rpc.ChatJudgeCommand.mockResolvedValue(DONE);
            requestDeepJudge(K, "/proj");
            expect(rpc.ChatJudgeCommand.mock.calls[0][1]).toEqual({ key: K, cwd: "/proj", retry: true });
            expect(stored().deep?.state).toBe("reading");
            await vi.waitFor(() => expect(stored().deep?.state).toBe("done"));
        }
    });

    it("sends retry when the caller says so", async () => {
        seed();
        rpc.ChatJudgeCommand.mockResolvedValue(DONE);
        requestDeepJudge(K, "/proj", true);
        expect(rpc.ChatJudgeCommand.mock.calls[0][1]).toEqual({ key: K, cwd: "/proj", retry: true });
        await vi.waitFor(() => expect(stored().deep?.state).toBe("done"));
    });

    it("joins a record that is already reading, keeping the start time wavesrv gave it", async () => {
        seed({ ...RECORD, deep: { state: "reading", startts: 1234 } });
        const call = deferred<ChatJudgeRecord>();
        rpc.ChatJudgeCommand.mockReturnValue(call.promise);
        requestDeepJudge(K, "/proj");
        expect(stored().deep).toEqual({ state: "reading", startts: 1234 });
        expect(rpc.ChatJudgeCommand.mock.calls[0][1]).toEqual({ key: K, cwd: "/proj", retry: false });
        call.resolve(DONE);
        await vi.waitFor(() => expect(stored().deep?.state).toBe("done"));
    });

    it("does nothing for a turn with no record", () => {
        requestDeepJudge("nope", "/proj");
        expect(rpc.ChatJudgeCommand).not.toHaveBeenCalled();
        expect(globalStore.get(chatJudgeAtom)).toEqual({});
    });

    it("leaves other turns' records alone", async () => {
        const other: ChatJudgeRecord = { ...RECORD, key: "ag1:30:z" };
        globalStore.set(chatJudgeAtom, { [K]: RECORD, [other.key]: other });
        rpc.ChatJudgeCommand.mockResolvedValue(DONE);
        requestDeepJudge(K, "/proj");
        await vi.waitFor(() => expect(stored().deep?.state).toBe("done"));
        expect(stored(other.key)).toEqual(other);
    });

    it("answers through the DEV fake in place of wavesrv", async () => {
        seed();
        const fake = vi.fn(() => Promise.resolve(DONE));
        vi.stubGlobal("window", { __chatJudgeFake: fake });
        requestDeepJudge(K, "/proj");
        await vi.waitFor(() => expect(stored().deep?.state).toBe("done"));
        expect(fake).toHaveBeenCalledWith("judge", { key: K, cwd: "/proj", retry: false });
        expect(rpc.ChatJudgeCommand).not.toHaveBeenCalled();
    });

    it("sets failed for a fake that throws", async () => {
        seed();
        vi.stubGlobal("window", {
            __chatJudgeFake: () => {
                throw new Error("fake says no");
            },
        });
        requestDeepJudge(K, "/proj");
        await vi.waitFor(() => expect(stored().deep?.state).toBe("failed"));
        expect(stored().deep?.error).toBe("fake says no");
    });
});

describe("stopDeepJudge", () => {
    it("sets stopped at once and tells wavesrv to stop", async () => {
        vi.spyOn(Date, "now").mockReturnValue(9000);
        seed({ ...RECORD, deep: { state: "reading", startts: 5000 } });
        rpc.ChatJudgeStopCommand.mockResolvedValue(undefined);
        stopDeepJudge(K);
        expect(stored().deep).toEqual({ state: "stopped", startts: 5000, endts: 9000 });
        expect(rpc.ChatJudgeStopCommand).toHaveBeenCalledTimes(1);
        expect(rpc.ChatJudgeStopCommand.mock.calls[0][1]).toEqual({ key: K });
    });

    it("stops a judge a call of this window is in flight for, and keeps stopped when that call then fails", async () => {
        seed();
        const call = deferred<ChatJudgeRecord>();
        rpc.ChatJudgeCommand.mockReturnValue(call.promise);
        rpc.ChatJudgeStopCommand.mockResolvedValue(undefined);
        requestDeepJudge(K, "/proj");
        stopDeepJudge(K);
        expect(stored().deep?.state).toBe("stopped");
        call.reject(new Error("judge stopped"));
        await call.promise.catch(() => {});
        await Promise.resolve();
        expect(stored().deep?.state).toBe("stopped");
    });

    it("runs the judge again on the next press, even before the stopped call has returned", async () => {
        seed();
        const first = deferred<ChatJudgeRecord>();
        const second = deferred<ChatJudgeRecord>();
        rpc.ChatJudgeCommand.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
        rpc.ChatJudgeStopCommand.mockResolvedValue(undefined);
        requestDeepJudge(K, "/proj");
        stopDeepJudge(K);
        requestDeepJudge(K, "/proj");
        expect(rpc.ChatJudgeCommand).toHaveBeenCalledTimes(2);
        expect(rpc.ChatJudgeCommand.mock.calls[1][1]).toEqual({ key: K, cwd: "/proj", retry: true });
        expect(stored().deep?.state).toBe("reading");
        // the stopped call comes back late: it must not undo the new one
        first.resolve({ ...RECORD, deep: { state: "stopped", startts: 1, endts: 2 } });
        await first.promise;
        await Promise.resolve();
        expect(stored().deep?.state).toBe("reading");
        second.resolve(DONE);
        await vi.waitFor(() => expect(stored().deep?.state).toBe("done"));
    });

    it("does nothing for a judge that is not reading", () => {
        seed(DONE);
        stopDeepJudge(K);
        expect(stored()).toEqual(DONE);
        seed();
        stopDeepJudge(K);
        stopDeepJudge("nope");
        expect(rpc.ChatJudgeStopCommand).not.toHaveBeenCalled();
    });

    it("answers through the DEV fake too", () => {
        seed({ ...RECORD, deep: { state: "reading", startts: 5000 } });
        const fake = vi.fn(() => undefined);
        vi.stubGlobal("window", { __chatJudgeFake: fake });
        stopDeepJudge(K);
        expect(fake).toHaveBeenCalledWith("stop", { key: K });
        expect(rpc.ChatJudgeStopCommand).not.toHaveBeenCalled();
    });
});

describe("runLiveJudge", () => {
    const live = (action: "judge" | "retry" | "stop") =>
        globalStore.set(liveJudgeAtom, { ag1: { key: K, cwd: "/proj", action } });

    it("runs the deep judge for the action judge", () => {
        seed();
        rpc.ChatJudgeCommand.mockReturnValue(new Promise(() => {}));
        live("judge");
        runLiveJudge("ag1");
        expect(rpc.ChatJudgeCommand.mock.calls[0][1]).toEqual({ key: K, cwd: "/proj", retry: false });
    });

    it("runs it again with retry for the action retry", () => {
        seed({ ...RECORD, deep: { state: "failed", startts: 1, error: "x" } });
        rpc.ChatJudgeCommand.mockReturnValue(new Promise(() => {}));
        live("retry");
        runLiveJudge("ag1");
        expect(rpc.ChatJudgeCommand.mock.calls[0][1]).toEqual({ key: K, cwd: "/proj", retry: true });
    });

    it("stops the judge for the action stop", () => {
        seed({ ...RECORD, deep: { state: "reading", startts: 5000 } });
        rpc.ChatJudgeStopCommand.mockResolvedValue(undefined);
        live("stop");
        runLiveJudge("ag1");
        expect(rpc.ChatJudgeStopCommand.mock.calls[0][1]).toEqual({ key: K });
        expect(stored().deep?.state).toBe("stopped");
    });

    it("does nothing for an agent whose pane offers nothing", () => {
        seed();
        runLiveJudge("ag1");
        globalStore.set(liveJudgeAtom, { ag1: undefined });
        runLiveJudge("ag1");
        expect(rpc.ChatJudgeCommand).not.toHaveBeenCalled();
        expect(rpc.ChatJudgeStopCommand).not.toHaveBeenCalled();
    });
});

describe("loadChatJudges", () => {
    const R1: ChatJudgeRecord = { ...RECORD, key: "ag1:20:a" };
    const R2: ChatJudgeRecord = { ...RECORD, key: "ag1:30:b", deep: { state: "failed", startts: 1, error: "x" } };

    it("asks for the agent's records, once, and puts them in the atom by key", async () => {
        rpc.ChatJudgeListCommand.mockResolvedValue({ records: [R1, R2] });
        loadChatJudges("ag1");
        loadChatJudges("ag1");
        await vi.waitFor(() => expect(Object.keys(globalStore.get(chatJudgeAtom))).toHaveLength(2));
        expect(globalStore.get(chatJudgeAtom)).toEqual({ [R1.key]: R1, [R2.key]: R2 });
        loadChatJudges("ag1");
        expect(rpc.ChatJudgeListCommand).toHaveBeenCalledTimes(1);
        expect(rpc.ChatJudgeListCommand.mock.calls[0][1]).toEqual({ agentid: "ag1" });
    });

    it("asks once per agent", async () => {
        rpc.ChatJudgeListCommand.mockResolvedValue({ records: [] });
        loadChatJudges("ag1");
        loadChatJudges("ag2");
        loadChatJudges("ag2");
        await vi.waitFor(() => expect(rpc.ChatJudgeListCommand).toHaveBeenCalledTimes(2));
        expect(rpc.ChatJudgeListCommand.mock.calls.map((c) => (c[1] as CommandChatJudgeListData).agentid)).toEqual([
            "ag1",
            "ag2",
        ]);
    });

    it("keeps a record already in the atom over the list's older copy of it", async () => {
        seed({ ...R1, deep: { state: "reading", startts: 99 } });
        rpc.ChatJudgeListCommand.mockResolvedValue({ records: [R1, R2] });
        loadChatJudges("ag1");
        await vi.waitFor(() => expect(globalStore.get(chatJudgeAtom)[R2.key]).toEqual(R2));
        expect(globalStore.get(chatJudgeAtom)[R1.key]?.deep).toEqual({ state: "reading", startts: 99 });
    });

    it("takes an answer with no records as none", async () => {
        rpc.ChatJudgeListCommand.mockResolvedValue({});
        loadChatJudges("ag1");
        await vi.waitFor(() => expect(rpc.ChatJudgeListCommand).toHaveBeenCalled());
        await Promise.resolve();
        expect(globalStore.get(chatJudgeAtom)).toEqual({});
    });

    it("asks again after a failed read, and says so in the log", async () => {
        const log = vi.spyOn(console, "log").mockImplementation(() => {});
        rpc.ChatJudgeListCommand.mockRejectedValueOnce(new Error("down"));
        loadChatJudges("ag1");
        await vi.waitFor(() => expect(log).toHaveBeenCalled());
        rpc.ChatJudgeListCommand.mockResolvedValueOnce({ records: [R1] });
        loadChatJudges("ag1");
        await vi.waitFor(() => expect(globalStore.get(chatJudgeAtom)[R1.key]).toEqual(R1));
        expect(rpc.ChatJudgeListCommand).toHaveBeenCalledTimes(2);
    });

    it("asks again for an agent after a reset: the stand-in for an app restart", async () => {
        const fake = vi.fn((_cmd: string, _data: unknown) => Promise.resolve({ records: [R1] }));
        vi.stubGlobal("window", { __chatJudgeFake: fake });
        loadChatJudges("ag1");
        await vi.waitFor(() => expect(globalStore.get(chatJudgeAtom)[R1.key]).toEqual(R1));
        loadChatJudges("ag1");
        expect(fake).toHaveBeenCalledTimes(1);
        expect(fake).toHaveBeenCalledWith("list", { agentid: "ag1" });
        resetChatJudges();
        expect(globalStore.get(chatJudgeAtom)).toEqual({});
        loadChatJudges("ag1");
        await vi.waitFor(() => expect(globalStore.get(chatJudgeAtom)[R1.key]).toEqual(R1));
        expect(fake).toHaveBeenCalledTimes(2);
        expect(rpc.ChatJudgeListCommand).not.toHaveBeenCalled();
    });
});

describe("resetChatJudges", () => {
    it("forgets a deep judge call in flight: its late answer is not kept, and the turn can be judged again", async () => {
        seed();
        const call = deferred<ChatJudgeRecord>();
        rpc.ChatJudgeCommand.mockReturnValueOnce(call.promise).mockResolvedValueOnce(DONE);
        requestDeepJudge(K, "/proj");
        resetChatJudges();
        seed();
        call.resolve({ ...DONE, pick: "late" });
        await call.promise;
        await Promise.resolve();
        expect(stored()).toEqual(RECORD);
        requestDeepJudge(K, "/proj");
        expect(rpc.ChatJudgeCommand).toHaveBeenCalledTimes(2);
        await vi.waitFor(() => expect(stored().deep?.state).toBe("done"));
    });
});

describe("window.__chatJudgeReset", () => {
    it("is put on window in DEV, and empties the atom and the once-per-agent memo", async () => {
        vi.resetModules();
        const fake = vi.fn((_cmd: string, _data: unknown) => Promise.resolve({ records: [RECORD] }));
        const win: { __chatJudgeFake: typeof fake; __chatJudgeReset?: () => void } = { __chatJudgeFake: fake };
        vi.stubGlobal("window", win);
        const store = await import("./chatsuggeststore");
        const { globalStore: gs } = await import("@/app/store/jotaiStore");
        expect(typeof win.__chatJudgeReset).toBe("function");
        store.loadChatJudges("ag1");
        await vi.waitFor(() => expect(gs.get(store.chatJudgeAtom)[K]).toEqual(RECORD));
        win.__chatJudgeReset?.();
        expect(gs.get(store.chatJudgeAtom)).toEqual({});
        store.loadChatJudges("ag1");
        await vi.waitFor(() => expect(gs.get(store.chatJudgeAtom)[K]).toEqual(RECORD));
        expect(fake).toHaveBeenCalledTimes(2);
    });
});
