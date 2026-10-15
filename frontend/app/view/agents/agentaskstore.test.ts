import { globalStore } from "@/app/store/jotaiStore";
import { waveEventSubscribeSingle } from "@/app/store/wps";
import { RpcApi } from "@/app/store/wshclientapi";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getAgentAskAtom, sentAskIdsAtom, setupAgentAskSubscription } from "./agentaskstore";
import { attentionAtom } from "./attentionstore";

vi.mock("@/app/store/wps", () => ({ waveEventSubscribeSingle: vi.fn() }));
vi.mock("@/app/store/wshclientapi", () => ({
    RpcApi: { GetAttentionCommand: vi.fn(), AgentAskPendingCommand: vi.fn() },
}));
vi.mock("@/app/store/wshrpcutil", () => ({ TabRpcClient: {} }));

const staleAttention = {
    kind: "ask",
    key: "ask:block:worker",
    source: "worker",
    text: "Waiting on your reply",
    action: "Answer",
    waitingsince: 1,
} as AttentionItem;

function statusHandler(): (event: WaveEvent) => void {
    const subscription = vi
        .mocked(waveEventSubscribeSingle)
        .mock.calls.map(([request]) => request)
        .find((request) => request.eventType === "agent:status");
    expect(subscription).toBeDefined();
    return subscription!.handler as (event: WaveEvent) => void;
}

