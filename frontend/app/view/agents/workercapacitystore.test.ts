// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/app/store/wshclientapi", () => ({ RpcApi: { GetWorkerCapacityCommand: vi.fn() } }));
vi.mock("@/app/store/wshrpcutil", () => ({ TabRpcClient: {} }));

import { globalStore } from "@/app/store/jotaiStore";
import type { WorkerCapacity } from "./workercapacity";
import { POLL_MS, acquireCapacityPoll, loadWorkerCapacity, workerCapacityAtom } from "./workercapacitystore";

const reading: WorkerCapacity = {
    totalbytes: 8,
    availablebytes: 4,
    perworkerbytes: 1,
    measured: true,
    liveworkers: 0,
    reservebytes: 0,
    moreworkers: 4,
};

describe("loadWorkerCapacity", () => {
    afterEach(() => vi.restoreAllMocks());

    it("stores a reading", async () => {
        await loadWorkerCapacity(async () => reading);
        expect(globalStore.get(workerCapacityAtom)).toEqual(reading);
    });

    it("clears the reading on a failure and warns once per failure streak", async () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        await loadWorkerCapacity(async () => reading);
        const fail = async (): Promise<WorkerCapacity> => {
            throw new Error("no such command");
        };
        await loadWorkerCapacity(fail);
        expect(globalStore.get(workerCapacityAtom)).toBeNull();
        await loadWorkerCapacity(fail);
        expect(warn).toHaveBeenCalledTimes(1);
        await loadWorkerCapacity(async () => reading);
        await loadWorkerCapacity(fail);
        expect(warn).toHaveBeenCalledTimes(2);
    });
});

describe("acquireCapacityPoll", () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it("runs one poll however many users, and stops with the last", () => {
        const load = vi.fn();
        const releaseA = acquireCapacityPoll(load);
        const releaseB = acquireCapacityPoll(load);
        expect(load).toHaveBeenCalledTimes(1);
        vi.advanceTimersByTime(POLL_MS);
        expect(load).toHaveBeenCalledTimes(2);

        releaseA();
        releaseA(); // a second release of the same user is a no-op
        vi.advanceTimersByTime(POLL_MS);
        expect(load).toHaveBeenCalledTimes(3);

        releaseB();
        vi.advanceTimersByTime(POLL_MS * 3);
        expect(load).toHaveBeenCalledTimes(3);
    });

    it("starts again for a user after the last one left", () => {
        const load = vi.fn();
        acquireCapacityPoll(load)();
        const release = acquireCapacityPoll(load);
        expect(load).toHaveBeenCalledTimes(2);
        release();
    });
});
