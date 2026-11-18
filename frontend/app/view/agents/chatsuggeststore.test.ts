// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.hoisted(() => ({ ChatSuggestCommand: vi.fn() }));

vi.mock("@/app/store/wshclientapi", () => ({ RpcApi: rpc }));
vi.mock("@/app/store/wshrpcutil", () => ({ TabRpcClient: {} }));

import { globalStore } from "@/app/store/jotaiStore";
import { turnSummary, type ModelSuggest } from "./chatsuggest";
import { modelSuggestAtom, requestModelSuggest } from "./chatsuggeststore";

const DATA: CommandChatSuggestData = { reply: "một câu trả lời dài", recent: ["làm đi"], question: false };

/** the answer stored under `key`, once the call has settled */
async function settled(key: string): Promise<ModelSuggest> {
    await vi.waitFor(() => expect(globalStore.get(modelSuggestAtom)[key]?.status).not.toBe("loading"));
    return globalStore.get(modelSuggestAtom)[key];
}

beforeEach(() => {
    globalStore.set(modelSuggestAtom, {});
    rpc.ChatSuggestCommand.mockReset();
});

afterEach(() => {
    vi.unstubAllGlobals();
});

describe("requestModelSuggest", () => {
    it("sends the data as given, summary flag included, and keeps the answer's summary beside its replies", async () => {
        rpc.ChatSuggestCommand.mockResolvedValue({ replies: ["vẽ tôi xem"], summary: "Mình đã sửa. Chưa chạy test." });
        const data = { ...DATA, summary: true };
        requestModelSuggest("k1", data);
        expect(globalStore.get(modelSuggestAtom)["k1"]).toEqual({ status: "loading" });
        const done = await settled("k1");
        expect(rpc.ChatSuggestCommand).toHaveBeenCalledTimes(1);
        expect(rpc.ChatSuggestCommand.mock.calls[0][1]).toBe(data);
        expect(done).toEqual({ status: "done", replies: ["vẽ tôi xem"], summary: "Mình đã sửa. Chưa chạy test." });
        expect(turnSummary(done)).toBe("Mình đã sửa. Chưa chạy test.");
    });

    it("keeps no summary for an answer without one or with an empty one", async () => {
        rpc.ChatSuggestCommand.mockResolvedValueOnce({ replies: ["a"] });
        rpc.ChatSuggestCommand.mockResolvedValueOnce({ replies: ["b"], summary: "" });
        requestModelSuggest("k2", DATA);
        requestModelSuggest("k3", DATA);
        expect(await settled("k2")).toEqual({ status: "done", replies: ["a"] });
        expect(await settled("k3")).toEqual({ status: "done", replies: ["b"] });
    });

    it("marks a call that threw failed, with no summary", async () => {
        rpc.ChatSuggestCommand.mockRejectedValue(new Error("boom"));
        requestModelSuggest("k4", { ...DATA, summary: true });
        const failed = await settled("k4");
        expect(failed).toEqual({ status: "failed" });
        expect(turnSummary(failed)).toBeUndefined();
    });

    it("asks a turn once: a second ask for the same key makes no second call", async () => {
        rpc.ChatSuggestCommand.mockResolvedValue({ replies: ["a"] });
        requestModelSuggest("k5", DATA);
        requestModelSuggest("k5", DATA);
        await settled("k5");
        requestModelSuggest("k5", DATA);
        expect(rpc.ChatSuggestCommand).toHaveBeenCalledTimes(1);
    });

    describe("the DEV fake", () => {
        it("takes an array as replies with no summary, as the scenarios already answer", async () => {
            const fake = vi.fn(() => ["ok", "vẽ thử"]);
            vi.stubGlobal("window", { __chatSuggestFake: fake });
            requestModelSuggest("f1", { ...DATA, summary: true });
            expect(await settled("f1")).toEqual({ status: "done", replies: ["ok", "vẽ thử"] });
            expect(fake).toHaveBeenCalledWith({ ...DATA, summary: true });
            expect(rpc.ChatSuggestCommand).not.toHaveBeenCalled();
        });

        it("takes an object with replies and a summary, sync or as a promise", async () => {
            vi.stubGlobal("window", {
                __chatSuggestFake: () => Promise.resolve({ replies: ["A"], summary: "Đã làm xong phần một." }),
            });
            requestModelSuggest("f2", { ...DATA, summary: true });
            expect(await settled("f2")).toEqual({
                status: "done",
                replies: ["A"],
                summary: "Đã làm xong phần một.",
            });
            vi.stubGlobal("window", { __chatSuggestFake: () => ({ replies: ["B"] }) });
            requestModelSuggest("f3", DATA);
            expect(await settled("f3")).toEqual({ status: "done", replies: ["B"] });
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
