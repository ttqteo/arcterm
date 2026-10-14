// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { afterEach, describe, expect, it, vi } from "vitest";

const startNow = vi.fn();
const runNext = vi.fn();
const remove = vi.fn();
const toast = vi.fn();
const pushModal = vi.fn();

vi.mock("@/app/store/wshclientapi", () => ({
    RpcApi: {
        RunQueueStartNowCommand: (...a: any[]) => startNow(...a),
        RunQueueRunNextCommand: (...a: any[]) => runNext(...a),
        RunQueueRemoveCommand: (...a: any[]) => remove(...a),
    },
}));
vi.mock("@/app/store/wshrpcutil", () => ({ TabRpcClient: {} }));
vi.mock("@/app/cockpit/notificationstore", () => ({ pushToast: (...a: any[]) => toast(...a) }));
vi.mock("@/app/store/modalmodel", () => ({ modalsModel: { pushModal: (...a: any[]) => pushModal(...a) } }));

import { confirmRemoveQueued, runQueuedNext, startQueuedNow } from "./runqueuestore";

const entry = (over: Partial<RunQueueEntry> = {}): RunQueueEntry => ({
    id: "q-3f2a",
    title: "Learned additions",
    projectpath: "/code/waveterm",
    queuedts: 0,
    state: "waiting",
    data: { channelid: "ch", workspaceid: "ws", goal: "g", runtime: "claude" },
    ...over,
});

afterEach(() => vi.resetAllMocks());

describe("startQueuedNow", () => {
    it("starts the entry by id, with a timeout that outlasts a worktree and a Setup, and says nothing on success", async () => {
        startNow.mockResolvedValue(undefined);
        await startQueuedNow(entry());
        expect(startNow).toHaveBeenCalledWith({}, { id: "q-3f2a" }, { timeout: 10 * 60_000 });
        expect(toast).not.toHaveBeenCalled();
    });

    it("shows the server's refusal to the person instead of swallowing it, while another entry is starting", async () => {
        startNow.mockRejectedValue(new Error("another queued run is starting; try again in a moment"));
        await expect(startQueuedNow(entry())).resolves.toBeUndefined();
        expect(toast).toHaveBeenCalledTimes(1);
        expect(toast.mock.calls[0][0]).toMatchObject({
            title: "Couldn't start Learned additions",
            message: "another queued run is starting; try again in a moment",
            level: "error",
        });
        // it is the person's to retry: nothing else is done to the entry
        expect(remove).not.toHaveBeenCalled();
        expect(runNext).not.toHaveBeenCalled();
    });

    it("shows the error of a start that failed, which the server has already blocked the entry for", async () => {
        startNow.mockRejectedValue(new Error("reading plan: no such file"));
        await startQueuedNow(entry());
        expect(toast.mock.calls[0][0]).toMatchObject({ message: "reading plan: no such file", level: "error" });
    });
});

describe("runQueuedNext", () => {
    it("moves the entry up by id", async () => {
        runNext.mockResolvedValue(undefined);
        await runQueuedNext(entry());
        expect(runNext).toHaveBeenCalledWith({}, { id: "q-3f2a" });
        expect(toast).not.toHaveBeenCalled();
    });

    it("shows why it could not", async () => {
        runNext.mockRejectedValue(new Error("no such queued entry: q-3f2a"));
        await runQueuedNext(entry());
        expect(toast.mock.calls[0][0]).toMatchObject({
            title: "Couldn't move Learned additions up",
            message: "no such queued entry: q-3f2a",
            level: "error",
        });
    });
});

describe("confirmRemoveQueued", () => {
    const modal = () =>
        pushModal.mock.calls[0][1] as { title: string; message: string; destructive: boolean; onConfirm: () => void };

    it("asks first, naming the entry, and removes nothing until the person confirms", () => {
        confirmRemoveQueued(entry());
        expect(pushModal).toHaveBeenCalledTimes(1);
        expect(pushModal.mock.calls[0][0]).toBe("ConfirmModal");
        expect(modal().message).toContain("Learned additions");
        expect(modal().destructive).toBe(true);
        expect(remove).not.toHaveBeenCalled();
    });

    it("removes the entry by id on confirm", async () => {
        remove.mockResolvedValue(undefined);
        confirmRemoveQueued(entry());
        modal().onConfirm();
        await vi.waitFor(() => expect(remove).toHaveBeenCalledWith({}, { id: "q-3f2a" }));
        expect(toast).not.toHaveBeenCalled();
    });

    it("shows why a removal failed", async () => {
        remove.mockRejectedValue(new Error("no such queued entry: q-3f2a"));
        confirmRemoveQueued(entry());
        modal().onConfirm();
        await vi.waitFor(() => expect(toast).toHaveBeenCalled());
        expect(toast.mock.calls[0][0]).toMatchObject({ title: "Couldn't remove Learned additions", level: "error" });
    });
});
