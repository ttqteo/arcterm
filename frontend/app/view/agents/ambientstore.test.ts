// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { afterEach, describe, expect, it, vi } from "vitest";

const resolveAmbient = vi.fn();
const rpcClient = { id: "tab-rpc-client" };
vi.mock("@/app/store/wshclientapi", () => ({
    RpcApi: { ResolveAmbientCommand: (...a: any[]) => resolveAmbient(...a) },
}));
vi.mock("@/app/store/wshrpcutil", () => ({ TabRpcClient: rpcClient }));

const DATA: CommandResolveAmbientRtnData = {
    tasks: [{ id: "task-auth", label: "PROJ-142" }],
    edges: [{ oref: "run:r1", dossierid: "task-auth", provenance: "dispatch", bucket: "strong", state: "confirmed" }],
    decisions: [],
};
const TAGS = [{ label: "PROJ-142", taskId: "task-auth", bucket: "strong", state: "confirmed" }];

// the store keeps its latch at module scope, so each test gets a fresh copy of it
async function freshStore() {
    vi.resetModules();
    const store = await import("./ambientstore");
    const { globalStore } = await import("@/app/store/jotaiStore");
    const tags = () => globalStore.get(store.ambientProviderAtom).tagsFor({ oref: "run:r1" });
    return { ...store, tags };
}

const settle = () => new Promise((r) => setTimeout(r, 0));

afterEach(() => {
    resolveAmbient.mockReset();
    vi.restoreAllMocks();
});

describe("ensureAmbient", () => {
    it("reads the vault once while a read is in flight, with the long timeout", async () => {
        resolveAmbient.mockReturnValue(new Promise(() => {}));
        const { ensureAmbient } = await freshStore();
        ensureAmbient();
        ensureAmbient();
        expect(resolveAmbient).toHaveBeenCalledTimes(1);
        expect(resolveAmbient).toHaveBeenCalledWith(rpcClient, { timeout: 30_000 });
    });

    it("publishes what it read, and does not read again once loaded", async () => {
        resolveAmbient.mockResolvedValue(DATA);
        const { ensureAmbient, tags } = await freshStore();
        expect(tags()).toEqual([]);
        ensureAmbient();
        await settle();
        expect(tags()).toEqual(TAGS);
        ensureAmbient();
        await settle();
        expect(resolveAmbient).toHaveBeenCalledTimes(1);
    });

    it("leaves the empty map and tries again on the next call after a failed read", async () => {
        vi.spyOn(console, "warn").mockImplementation(() => {});
        resolveAmbient.mockRejectedValueOnce(new Error("rpc down")).mockResolvedValueOnce(DATA);
        const { ensureAmbient, tags } = await freshStore();
        ensureAmbient();
        await settle();
        expect(tags()).toEqual([]);
        ensureAmbient();
        await settle();
        expect(resolveAmbient).toHaveBeenCalledTimes(2);
        expect(tags()).toEqual(TAGS);
    });
});

describe("reloadAmbient", () => {
    it("reads the vault again after a load", async () => {
        resolveAmbient.mockResolvedValue(DATA);
        const { ensureAmbient, reloadAmbient } = await freshStore();
        ensureAmbient();
        await settle();
        reloadAmbient();
        await settle();
        expect(resolveAmbient).toHaveBeenCalledTimes(2);
    });
});
