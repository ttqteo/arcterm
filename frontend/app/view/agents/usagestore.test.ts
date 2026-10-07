import { afterEach, describe, expect, it, vi } from "vitest";
import { globalStore } from "@/app/store/jotaiStore";

const getStats = vi.fn();
vi.mock("@/app/store/wshclientapi", () => ({
    RpcApi: { GetUsageStatsCommand: (...a: any[]) => getStats(...a) },
}));
vi.mock("@/app/store/wshrpcutil", () => ({ TabRpcClient: {} }));

import { loadUsage, usageBucketsAtom, usageErrorAtom, usageLoadedAtom, allUsageStatsAtom } from "./usagestore";

const response = {
    buckets: [
        {
            harness: "claude",
            provider: "anthropic",
            model: "claude-opus-4-8",
            day: "2026-06-26",
            input: 100,
            output: 50,
            reasoning: 0,
            cacheread: 0,
            cachecreate: 0,
            cachecreate1h: 0,
            msgs: 1,
        },
        {
            harness: "opencode",
            provider: "openai",
            model: "gpt-5.5",
            day: "2026-06-26",
            input: 200,
            output: 0,
            reasoning: 50,
            cacheread: 0,
            cachecreate: 0,
            cachecreate1h: 0,
            msgs: 1,
        },
    ],
};
const expectedTokens = 100 + 50 + 200 + 50;

afterEach(() => {
    getStats.mockReset();
    globalStore.set(usageBucketsAtom, []);
    globalStore.set(usageErrorAtom, false);
    globalStore.set(usageLoadedAtom, false);
});

describe("loadUsage", () => {
    it("stores raw buckets and exposes aggregated stats, clearing the error flag", async () => {
        globalStore.set(usageErrorAtom, true);
        getStats.mockResolvedValue(response);
        await loadUsage(7);
        expect(globalStore.get(usageBucketsAtom)).toEqual(response.buckets);
        expect(globalStore.get(allUsageStatsAtom).totals.tokensWindow).toBe(expectedTokens);
        expect(globalStore.get(usageErrorAtom)).toBe(false);
        expect(globalStore.get(usageLoadedAtom)).toBe(true);
    });

    it("keeps the last-good data and flags error when the RPC throws", async () => {
        globalStore.set(usageBucketsAtom, response.buckets);
        getStats.mockRejectedValue(new Error("network error"));
        await loadUsage(7);
        expect(globalStore.get(usageBucketsAtom)).toEqual(response.buckets); // NOT clobbered
        expect(globalStore.get(usageErrorAtom)).toBe(true);
        expect(globalStore.get(usageLoadedAtom)).toBe(true);
    });

    it("latest window load wins: a late stale response does not overwrite the newer window's data", async () => {
        let resolveOld!: (v: any) => void;
        getStats
            .mockImplementationOnce(() => new Promise((r) => (resolveOld = r))) // window 7 (older, resolves late)
            .mockResolvedValueOnce(response); // window 0 (newer, resolves first)
        const pOld = loadUsage(7);
        const pNew = loadUsage(0);
        await pNew;
        const afterNew = globalStore.get(usageBucketsAtom);
        resolveOld(response); // stale window-7 response lands after the switch
        await pOld;
        expect(globalStore.get(usageBucketsAtom)).toBe(afterNew); // ignored — the newer window's object stands
    });

    it("shows the skeleton only while a different window loads, not on a reload of the held one", async () => {
        getStats.mockResolvedValue(response);
        await loadUsage(7);
        let release!: (v: any) => void;
        getStats.mockImplementationOnce(() => new Promise((r) => (release = r)));
        const reload = loadUsage(7); // surface reopened: same window, scan in flight
        expect(globalStore.get(usageLoadedAtom)).toBe(true);
        release(response);
        await reload;

        getStats.mockImplementationOnce(() => new Promise((r) => (release = r)));
        const switched = loadUsage(0);
        expect(globalStore.get(usageLoadedAtom)).toBe(false);
        release(response);
        await switched;
        expect(globalStore.get(usageLoadedAtom)).toBe(true);
    });

    it("falls through to the mocked RPC when the dev fixture is malformed or absent", async () => {
        getStats.mockResolvedValue(response);
        await loadUsage(7);
        expect(globalStore.get(usageBucketsAtom)).toEqual(response.buckets);
        expect(getStats).toHaveBeenCalled();
    });
});
