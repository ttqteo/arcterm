import { afterEach, describe, expect, it, vi } from "vitest";
import { globalStore } from "@/app/store/jotaiStore";

const getStats = vi.fn();
vi.mock("@/app/store/wshclientapi", () => ({
    RpcApi: { GetUsageStatsCommand: (...a: any[]) => getStats(...a) },
}));
vi.mock("@/app/store/wshrpcutil", () => ({ TabRpcClient: {} }));

import {
    allUsageStatsAtom,
    forecastDaily,
    forecastDailyAtom,
    loadForecastHistory,
    loadUsage,
    usageBucketsAtom,
    usageEffortsAtom,
    usageErrorAtom,
    usageHeldWindowAtom,
    usageLensAtom,
    usageListShownAtom,
    usageLoadedAtom,
    usageLoadView,
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

describe("held window", () => {
    afterEach(() => {
        globalStore.set(usageHeldWindowAtom, null);
        globalStore.set(usageEffortsAtom, []);
        globalStore.set(forecastDailyAtom, null);
    });

    it("records the window of the held buckets only when a load succeeds", async () => {
        getStats.mockResolvedValueOnce(response);
        await loadUsage(7);
        expect(globalStore.get(usageHeldWindowAtom)).toBe(7);

        getStats.mockRejectedValueOnce(new Error("network error"));
        await loadUsage(0);
        expect(globalStore.get(usageHeldWindowAtom)).toBe(7);
        expect(usageLoadView(0, 7, globalStore.get(usageLoadedAtom), globalStore.get(usageErrorAtom))).toBe(
            "switch-failed"
        );
    });

    it("starts a switch with no error, so switching back shows the held data at once", async () => {
        getStats.mockResolvedValueOnce(response);
        await loadUsage(7);
        getStats.mockRejectedValueOnce(new Error("network error"));
        await loadUsage(0);
        expect(globalStore.get(usageErrorAtom)).toBe(true);
        getStats.mockImplementationOnce(() => new Promise(() => {}));
        void loadUsage(7);
        expect(globalStore.get(usageErrorAtom)).toBe(false);
    });

    // ours: By provider's chart starts at the oldest bucket, not padded back to the window's first day (By work pads
    // its own, usageworkview.tsx; the fork's padding for By provider was reverted, initiative "Kael sync: reverted")
    it("starts the all-usage chart at the oldest bucket, not the held window's first day", async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date(2026, 5, 26, 12));
        try {
            getStats.mockResolvedValueOnce(response);
            await loadUsage(7);
            expect(globalStore.get(allUsageStatsAtom).daily.map((d) => d.day)[0]).toBe("2026-06-26");
        } finally {
            vi.useRealTimers();
        }
    });

    it("stores the reply's efforts, and the fixture's", async () => {
        const efforts = [{ oid: "e1", title: "Usage review fixes" }];
        getStats.mockResolvedValueOnce({ ...response, efforts });
        await loadUsage(7);
        expect(globalStore.get(usageEffortsAtom)).toEqual(efforts);

        seedFixture(JSON.stringify({ buckets: response.buckets, sessions, efforts }));
        await loadUsage(7);
        expect(globalStore.get(usageEffortsAtom)).toEqual(efforts);
    });
});

describe("dev fixture failure", () => {
    afterEach(() => {
        globalStore.set(usageHeldWindowAtom, null);
    });

    it("fails the load for {fail: true} alone, keeping what is held", async () => {
        getStats.mockResolvedValueOnce(response);
        await loadUsage(7);
        seedFixture(JSON.stringify({ fail: true }));
        await loadUsage(0);
        expect(getStats).toHaveBeenCalledTimes(1);
        expect(globalStore.get(usageErrorAtom)).toBe(true);
        expect(globalStore.get(usageBucketsAtom)).toEqual(response.buckets);
        expect(globalStore.get(usageHeldWindowAtom)).toBe(7);
    });
});

describe("list paging", () => {
    it("starts at the collapsed eight rows", () => {
        expect(globalStore.get(usageListShownAtom)).toBe(8);
    });
});

describe("usageLoadView", () => {
    it("shows the skeleton while a window that is not held loads", () => {
        expect(usageLoadView(7, null, false, false)).toBe("skeleton");
        expect(usageLoadView(0, 7, false, false)).toBe("skeleton");
    });
    it("shows the held data at once on a switch back, and while the held window reloads", () => {
        expect(usageLoadView(7, 7, false, true)).toBe("data-with-error");
        expect(usageLoadView(7, 7, false, false)).toBe("data");
        expect(usageLoadView(7, 7, true, false)).toBe("data");
    });
    it("keeps the data with a banner when a refresh of the held window failed", () => {
        expect(usageLoadView(7, 7, true, true)).toBe("data-with-error");
    });
    it("fails the switch when a window other than the held one failed", () => {
        expect(usageLoadView(0, 7, true, true)).toBe("switch-failed");
        expect(usageLoadView(7, null, true, true)).toBe("switch-failed");
    });
});

describe("forecast history", () => {
    const now = new Date(2026, 10, 5, 12).getTime();
    const at = (day: string, over: Record<string, unknown> = {}) => ({ ...response.buckets[0], day, ...over });

    afterEach(() => {
        globalStore.set(forecastDailyAtom, null);
    });

    it("keeps Claude's daily tokens over the last 28 days", () => {
        const daily = forecastDaily(
            [
                at("2026-10-08", { input: 999 }), // 29 days back: cut
                at("2026-10-09", { input: 10, output: 0 }),
                at("2026-10-09", { harness: "codex", input: 500 }),
                at("2026-11-05", { input: 5, output: 0 }),
            ],
            now
        );
        expect(daily[0]).toEqual({ day: "2026-10-09", tokens: 10 });
        expect(daily).toHaveLength(28);
        expect(daily[daily.length - 1]).toEqual({ day: "2026-11-05", tokens: 5 });
    });

    it("asks for 28 days at most once an hour, and keeps the last history when a load fails", async () => {
        const base = now + 365 * 24 * 3600_000;
        getStats.mockResolvedValue({ buckets: [at("2027-11-05", { input: 7, output: 0 })] });
        await loadForecastHistory(base);
        expect(getStats).toHaveBeenCalledTimes(1);
        expect(getStats.mock.calls[0][1]).toStrictEqual({ windowdays: 28 });
        const held = globalStore.get(forecastDailyAtom);
        expect(held?.length).toBeGreaterThan(0);

        await loadForecastHistory(base + 30 * 60_000);
        expect(getStats).toHaveBeenCalledTimes(1);

        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        getStats.mockRejectedValueOnce(new Error("network error"));
        await loadForecastHistory(base + 61 * 60_000);
        expect(getStats).toHaveBeenCalledTimes(2);
        expect(globalStore.get(forecastDailyAtom)).toBe(held);
        expect(warn).toHaveBeenCalled();
        warn.mockRestore();
    });
});
