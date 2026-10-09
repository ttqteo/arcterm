// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/app/store/wshclientapi", () => ({ RpcApi: {} }));
vi.mock("@/app/store/wshrpcutil", () => ({ TabRpcClient: {} }));
vi.mock("./agentcwdresolve", () => ({ resolveCwd: vi.fn() }));
vi.mock("./agentsessionstore", () => ({ ensureSessionStart: vi.fn() }));

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

const KEY = "agent.rail.visible";

// the atom reads storage once, when the module creates it (getOnInit), so each case stores first and imports a
// fresh copy of the module
async function railVisibleAtStartup(stored?: string): Promise<boolean> {
    lsMock.clear();
    if (stored != null) {
        lsMock.store.set(KEY, stored);
    }
    vi.resetModules();
    const { createStore } = await import("jotai");
    const { railVisibleAtom } = await import("./railstore");
    return createStore().get(railVisibleAtom);
}

describe("railVisibleAtom", () => {
    beforeEach(() => lsMock.clear());

    it("is on for a profile that never stored a choice", async () => {
        expect(await railVisibleAtStartup()).toBe(true);
    });
    it("keeps a stored off: anyone who turned the rail off still has it off", async () => {
        expect(await railVisibleAtStartup("false")).toBe(false);
    });
    it("keeps a stored on", async () => {
        expect(await railVisibleAtStartup("true")).toBe(true);
    });
    it("the default is on", async () => {
        vi.resetModules();
        const { DEFAULT_RAIL_VISIBLE } = await import("./railstore");
        expect(DEFAULT_RAIL_VISIBLE).toBe(true);
    });
});

describe("branchDiffOf", () => {
    const read = (over: Partial<CommandGitChangesRtnData>): CommandGitChangesRtnData => ({
        branch: "wave/abc",
        statusz: " M src/a.ts\0",
        numstat: "3\t1\tsrc/a.ts\n",
        isrepo: true,
        ref: "deadbeef",
        basebranch: "main",
        ...over,
    });

    it("is the branch's changes against the default branch it left", async () => {
        const { branchDiffOf } = await import("./railstore");
        const d = branchDiffOf(read({}));
        expect(d?.base).toBe("main");
        expect(d?.ref).toBe("deadbeef");
        expect(d?.changes.files.map((f) => f.path)).toEqual(["src/a.ts"]);
    });

    it("is absent on the default branch itself, with no base, or with no read", async () => {
        const { branchDiffOf } = await import("./railstore");
        expect(branchDiffOf(read({ branch: "main" }))).toBeUndefined();
        expect(branchDiffOf(read({ branch: "main", basebranch: "origin/main" }))).toBeUndefined();
        expect(branchDiffOf(read({ basebranch: undefined }))).toBeUndefined();
        expect(branchDiffOf(read({ ref: "" }))).toBeUndefined();
        expect(branchDiffOf(read({ isrepo: false }))).toBeUndefined();
        expect(branchDiffOf(null)).toBeUndefined();
    });
});
