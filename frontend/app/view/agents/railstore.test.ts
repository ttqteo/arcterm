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

    // the first fresh import of the module, which pays the cold transform of its graph
    it("is on for a profile that never stored a choice", async () => {
        expect(await railVisibleAtStartup()).toBe(true);
    }, 30000);
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

describe("the terminal panel", () => {
    // one fresh copy of the modules per case, so the global store and the stored fold start clean
    async function fresh(storedFold?: string) {
        lsMock.clear();
        if (storedFold != null) {
            lsMock.store.set("agent.terminalDock.folded", storedFold);
        }
        vi.resetModules();
        const { atom } = await import("jotai");
        const { globalStore } = await import("@/app/store/jotaiStore");
        const rail = await import("./railstore");
        const { recentTabsAtom } = await import("./tabswitcherstore");
        const model = {
            focusIdAtom: atom<string | undefined>("t1"),
            agentsAtom: atom([
                { id: "a1", blockId: "b-a1" },
                { id: "a2", blockId: "b-a2" },
            ]),
        };
        return { globalStore, rail, recentTabsAtom, model };
    }

    it("is unfolded for a profile that never folded it, and keeps a stored fold", async () => {
        const a = await fresh();
        expect(a.globalStore.get(a.rail.terminalDockFoldedAtom)).toBe(false);
        const b = await fresh("true");
        expect(b.globalStore.get(b.rail.terminalDockFoldedAtom)).toBe(true);
    });

    it("moves a terminal under the agent that was in view before it, and opens the panel", async () => {
        const { globalStore, rail, recentTabsAtom, model } = await fresh("true");
        globalStore.set(recentTabsAtom, ["t1", "a2", "a1"]);
        expect(rail.moveToDock(model, "t1")).toBe(true);
        expect(globalStore.get(rail.dockedTerminalAtom)).toBe("t1");
        expect(globalStore.get(model.focusIdAtom)).toBe("a2");
        expect(globalStore.get(rail.terminalDockFoldedAtom)).toBe(false);
    });

    it("moves nothing when there is no agent to dock under", async () => {
        const { globalStore, rail, model } = await fresh();
        const none = { ...model, agentsAtom: (await import("jotai")).atom([]) };
        expect(rail.moveToDock(none, "t1")).toBe(false);
        expect(globalStore.get(rail.dockedTerminalAtom)).toBeNull();
        expect(globalStore.get(model.focusIdAtom)).toBe("t1");
    });

    it("undocks the docked terminal, leaves the focus on the agent, and ignores another terminal", async () => {
        const { globalStore, rail, model } = await fresh();
        globalStore.set(rail.dockedTerminalAtom, "t1");
        globalStore.set(rail.terminalDockMaxAtom, true);
        globalStore.set(model.focusIdAtom, "a1");
        rail.undock(model, "t2");
        expect(globalStore.get(rail.dockedTerminalAtom)).toBe("t1");
        rail.undock(model, "t1");
        expect(globalStore.get(rail.dockedTerminalAtom)).toBeNull();
        expect(globalStore.get(rail.terminalDockMaxAtom)).toBe(false);
        expect(globalStore.get(model.focusIdAtom)).toBe("a1");
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

describe("rereadsOnState", () => {
    it("reads again when the agent stops working, the turn whose edits and commits it now shows", async () => {
        const { rereadsOnState } = await import("./railstore");
        expect(rereadsOnState("working", "idle")).toBe(true);
        expect(rereadsOnState("working", "asking")).toBe(true);
    });

    it("does not read while the agent works, or on a change that is no turn's end", async () => {
        const { rereadsOnState } = await import("./railstore");
        expect(rereadsOnState("idle", "working")).toBe(false);
        expect(rereadsOnState("working", "working")).toBe(false);
        expect(rereadsOnState("asking", "idle")).toBe(false);
        expect(rereadsOnState(undefined, "idle")).toBe(false);
    });
});

describe("loadRailForAgent", () => {
    const shown = { cwd: "/repo", branch: "main", isRepo: true, changes: { files: [], adds: 0, dels: 0 } };

    async function withPendingCwd() {
        vi.resetModules();
        const { resolveCwd } = await import("./agentcwdresolve");
        vi.mocked(resolveCwd).mockReturnValue(new Promise(() => {}));
        const { globalStore } = await import("@/app/store/jotaiStore");
        const rail = await import("./railstore");
        globalStore.set(rail.railStateAtom, shown);
        return { globalStore, rail };
    }

    it("empties the rail while it reads a newly focused agent", async () => {
        const { globalStore, rail } = await withPendingCwd();
        void rail.loadRailForAgent("a1", "/t.jsonl");
        expect(globalStore.get(rail.railStateAtom)).toBeNull();
    });

    it("keeps what is on screen while a silent read of the same agent is in flight", async () => {
        const { globalStore, rail } = await withPendingCwd();
        void rail.loadRailForAgent("a1", "/t.jsonl", undefined, { silent: true });
        expect(globalStore.get(rail.railStateAtom)).toBe(shown);
    });
});
