// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { globalStore } from "@/app/store/jotaiStore";
import { afterEach, describe, expect, it, vi } from "vitest";

const resync = vi.fn();
let onControllerStatus: ((event: { data?: any }) => void) | undefined;
vi.mock("@/app/store/wshclientapi", () => ({
    RpcApi: { ControllerResyncCommand: (...a: any[]) => resync(...a) },
}));
vi.mock("@/app/store/wshrpcutil", () => ({ TabRpcClient: {} }));
vi.mock("@/app/store/wps", () => ({
    waveEventSubscribeSingle: (sub: { handler: (event: { data?: any }) => void }) => {
        onControllerStatus = sub.handler;
    },
}));

import { getStartErrorAtom, resyncController, setupControllerStatusSubscription } from "./agentcontrollerstore";
import { mergePendingLaunches, withStartError, workingCount } from "./agentsviewmodel";

const data = { tabid: "tab-1", blockid: "blk-1" };

afterEach(() => {
    resync.mockReset();
    globalStore.set(getStartErrorAtom("blk-1"), undefined);
});

describe("resyncController", () => {
    it("records the error and rethrows", async () => {
        resync.mockRejectedValue(new Error("remote connections are not supported"));
        await expect(resyncController(data)).rejects.toThrow("remote connections are not supported");
        expect(globalStore.get(getStartErrorAtom("blk-1"))).toBe("remote connections are not supported");
    });

    it("records a rejection that is not an Error by its text", async () => {
        resync.mockRejectedValue("controller refused");
        await expect(resyncController(data)).rejects.toBe("controller refused");
        expect(globalStore.get(getStartErrorAtom("blk-1"))).toBe("controller refused");
    });

    it("clears the error on success", async () => {
        globalStore.set(getStartErrorAtom("blk-1"), "earlier failure");
        resync.mockResolvedValue(undefined);
        await resyncController(data);
        expect(globalStore.get(getStartErrorAtom("blk-1"))).toBeUndefined();
        expect(resync).toHaveBeenCalledWith({}, data);
    });

    it("keeps one block's error off another block", async () => {
        resync.mockRejectedValue(new Error("refused"));
        await expect(resyncController(data)).rejects.toThrow("refused");
        expect(globalStore.get(getStartErrorAtom("blk-2"))).toBeUndefined();
    });

    it("a rejected resync marks the pending launch failed with its message and drops it from working", async () => {
        resync.mockRejectedValue(new Error("remote connections are not supported"));
        await expect(resyncController(data)).rejects.toThrow();
        const [booting] = mergePendingLaunches(
            [],
            [{ tabId: "tab-1", blockId: "blk-1", name: "Fix login", project: "proj", ts: 0, runtime: "claude" }],
            1000
        );
        expect(workingCount([booting])).toBe(1);
        const failed = withStartError(booting, globalStore.get(getStartErrorAtom("blk-1")));
        expect(failed).toMatchObject({
            id: "tab-1",
            state: "idle",
            agent: "claude",
            startError: "remote connections are not supported",
        });
        expect(workingCount([failed])).toBe(0);
    });
});

describe("the controllerstatus subscription", () => {
    it("clears a start error once the block's process runs", () => {
        setupControllerStatusSubscription();
        globalStore.set(getStartErrorAtom("blk-1"), "earlier failure");
        onControllerStatus?.({ data: { blockid: "blk-1", shellprocstatus: "init" } });
        expect(globalStore.get(getStartErrorAtom("blk-1"))).toBe("earlier failure");
        onControllerStatus?.({ data: { blockid: "blk-1", shellprocstatus: "running" } });
        expect(globalStore.get(getStartErrorAtom("blk-1"))).toBeUndefined();
    });
});
