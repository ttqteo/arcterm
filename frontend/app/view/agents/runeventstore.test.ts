// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { afterEach, describe, expect, it, vi } from "vitest";

const rpc = vi.hoisted(() => ({ JarvisRunEventsCommand: vi.fn() }));
const live = vi.hoisted(() => ({ handler: null as null | ((e: { data: unknown }) => void) }));
vi.mock("@/app/store/wshclientapi", () => ({ RpcApi: rpc }));
vi.mock("@/app/store/wshrpcutil", () => ({ TabRpcClient: {} }));
vi.mock("@/app/store/wps", () => ({
    waveEventSubscribeSingle: (sub: { handler: (e: { data: unknown }) => void }) => {
        live.handler = sub.handler;
    },
}));

import { globalStore } from "@/app/store/jotaiStore";
import { ensureRunEvents, mergeRunEvents, RUN_EVENTS_RETRY_MS, runEventsAtom } from "./runeventstore";

const ev = (id: string, ts: number) => ({ id, runid: "r", channelid: "c", ts, kind: "k" }) as RunEvent;

afterEach(() => {
    vi.useRealTimers();
    rpc.JarvisRunEventsCommand.mockReset();
});

describe("mergeRunEvents", () => {
    it("keeps a live event the history snapshot predates, and drops the duplicates", () => {
        const history = [ev("b", 2), ev("a", 1)];
        expect(mergeRunEvents([ev("c", 3), ev("b", 2)], history).map((e) => e.id)).toEqual(["c", "b", "a"]);
    });
});

describe("history load", () => {
    it("does not overwrite an event the live stream delivered while the load was out", async () => {
        let answer!: (v: { events: RunEvent[] }) => void;
        rpc.JarvisRunEventsCommand.mockImplementation(() => new Promise((r) => (answer = r)));
        ensureRunEvents("r-live", "c");
        live.handler!({ data: { runid: "r-live", event: ev("late", 9) } });
        answer({ events: [ev("old", 1)] });
        await vi.waitFor(() =>
            expect(globalStore.get(runEventsAtom("r-live")).map((e) => e.id)).toEqual(["late", "old"])
        );
    });

    it("retries a failed load by itself", async () => {
        vi.useFakeTimers();
        rpc.JarvisRunEventsCommand.mockRejectedValueOnce(new Error("timeout"));
        rpc.JarvisRunEventsCommand.mockResolvedValueOnce({ events: [ev("x", 1)] });
        ensureRunEvents("r-fail", "c");
        await vi.advanceTimersByTimeAsync(0);
        expect(rpc.JarvisRunEventsCommand).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(RUN_EVENTS_RETRY_MS[0]);
        expect(rpc.JarvisRunEventsCommand).toHaveBeenCalledTimes(2);
        expect(globalStore.get(runEventsAtom("r-fail")).map((e) => e.id)).toEqual(["x"]);
    });
});
