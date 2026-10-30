// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { globalStore } from "@/app/store/jotaiStore";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./runactions", () => ({ cancelRun: vi.fn(async () => {}) }));

import { cancelRun } from "./runactions";
import {
    cancelStartingRun,
    dismissStartingRun,
    retryStartingRun,
    startingRunsAtom,
    startRunInBackground,
} from "./startingrunsstore";

const started = { channelId: "ch-1", run: { id: "run-1" } as Run };

// a start the test settles by hand
function deferred() {
    let resolve!: (v: typeof started) => void;
    let reject!: (e: unknown) => void;
    const promise = new Promise<typeof started>((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

const flush = () => new Promise((r) => setTimeout(r, 0));
const rows = () => globalStore.get(startingRunsAtom);

beforeEach(() => {
    globalStore.set(startingRunsAtom, []);
    vi.mocked(cancelRun).mockClear();
});

describe("startRunInBackground", () => {
    it("shows a Starting row until the run exists, then drops it and tells the caller the run's id", async () => {
        const d = deferred();
        const onStarted = vi.fn();
        startRunInBackground({ project: "arcterm", title: "Build", start: () => d.promise, onStarted });
        expect(rows()).toMatchObject([{ project: "arcterm", title: "Build", state: "starting" }]);
        d.resolve(started);
        await flush();
        expect(rows()).toEqual([]);
        expect(onStarted).toHaveBeenCalledWith("run-1");
    });

    it("cancels the run a cancelled start makes, and tells no one it started", async () => {
        const d = deferred();
        const onStarted = vi.fn();
        startRunInBackground({ project: "arcterm", title: "Build", start: () => d.promise, onStarted });
        cancelStartingRun(rows()[0].id);
        expect(rows()[0].state).toBe("cancelling");
        d.resolve(started);
        await flush();
        expect(cancelRun).toHaveBeenCalledWith("ch-1", "run-1");
        expect(rows()).toEqual([]);
        expect(onStarted).not.toHaveBeenCalled();
    });

    it("keeps a failed start's row with its reason, for Try again or Dismiss", async () => {
        let calls = 0;
        const start = vi.fn(async () => {
            calls++;
            if (calls === 1) {
                throw new Error("no route");
            }
            return started;
        });
        startRunInBackground({ project: "arcterm", title: "Build", start });
        await flush();
        expect(rows()[0]).toMatchObject({ state: "failed", error: "Error: no route" });
        retryStartingRun(rows()[0].id);
        await flush();
        expect(start).toHaveBeenCalledTimes(2);
        expect(rows()).toEqual([]);
    });

    it("drops a failed row on Dismiss, and a cancelled start that then fails without a trace", async () => {
        const d = deferred();
        startRunInBackground({ project: "arcterm", title: "A", start: async () => Promise.reject(new Error("x")) });
        startRunInBackground({ project: "arcterm", title: "B", start: () => d.promise });
        await flush();
        const [a, b] = rows();
        dismissStartingRun(a.id);
        cancelStartingRun(b.id);
        d.reject(new Error("y"));
        await flush();
        expect(rows()).toEqual([]);
        expect(cancelRun).not.toHaveBeenCalled();
    });
});
