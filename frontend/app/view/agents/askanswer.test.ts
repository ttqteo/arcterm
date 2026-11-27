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
import { getAgentAskAtom } from "./agentaskstore";
import type { AgentVM } from "./agentsviewmodel";
import { answerAgentAsk } from "./askanswer";
import { dropHeldAnswer, getHeldAnswerAtom } from "./sleepheld";

function model(over: Partial<AgentVM> = {}) {
    const agent = {
        id: "a1",
        ask: { askId: "ask-1", oref: "block:b1", questions: [{ question: "Go?", options: [{ label: "Yes" }] }] },
        ...over,
    } as unknown as AgentVM;
    return {
        agentsAtom: atom<AgentVM[]>([agent]),
        sentIdsAtom: atom(new Set<string>()) as PrimitiveAtom<Set<string>>,
    };
}

const settle = () => new Promise<void>((r) => setTimeout(r, 0));

afterEach(() => {
    vi.clearAllMocks();
    dropHeldAnswer("block:b1");
    globalStore.set(getAgentAskAtom("block:b1"), null);
});

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

describe("answerAgentAsk for an agent asleep with its ask kept", () => {
    const SINCE = 1_700_000_000_000;
    const asleep = { sleeping: { since: SINCE, freedBytes: 0, asking: true } };
    const raised = { oref: "block:b1", askid: "ask-1", questions: [] } as AgentAskData;

    it("keeps the answer for the wake once wavesrv holds it, and takes the question off the row", async () => {
        answer.mockResolvedValue(undefined);
        globalStore.set(getAgentAskAtom("block:b1"), raised);
        const m = model(asleep);
        expect(answerAgentAsk(m, "a1", { 0: new Set([0]) }, {})).toBe(true);
        // not yet: wavesrv has not accepted it, so the card stays up (locked) and nothing is shown as held
        expect(globalStore.get(getHeldAnswerAtom("block:b1"))).toBeNull();
        expect(globalStore.get(getAgentAskAtom("block:b1"))).toBe(raised);
        await settle();
        expect(globalStore.get(getHeldAnswerAtom("block:b1"))).toEqual({
            since: SINCE,
            lines: [{ question: "Go?", answers: ["Yes"] }],
        });
        expect(globalStore.get(getAgentAskAtom("block:b1"))).toBeNull();
        expect(pushToast).not.toHaveBeenCalled();
    });

    it("keeps typed words as the answer", async () => {
        answer.mockResolvedValue(undefined);
        const m = model(asleep);
        answerAgentAsk(m, "a1", {}, { 0: "yes, on the hot path" });
        await settle();
        expect(globalStore.get(getHeldAnswerAtom("block:b1"))?.lines).toEqual([
            { question: "Go?", answers: ["yes, on the hot path"] },
        ]);
    });

    it("keeps nothing when wavesrv refuses it: the ask unlocks, stays on the row and the person is told", async () => {
        answer.mockRejectedValue(new Error("no pending question"));
        globalStore.set(getAgentAskAtom("block:b1"), raised);
        const m = model(asleep);
        answerAgentAsk(m, "a1", { 0: new Set([0]) }, {});
        await settle();
        expect(globalStore.get(getHeldAnswerAtom("block:b1"))).toBeNull();
        expect(globalStore.get(getAgentAskAtom("block:b1"))).toBe(raised);
        expect(globalStore.get(m.sentIdsAtom).has("ask-1")).toBe(false);
        expect(pushToast).toHaveBeenCalledWith(expect.objectContaining({ level: "error" }));
    });

    it("keeps nothing for an awake agent, whose answer is typed into its terminal and cleared by the agent", async () => {
        answer.mockResolvedValue(undefined);
        globalStore.set(getAgentAskAtom("block:b1"), raised);
        const m = model();
        answerAgentAsk(m, "a1", { 0: new Set([0]) }, {});
        await settle();
        expect(globalStore.get(getHeldAnswerAtom("block:b1"))).toBeNull();
        expect(globalStore.get(getAgentAskAtom("block:b1"))).toBe(raised);
    });
});
