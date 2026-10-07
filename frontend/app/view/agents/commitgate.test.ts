// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it, vi } from "vitest";
import { createCommitGate } from "./commitgate";

function deferred() {
    let resolve!: (v: boolean) => void;
    let reject!: (e: unknown) => void;
    const promise = new Promise<boolean>((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

describe("createCommitGate", () => {
    it("commits a value once while its first commit is pending", async () => {
        const d = deferred();
        const onCommit = vi.fn(() => d.promise);
        const gate = createCommitGate();
        const first = gate.commit("tok", onCommit);
        const second = gate.commit("tok", onCommit);
        expect(onCommit).toHaveBeenCalledTimes(1);
        expect(first).not.toBeNull();
        expect(second).toBeNull();
        d.resolve(true);
        await expect(first).resolves.toBe(true);
    });

    it("lets the same value retry after a commit that resolved false", async () => {
        const onCommit = vi.fn(async () => false);
        const gate = createCommitGate();
        await gate.commit("tok", onCommit);
        await gate.commit("tok", onCommit);
        expect(onCommit).toHaveBeenCalledTimes(2);
    });

    it("lets a new value through after a commit that resolved true", async () => {
        const onCommit = vi.fn(async () => true);
        const gate = createCommitGate();
        await gate.commit("tok-a", onCommit);
        await gate.commit("tok-b", onCommit);
        expect(onCommit).toHaveBeenCalledTimes(2);
        expect(onCommit).toHaveBeenLastCalledWith("tok-b");
    });

    it("frees the gate when the commit rejects", async () => {
        const onCommit = vi.fn(async () => {
            throw new Error("rpc down");
        });
        const gate = createCommitGate();
        await expect(gate.commit("tok", onCommit)).rejects.toThrow("rpc down");
        await expect(gate.commit("tok", onCommit)).rejects.toThrow("rpc down");
        expect(onCommit).toHaveBeenCalledTimes(2);
    });
});
