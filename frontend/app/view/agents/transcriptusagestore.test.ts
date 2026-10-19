// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { beforeEach, describe, expect, test, vi } from "vitest";

const getTranscriptUsage = vi.fn();
vi.mock("@/app/store/wshclientapi", () => ({
    RpcApi: { GetTranscriptUsageCommand: (...a: any[]) => getTranscriptUsage(...a) },
}));
vi.mock("@/app/store/wshrpcutil", () => ({ TabRpcClient: {} }));

import { globalStore } from "@/app/store/jotaiStore";
import { loadSessionUsage, sessionUsageAtom } from "./transcriptusagestore";

describe("loadSessionUsage", () => {
    beforeEach(() => {
        getTranscriptUsage.mockReset();
    });

    test("an agent with no transcript is unavailable, not loading forever", async () => {
        getTranscriptUsage.mockResolvedValue({ buckets: [] });
        await loadSessionUsage("a", undefined);
        expect(globalStore.get(sessionUsageAtom)).toBe("unavailable");
        expect(getTranscriptUsage).not.toHaveBeenCalled();
    });

    test("a failed load is unavailable and says why", async () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        getTranscriptUsage.mockRejectedValueOnce(new Error("rpc down"));
        await loadSessionUsage("b", "/b.jsonl");
        expect(globalStore.get(sessionUsageAtom)).toBe("unavailable");
        expect(String(warn.mock.calls[0])).toContain("/b.jsonl");
        warn.mockRestore();
    });

    test("is loading while the first load is in flight", async () => {
        getTranscriptUsage.mockReturnValueOnce(new Promise(() => {}));
        void loadSessionUsage("c", "/c.jsonl");
        expect(globalStore.get(sessionUsageAtom)).toBeNull();
    });

    test("a failed silent reload keeps the last good usage", async () => {
        getTranscriptUsage.mockResolvedValueOnce({ buckets: [] });
        await loadSessionUsage("d", "/d.jsonl");
        const loaded = globalStore.get(sessionUsageAtom);
        expect(loaded).not.toBeNull();
        expect(loaded).not.toBe("unavailable");
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        getTranscriptUsage.mockRejectedValueOnce(new Error("rpc down"));
        await loadSessionUsage("d", "/d.jsonl", { silent: true });
        expect(globalStore.get(sessionUsageAtom)).toBe(loaded);
        warn.mockRestore();
    });

    const bucket = (input: number, output: number) =>
        ({
            harness: "claude",
            provider: "anthropic",
            model: "claude-opus-4-8",
            day: "2026-07-14",
            input,
            output,
            reasoning: 0,
            cacheread: 0,
            cachecreate: 0,
            cachecreate1h: 0,
        }) as UsageBucket;

    test("reads the transcript at its path and folds the returned buckets", async () => {
        getTranscriptUsage.mockResolvedValueOnce({ buckets: [bucket(100, 50)] });
        await loadSessionUsage("e", "/e.jsonl");
        expect(getTranscriptUsage).toHaveBeenCalledWith({}, { path: "/e.jsonl" });
        const usage = globalStore.get(sessionUsageAtom);
        expect(typeof usage === "object" && usage?.totalTokens).toBe(150);
    });

    test("a load that lands after a newer agent took focus is dropped", async () => {
        let resolveStale: (v: { buckets: UsageBucket[] }) => void = () => {};
        getTranscriptUsage.mockReturnValueOnce(new Promise((r) => (resolveStale = r)));
        const stale = loadSessionUsage("f", "/f.jsonl");
        getTranscriptUsage.mockResolvedValueOnce({ buckets: [bucket(7, 0)] });
        await loadSessionUsage("g", "/g.jsonl");
        resolveStale({ buckets: [bucket(900, 0)] });
        await stale;
        const usage = globalStore.get(sessionUsageAtom);
        expect(typeof usage === "object" && usage?.totalTokens).toBe(7);
    });

    test("a load that fails after a newer agent took focus leaves the newer load's state alone", async () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        let rejectStale: (e: Error) => void = () => {};
        getTranscriptUsage.mockReturnValueOnce(new Promise((_, rej) => (rejectStale = rej)));
        const stale = loadSessionUsage("h", "/h.jsonl");
        getTranscriptUsage.mockReturnValueOnce(new Promise(() => {}));
        void loadSessionUsage("i", "/i.jsonl");
        rejectStale(new Error("rpc down"));
        await stale;
        expect(globalStore.get(sessionUsageAtom)).toBeNull();
        warn.mockRestore();
    });
});
