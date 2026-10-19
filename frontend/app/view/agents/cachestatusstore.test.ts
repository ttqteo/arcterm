// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, test, vi } from "vitest";

const getCacheStatus = vi.fn();
vi.mock("@/app/store/wshclientapi", () => ({
    RpcApi: { GetCacheStatusCommand: (...a: any[]) => getCacheStatus(...a) },
}));
vi.mock("@/app/store/wshrpcutil", () => ({ TabRpcClient: {} }));

import { globalStore } from "@/app/store/jotaiStore";
import { agentCacheStatusAtom, formatCacheCountdown, loadCacheStatusForAgent } from "./cachestatusstore";

describe("loadCacheStatusForAgent", () => {
    test("a silent reload picks up a newer cache write for the same agent", async () => {
        getCacheStatus.mockResolvedValueOnce({ lastwritets: 1000, onehour: true });
        await loadCacheStatusForAgent("a", "/a.jsonl");
        getCacheStatus.mockResolvedValueOnce({ lastwritets: 2000, onehour: true });
        await loadCacheStatusForAgent("a", "/a.jsonl", { silent: true });
        expect(globalStore.get(agentCacheStatusAtom)).toEqual({ lastWriteTs: 2000, oneHour: true });
    });

    test("a silent reload keeps the last status while in flight and on failure", async () => {
        getCacheStatus.mockResolvedValueOnce({ lastwritets: 1000, onehour: false });
        await loadCacheStatusForAgent("b", "/b.jsonl");
        let reject!: (e: Error) => void;
        getCacheStatus.mockReturnValueOnce(new Promise((_, r) => (reject = r)));
        const reload = loadCacheStatusForAgent("b", "/b.jsonl", { silent: true });
        expect(globalStore.get(agentCacheStatusAtom)).toEqual({ lastWriteTs: 1000, oneHour: false });
        reject(new Error("rpc down"));
        await reload;
        expect(globalStore.get(agentCacheStatusAtom)).toEqual({ lastWriteTs: 1000, oneHour: false });
    });

    test("asks for the transcript by its path, and not at all without one", async () => {
        getCacheStatus.mockClear();
        getCacheStatus.mockResolvedValueOnce({ lastwritets: 1000, onehour: false });
        await loadCacheStatusForAgent("e", "/e.jsonl");
        expect(getCacheStatus).toHaveBeenCalledTimes(1);
        expect(getCacheStatus).toHaveBeenCalledWith(expect.anything(), { path: "/e.jsonl" });
        await loadCacheStatusForAgent("e", undefined);
        expect(getCacheStatus).toHaveBeenCalledTimes(1);
        expect(globalStore.get(agentCacheStatusAtom)).toBeNull();
    });

    test("a slow load for an agent focus has moved off does not overwrite the newer focus", async () => {
        let resolveSlow!: (v: unknown) => void;
        getCacheStatus.mockReturnValueOnce(new Promise((r) => (resolveSlow = r)));
        const slow = loadCacheStatusForAgent("slow", "/slow.jsonl");
        getCacheStatus.mockReturnValueOnce(new Promise(() => {}));
        void loadCacheStatusForAgent("fast", "/fast.jsonl");
        resolveSlow({ lastwritets: 1000, onehour: true });
        await slow;
        expect(globalStore.get(agentCacheStatusAtom)).toBeNull();
    });

    test("a failed full load clears the status, even over a silent refresh that landed first", async () => {
        let rejectFirst!: (e: Error) => void;
        getCacheStatus.mockReturnValueOnce(new Promise((_, r) => (rejectFirst = r)));
        const first = loadCacheStatusForAgent("g", "/g.jsonl");
        getCacheStatus.mockResolvedValueOnce({ lastwritets: 3000, onehour: false });
        await loadCacheStatusForAgent("g", "/g.jsonl", { silent: true });
        expect(globalStore.get(agentCacheStatusAtom)).toEqual({ lastWriteTs: 3000, oneHour: false });
        rejectFirst(new Error("rpc down"));
        await first;
        expect(globalStore.get(agentCacheStatusAtom)).toBeNull();
    });

    test("a failed load for an agent focus has moved off leaves the newer focus's status", async () => {
        let rejectOld!: (e: Error) => void;
        getCacheStatus.mockReturnValueOnce(new Promise((_, r) => (rejectOld = r)));
        const old = loadCacheStatusForAgent("old", "/old.jsonl");
        getCacheStatus.mockResolvedValueOnce({ lastwritets: 4000, onehour: true });
        await loadCacheStatusForAgent("new", "/new.jsonl", { silent: true });
        rejectOld(new Error("rpc down"));
        await old;
        expect(globalStore.get(agentCacheStatusAtom)).toEqual({ lastWriteTs: 4000, oneHour: true });
    });

    test("a focus change clears the previous agent's status", async () => {
        getCacheStatus.mockResolvedValueOnce({ lastwritets: 1000, onehour: true });
        await loadCacheStatusForAgent("c", "/c.jsonl");
        getCacheStatus.mockReturnValueOnce(new Promise(() => {}));
        void loadCacheStatusForAgent("d", "/d.jsonl");
        expect(globalStore.get(agentCacheStatusAtom)).toBeNull();
    });
});

describe("formatCacheCountdown", () => {
    test("no status -> em dash", () => {
        expect(formatCacheCountdown(null, 0)).toBe("—");
    });

    test("5-minute bucket, 2 minutes elapsed -> 3m left", () => {
        const status = { lastWriteTs: 1000, oneHour: false };
        expect(formatCacheCountdown(status, (1000 + 120) * 1000)).toBe("3m left");
    });

    test("5-minute bucket, under a minute remaining -> <1m left", () => {
        const status = { lastWriteTs: 1000, oneHour: false };
        expect(formatCacheCountdown(status, (1000 + 299) * 1000)).toBe("<1m left");
    });

    test("5-minute bucket, 6 minutes elapsed -> expired", () => {
        const status = { lastWriteTs: 1000, oneHour: false };
        expect(formatCacheCountdown(status, (1000 + 360) * 1000)).toBe("expired");
    });

    test("1-hour bucket, 30 seconds elapsed -> 59m left", () => {
        const status = { lastWriteTs: 1000, oneHour: true };
        expect(formatCacheCountdown(status, (1000 + 30) * 1000)).toBe("59m left");
    });

    test("stale clock behind last write is clamped to the TTL, never inflated", () => {
        // now 45m before the last write (frozen clock): remaining must cap at the 60m TTL, not 105m.
        const status = { lastWriteTs: 1000, oneHour: true };
        expect(formatCacheCountdown(status, (1000 - 45 * 60) * 1000)).toBe("60m left");
    });
});
