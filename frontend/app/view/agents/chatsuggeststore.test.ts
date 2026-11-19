// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.hoisted(() => ({ ChatSuggestCommand: vi.fn() }));

vi.mock("@/app/store/wshclientapi", () => ({ RpcApi: rpc }));
vi.mock("@/app/store/wshrpcutil", () => ({ TabRpcClient: {} }));

import { globalStore } from "@/app/store/jotaiStore";
import type { ModelSuggest } from "./chatsuggest";
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
    it("sends the data as given and keeps the answer's replies", async () => {
        rpc.ChatSuggestCommand.mockResolvedValue({ replies: ["vẽ tôi xem"] });
        requestModelSuggest("k1", DATA);
        expect(globalStore.get(modelSuggestAtom)["k1"]).toEqual({ status: "loading" });
        const done = await settled("k1");
        expect(rpc.ChatSuggestCommand).toHaveBeenCalledTimes(1);
        expect(rpc.ChatSuggestCommand.mock.calls[0][1]).toBe(DATA);
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

    describe("the DEV fake", () => {
        it("takes the replies it answers, sync or as a promise, and makes no call", async () => {
            const fake = vi.fn(() => ["ok", "vẽ thử"]);
            vi.stubGlobal("window", { __chatSuggestFake: fake });
            requestModelSuggest("f1", DATA);
            expect(await settled("f1")).toEqual({ status: "done", replies: ["ok", "vẽ thử"] });
            expect(fake).toHaveBeenCalledWith(DATA);
            vi.stubGlobal("window", { __chatSuggestFake: () => Promise.resolve(["A"]) });
            requestModelSuggest("f2", DATA);
            expect(await settled("f2")).toEqual({ status: "done", replies: ["A"] });
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