describe("agent ask events", () => {
    beforeAll(() => setupAgentAskSubscription());

    beforeEach(() => {
        vi.mocked(RpcApi.GetAttentionCommand).mockReset();
        globalStore.set(attentionAtom, [staleAttention]);
    });

    it("refreshes cockpit attention when an ask is cleared", async () => {
        vi.mocked(RpcApi.GetAttentionCommand).mockResolvedValue({ items: [] });
        const subscription = vi
            .mocked(waveEventSubscribeSingle)
            .mock.calls.map(([request]) => request)
            .find((request) => request.eventType === "agent:ask");
        expect(subscription).toBeDefined();

        subscription!.handler({
            data: { oref: "block:worker", askid: "ask-1", cleared: true },
        } as WaveEvent);

        await vi.waitFor(() => expect(globalStore.get(attentionAtom)).toEqual([]));
    });

    it("does not clear a replacement ask with an older ask id", () => {
        vi.mocked(RpcApi.GetAttentionCommand).mockResolvedValue({ items: [] });
        const subscription = vi
            .mocked(waveEventSubscribeSingle)
            .mock.calls.map(([request]) => request)
            .find((request) => request.eventType === "agent:ask");
        expect(subscription).toBeDefined();
        const replacement = { oref: "block:worker", askid: "ask-b", cleared: false } as AgentAskData;

        subscription!.handler({ data: replacement } as WaveEvent);
        subscription!.handler({
            data: { oref: "block:worker", askid: "ask-a", cleared: true },
        } as WaveEvent);

        expect(globalStore.get(getAgentAskAtom("block:worker"))).toEqual(replacement);
    });

    // A restored ask keeps its original id, so the submit lock taken when the answer was sent would
    // otherwise leave the answer bar stuck on "Answered" with no way to answer the question again.
    it("releases the submit lock when an unanswered ask comes back", () => {
        vi.mocked(RpcApi.GetAttentionCommand).mockResolvedValue({ items: [] });
        globalStore.set(sentAskIdsAtom, new Set(["ask-1"]));
        const subscription = vi
            .mocked(waveEventSubscribeSingle)
            .mock.calls.map(([request]) => request)
            .find((request) => request.eventType === "agent:ask");

        subscription!.handler({
            data: {
                oref: "block:worker",
                askid: "ask-1",
                cleared: false,
                note: "answer was sent but never confirmed",
            },
        } as WaveEvent);

        expect(globalStore.get(sentAskIdsAtom).has("ask-1")).toBe(false);
    });

    // without a note the raise is the original ask redelivered (persisted event, reconnect); releasing
    // the lock there would re-open the answer bar on an answer that is still on its way
    it("keeps the submit lock on a raise with no note", () => {
        vi.mocked(RpcApi.GetAttentionCommand).mockResolvedValue({ items: [] });
        globalStore.set(sentAskIdsAtom, new Set(["ask-2"]));
        const subscription = vi
            .mocked(waveEventSubscribeSingle)
            .mock.calls.map(([request]) => request)
            .find((request) => request.eventType === "agent:ask");

        subscription!.handler({
            data: { oref: "block:worker", askid: "ask-2", cleared: false },
        } as WaveEvent);

        expect(globalStore.get(sentAskIdsAtom).has("ask-2")).toBe(true);
    });

    it("drops the submit lock once the agent clears the ask", () => {
        vi.mocked(RpcApi.GetAttentionCommand).mockResolvedValue({ items: [] });
        globalStore.set(sentAskIdsAtom, new Set(["ask-3"]));
        const subscription = vi
            .mocked(waveEventSubscribeSingle)
            .mock.calls.map(([request]) => request)
            .find((request) => request.eventType === "agent:ask");

        subscription!.handler({
            data: { oref: "block:worker", askid: "ask-3", cleared: true },
        } as WaveEvent);

        expect(globalStore.get(sentAskIdsAtom).has("ask-3")).toBe(false);
    });

    // an ask whose clear never reached the cockpit read as asking at every idle until a reload: going idle checks the
    // ask on screen against the one the server holds
    it("drops the ask on screen when the agent goes idle and the server holds none", async () => {
        vi.mocked(RpcApi.GetAttentionCommand).mockResolvedValue({ items: [] });
        vi.mocked(RpcApi.AgentAskPendingCommand).mockResolvedValue("");
        globalStore.set(getAgentAskAtom("block:stuck"), { oref: "block:stuck", askid: "ask-z" } as AgentAskData);
        globalStore.set(sentAskIdsAtom, new Set(["ask-z"]));

        statusHandler()({ data: { oref: "block:stuck", state: "idle", ts: 5 } } as WaveEvent);

        await vi.waitFor(() => expect(globalStore.get(getAgentAskAtom("block:stuck"))).toBeNull());
        expect(RpcApi.AgentAskPendingCommand).toHaveBeenCalledWith(expect.anything(), "block:stuck");
        expect(globalStore.get(sentAskIdsAtom).has("ask-z")).toBe(false);
    });

    it("keeps the ask on screen when the server still holds it", async () => {
        vi.mocked(RpcApi.AgentAskPendingCommand).mockResolvedValue("ask-live");
        const live = { oref: "block:live", askid: "ask-live" } as AgentAskData;
        globalStore.set(getAgentAskAtom("block:live"), live);

        statusHandler()({ data: { oref: "block:live", state: "idle", ts: 5 } } as WaveEvent);

        await vi.waitFor(() =>
            expect(RpcApi.AgentAskPendingCommand).toHaveBeenCalledWith(expect.anything(), "block:live")
        );
        await Promise.resolve();
        expect(globalStore.get(getAgentAskAtom("block:live"))).toEqual(live);
    });

    // the check is out while a new question arrives: the answer is about the ask it was made for, not the new one
    it("keeps an ask raised while the check was out", async () => {
        let answer!: (id: string) => void;
        vi.mocked(RpcApi.AgentAskPendingCommand).mockReturnValue(new Promise((resolve) => (answer = resolve)));
        globalStore.set(getAgentAskAtom("block:race"), { oref: "block:race", askid: "ask-old" } as AgentAskData);

        statusHandler()({ data: { oref: "block:race", state: "idle", ts: 5 } } as WaveEvent);
        const newer = { oref: "block:race", askid: "ask-new" } as AgentAskData;
        globalStore.set(getAgentAskAtom("block:race"), newer);
        answer("");
        await Promise.resolve();
        await Promise.resolve();

        expect(globalStore.get(getAgentAskAtom("block:race"))).toEqual(newer);
    });

    it("asks the server nothing for a working status or a block with no ask", () => {
        vi.mocked(RpcApi.AgentAskPendingCommand).mockReset();
        globalStore.set(getAgentAskAtom("block:busy"), { oref: "block:busy", askid: "ask-b" } as AgentAskData);

        statusHandler()({ data: { oref: "block:busy", state: "working", ts: 5 } } as WaveEvent);
        statusHandler()({ data: { oref: "block:none", state: "idle", ts: 5 } } as WaveEvent);

        expect(RpcApi.AgentAskPendingCommand).not.toHaveBeenCalled();
    });

    it("refreshes cockpit attention when an agent block closes", async () => {
        vi.mocked(RpcApi.GetAttentionCommand).mockResolvedValue({ items: [] });
        const subscription = vi
            .mocked(waveEventSubscribeSingle)
            .mock.calls.map(([request]) => request)
            .find((request) => request.eventType === "blockclose");
        expect(subscription).toBeDefined();

        subscription!.handler({ data: "worker" } as WaveEvent);

        await vi.waitFor(() => expect(globalStore.get(attentionAtom)).toEqual([]));
    });
});
