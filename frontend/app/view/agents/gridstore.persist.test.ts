// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The saved grid through a real (stubbed) localStorage. A second file because the atom reads storage once, when
// the module creates it (getOnInit), so each case stores first and imports a fresh copy of the module, as
// railstore.test.ts does; gridstore.test.ts runs without localStorage.

import { beforeEach, describe, expect, it, vi } from "vitest";

const lsMock = vi.hoisted(() => {
    const store = new Map<string, string>();
    const mock = {
        store,
        getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
        setItem: (k: string, v: string) => void store.set(k, v),
        removeItem: (k: string) => void store.delete(k),
        clear: () => store.clear(),
    };
    (globalThis as any).localStorage = mock;
    (globalThis as any).window = { localStorage: mock };
    return mock;
});

const KEY = "agent.grid";

async function freshStore() {
    vi.resetModules();
    const { createStore } = await import("jotai");
    const { agentGridAtom } = await import("./gridstore");
    return { store: createStore(), agentGridAtom };
}

async function gridAtStartup(stored?: string) {
    lsMock.clear();
    if (stored != null) {
        lsMock.store.set(KEY, stored);
    }
    const { store, agentGridAtom } = await freshStore();
    return store.get(agentGridAtom);
}

describe("agentGridAtom storage", () => {
    beforeEach(() => lsMock.clear());

    it("starts empty for a profile that never stored a grid", async () => {
        expect(await gridAtStartup()).toEqual({ ids: [], focused: null });
    });
    it("reads back a stored grid on the first read", async () => {
        expect(await gridAtStartup('{"ids":["a","b"],"focused":"b"}')).toEqual({ ids: ["a", "b"], focused: "b" });
    });
    it("repairs a stored grid whose focus names a cell it does not have", async () => {
        expect(await gridAtStartup('{"ids":["a","b"],"focused":"zz"}')).toEqual({ ids: ["a", "b"], focused: "a" });
    });
    it("reads text that is not JSON as an empty grid", async () => {
        expect(await gridAtStartup("{not json")).toEqual({ ids: [], focused: null });
    });
    it("reads JSON that is not a grid as an empty grid", async () => {
        expect(await gridAtStartup("5")).toEqual({ ids: [], focused: null });
    });
    it("stores the grid as JSON under agent.grid, and a restart reads it back", async () => {
        lsMock.clear();
        const { store, agentGridAtom } = await freshStore();
        store.set(agentGridAtom, { ids: ["a", "b"], focused: "a" });
        const saved = lsMock.store.get(KEY);
        expect(JSON.parse(saved!)).toEqual({ ids: ["a", "b"], focused: "a" });
        expect(await gridAtStartup(saved)).toEqual({ ids: ["a", "b"], focused: "a" });
    });
});
