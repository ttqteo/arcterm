// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { afterEach, describe, expect, it, vi } from "vitest";

const reads: { resolve: (d: JobQueueData) => void }[] = [];
let handler: ((e: { data: unknown }) => void) | null = null;
const reconnectHandlers: (() => void)[] = [];

vi.mock("@/app/store/wshclientapi", () => ({
    RpcApi: {
        GetJobQueueCommand: () => new Promise<JobQueueData>((resolve) => reads.push({ resolve })),
    },
}));
vi.mock("@/app/store/wshrpcutil", () => ({ TabRpcClient: {} }));
vi.mock("@/app/store/wps", () => ({
    waveEventSubscribeSingle: (sub: { handler: (e: { data: unknown }) => void }) => {
        handler = sub.handler;
        return () => {
            handler = null;
        };
    },
}));
vi.mock("@/app/store/ws", () => ({
    addWSReconnectHandler: (h: () => void) => reconnectHandlers.push(h),
    removeWSReconnectHandler: (h: () => void) => {
        const i = reconnectHandlers.indexOf(h);
        if (i >= 0) reconnectHandlers.splice(i, 1);
    },
}));
vi.mock("@/app/view/agents/consumersstore", async () => ({ consumersOpenAtom: (await import("jotai")).atom(null) }));
vi.mock("@/app/view/agents/machineserversstore", async () => ({
    machineServersOpenAtom: (await import("jotai")).atom(false),
}));

const { globalStore } = await import("@/app/store/jotaiStore");
const { jobQueueAtom, startJobQueueFeed } = await import("./jobqueuestore");

const snap = (n: number) => ({ jobs: [], slots: n }) as unknown as JobQueueData;
const flush = () => new Promise((r) => setTimeout(r, 0));

afterEach(() => {
    reads.length = 0;
    reconnectHandlers.length = 0;
    handler = null;
    globalStore.set(jobQueueAtom, null);
});

describe("startJobQueueFeed", () => {
    it("reads once, then follows the events", async () => {
        const stop = startJobQueueFeed();
        reads[0].resolve(snap(1));
        await flush();
        expect(globalStore.get(jobQueueAtom)).toEqual(snap(1));
        handler!({ data: snap(2) });
        expect(globalStore.get(jobQueueAtom)).toEqual(snap(2));
        stop();
    });

    it("drops a read that lands after an event", async () => {
        const stop = startJobQueueFeed();
        handler!({ data: snap(2) });
        reads[0].resolve(snap(1));
        await flush();
        expect(globalStore.get(jobQueueAtom)).toEqual(snap(2));
        stop();
    });

    // an event published while the websocket was down is never heard, so the chip would stay on the old queue
    it("reads again after the websocket reconnects", async () => {
        const stop = startJobQueueFeed();
        handler!({ data: snap(1) });
        reads[0].resolve(snap(0));
        await flush();
        expect(reconnectHandlers).toHaveLength(1);
        reconnectHandlers[0]();
        expect(reads).toHaveLength(2);
        reads[1].resolve(snap(3));
        await flush();
        expect(globalStore.get(jobQueueAtom)).toEqual(snap(3));
        stop();
        expect(reconnectHandlers).toHaveLength(0);
    });

    it("writes nothing once stopped", async () => {
        const stop = startJobQueueFeed();
        stop();
        reads[0].resolve(snap(1));
        await flush();
        expect(globalStore.get(jobQueueAtom)).toBeNull();
    });
});
