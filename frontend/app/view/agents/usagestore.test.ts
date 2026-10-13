import { afterEach, describe, expect, it, vi } from "vitest";
import { globalStore } from "@/app/store/jotaiStore";

const getStats = vi.fn();
vi.mock("@/app/store/wshclientapi", () => ({
    RpcApi: { GetUsageStatsCommand: (...a: any[]) => getStats(...a) },
}));
vi.mock("@/app/store/wshrpcutil", () => ({ TabRpcClient: {} }));

import {
    allUsageStatsAtom,
    loadUsage,
    usageBucketsAtom,
    usageErrorAtom,
    usageLensAtom,
    usageLoadedAtom,
    usageSessionsAtom,
    usageWorkItemAtom,
    usageWorkScopeAtom,
} from "./usagestore";

const FIXTURE_KEY = "wave:dev-usage-buckets";
const sessions = [{ harness: "claude", session: "s1", title: "Fix the rail", project: "C:/work/waveterm" }];

function seedFixture(raw: string) {
    vi.stubGlobal("localStorage", { getItem: (key: string) => (key === FIXTURE_KEY ? raw : null) });
}

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
    vi.unstubAllGlobals();
    globalStore.set(usageSessionsAtom, []);
    globalStore.set(usageLensAtom, "provider");
    globalStore.set(usageWorkScopeAtom, "all");
    globalStore.set(usageWorkItemAtom, null);
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

    it("fills both atoms from a {buckets, sessions} dev fixture without calling the RPC", async () => {
        seedFixture(JSON.stringify({ buckets: response.buckets, sessions }));
        await loadUsage(7);
        expect(globalStore.get(usageBucketsAtom)).toEqual(response.buckets);
        expect(globalStore.get(usageSessionsAtom)).toEqual(sessions);
        expect(getStats).not.toHaveBeenCalled();
    });

    it.each([
        ["a bare array", JSON.stringify(response.buckets)],
        ["an object with no buckets", JSON.stringify({ sessions })],
        ["malformed json", "{not json"],
    ])("falls through to the RPC when the dev fixture is %s", async (_name, raw) => {
        seedFixture(raw);
        getStats.mockResolvedValue({ buckets: response.buckets, sessions });
        await loadUsage(7);
        expect(getStats).toHaveBeenCalled();
        expect(globalStore.get(usageBucketsAtom)).toEqual(response.buckets);
        expect(globalStore.get(usageSessionsAtom)).toEqual(sessions);
    });

    it("sets neither atom from a superseded load", async () => {
        let resolveOld!: (v: any) => void;
        getStats
            .mockImplementationOnce(() => new Promise((r) => (resolveOld = r)))
            .mockResolvedValueOnce({ buckets: [], sessions: [] });
        const pOld = loadUsage(7);
        await loadUsage(0);
        resolveOld({ buckets: response.buckets, sessions });
        await pOld;
        expect(globalStore.get(usageBucketsAtom)).toEqual([]);
        expect(globalStore.get(usageSessionsAtom)).toEqual([]);
    });

    it("keeps the last sessions, like the last buckets, when the RPC throws", async () => {
        getStats.mockResolvedValueOnce({ buckets: response.buckets, sessions });
        await loadUsage(7);
        getStats.mockRejectedValue(new Error("network error"));
        await loadUsage(7);
        expect(globalStore.get(usageSessionsAtom)).toEqual(sessions);
        expect(globalStore.get(usageBucketsAtom)).toEqual(response.buckets);
        expect(globalStore.get(usageErrorAtom)).toBe(true);
    });

    it("keeps the lens, scope and drilled item across a reload of the same window", async () => {
        getStats.mockResolvedValue({ buckets: response.buckets, sessions });
        await loadUsage(7);
        const item = { key: "run:r1", back: "all" };
        globalStore.set(usageLensAtom, "work");
        globalStore.set(usageWorkScopeAtom, "C:/work/waveterm");
        globalStore.set(usageWorkItemAtom, item);
        await loadUsage(7);
        expect(globalStore.get(usageLensAtom)).toBe("work");
        expect(globalStore.get(usageWorkScopeAtom)).toBe("C:/work/waveterm");
        expect(globalStore.get(usageWorkItemAtom)).toEqual(item);
    });
});
