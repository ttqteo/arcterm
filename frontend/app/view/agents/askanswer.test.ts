// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { afterEach, describe, expect, it, vi } from "vitest";

const answer = vi.hoisted(() => vi.fn());
const pushToast = vi.hoisted(() => vi.fn());
vi.mock("@/app/store/wshclientapi", () => ({ RpcApi: { AnswerAgentCommand: answer } }));
vi.mock("@/app/store/wshrpcutil", () => ({ TabRpcClient: {} }));
vi.mock("@/app/cockpit/notificationstore", () => ({ pushToast }));

import { globalStore } from "@/app/store/jotaiStore";
import { atom, type PrimitiveAtom } from "jotai";
import type { AgentVM } from "./agentsviewmodel";
import { answerAgentAsk } from "./askanswer";

function model() {
    const agent = {
        id: "a1",
        ask: { askId: "ask-1", oref: "block:b1", questions: [{ question: "Go?", options: [{ label: "Yes" }] }] },
    } as unknown as AgentVM;
    return {
        agentsAtom: atom<AgentVM[]>([agent]),
        sentIdsAtom: atom(new Set<string>()) as PrimitiveAtom<Set<string>>,
    };
}

const settle = () => new Promise<void>((r) => setTimeout(r, 0));

afterEach(() => vi.clearAllMocks());

describe("answerAgentAsk", () => {
    it("locks the ask while the answer is out, and keeps it locked once it lands", async () => {
        answer.mockResolvedValue(undefined);
        const m = model();
        expect(answerAgentAsk(m, "a1", { 0: new Set([0]) }, {})).toBe(true);
        expect(globalStore.get(m.sentIdsAtom).has("ask-1")).toBe(true);
        await settle();
        expect(globalStore.get(m.sentIdsAtom).has("ask-1")).toBe(true);
        expect(pushToast).not.toHaveBeenCalled();
    });

    it("unlocks the ask and says so when the answer does not reach the agent", async () => {
        answer.mockRejectedValue(new Error("timeout"));
        const m = model();
        answerAgentAsk(m, "a1", { 0: new Set([0]) }, {});
        await settle();
        expect(globalStore.get(m.sentIdsAtom).has("ask-1")).toBe(false);
        expect(pushToast).toHaveBeenCalledWith(expect.objectContaining({ level: "error" }));
    });

    it("lets the unlocked ask be answered again", async () => {
        answer.mockRejectedValueOnce(new Error("timeout")).mockResolvedValueOnce(undefined);
        const m = model();
        answerAgentAsk(m, "a1", { 0: new Set([0]) }, {});
        await settle();
        expect(answerAgentAsk(m, "a1", { 0: new Set([0]) }, {})).toBe(true);
        await settle();
        expect(answer).toHaveBeenCalledTimes(2);
        expect(globalStore.get(m.sentIdsAtom).has("ask-1")).toBe(true);
    });

    it("sends an answer once: a second call while the first is out sends nothing", async () => {
        answer.mockResolvedValue(undefined);
        const m = model();
        expect(answerAgentAsk(m, "a1", { 0: new Set([0]) }, {})).toBe(true);
        expect(answerAgentAsk(m, "a1", { 0: new Set([0]) }, {})).toBe(false);
        await settle();
        expect(answer).toHaveBeenCalledTimes(1);
    });
});
