// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

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

// the atom reads storage once, when the module creates it (getOnInit), so each case imports a fresh copy of the
// module; the first fresh import pays the cold transform of the graph `./agentcenter` reaches, which on a loaded
// machine outlasts a case's timeout. The hook's own timeout covers that transform; vite-node keeps it across
// vi.resetModules(), so every case after this one only re-evaluates the module.
beforeAll(async () => {
    await import("./railstore");
    lsMock.clear();
}, 120000);

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
        void rail.loadRailForAgent({ id: "a1", transcriptPath: "/t.jsonl" });
        expect(globalStore.get(rail.railStateAtom)).toBeNull();
    });

    it("keeps what is on screen while a silent read of the same agent is in flight", async () => {
        const { globalStore, rail } = await withPendingCwd();
        void rail.loadRailForAgent({ id: "a1", transcriptPath: "/t.jsonl" }, { silent: true });
        expect(globalStore.get(rail.railStateAtom)).toBe(shown);
    });
});

describe("loadRailForAgent: whose changes the rail lists", () => {
    // the checkout holds a file the agent never touched: only a claude agent's own edits keep it out
    const checkout: CommandGitChangesRtnData = {
        branch: "main",
        statusz: " M own.ts\0 M other.ts\0",
        numstat: "2\t1\town.ts\n5\t0\tother.ts\n",
        isrepo: true,
        ref: "session-start",
    };
    const edits: CommandGitChangesRtnData = {
        branch: "main",
        statusz: " M own.ts\0",
        numstat: "2\t1\town.ts\n",
        isrepo: true,
        ref: "bbb",
    };

    // one fresh copy of the modules, the cwd and the session start resolved, git answering as the RPC mocks say
    async function read(agent: { id: string; agent?: string }, reply: { edits?: any; changes: (d: any) => any }) {
        vi.resetModules();
        const { resolveCwd } = await import("./agentcwdresolve");
        vi.mocked(resolveCwd).mockResolvedValue("/repo");
        const { ensureSessionStart } = await import("./agentsessionstore");
        vi.mocked(ensureSessionStart).mockResolvedValue(555);
        const { RpcApi } = await import("@/app/store/wshclientapi");
        const changes = vi.fn(async (_c: unknown, d: any) =>
            d.branchbase ? { branch: "main", statusz: "", numstat: "", isrepo: true } : reply.changes(d)
        );
        const agentEdits = vi.fn(async () => reply.edits);
        Object.assign(RpcApi, {
            GitChangesCommand: changes,
            GitAgentEditsCommand: agentEdits,
            GitListWorktreesCommand: async () => ({ worktrees: [] }),
        });
        const { globalStore } = await import("@/app/store/jotaiStore");
        const rail = await import("./railstore");
        await rail.loadRailForAgent({ ...agent, transcriptPath: "/t.jsonl" });
        return { state: globalStore.get(rail.railStateAtom), changes, agentEdits };
    }

    it("lists a claude agent's own edits and measures them from the edits' base", async () => {
        const { state, changes, agentEdits } = await read(
            { id: "a1", agent: "claude" },
            { edits: { base: "bbb", end: "hhh", files: [{ path: "own.ts" }], bashcalls: 0 }, changes: () => edits }
        );
        expect(agentEdits).toHaveBeenCalledTimes(1);
        const sessionReads = changes.mock.calls.filter(([, d]) => !d.branchbase).map(([, d]) => d);
        expect(sessionReads).toEqual([{ cwd: "/repo", ref: "bbb", end: "hhh" }]);
        expect(state?.changes?.files.map((f) => f.path)).toEqual(["own.ts"]);
        // a click on a file diffs against this, so it is the same base the list was counted from
        expect(state?.ref).toBe("bbb");
    });

    it("lists nothing for a claude agent that has made no edit yet, in a dirty checkout, and still starts its commits at the session start", async () => {
        const { state, changes } = await read(
            { id: "a2" },
            {
                edits: { base: "", end: "", files: [], bashcalls: 0, reason: "no edits to show" },
                changes: () => checkout,
            }
        );
        const sessionReads = changes.mock.calls.filter(([, d]) => !d.branchbase).map(([, d]) => d);
        expect(sessionReads).toEqual([{ cwd: "/repo", sessionstartts: 555 }]);
        expect(state?.isRepo).toBe(true);
        expect(state?.branch).toBe("main");
        expect(state?.changes?.files).toEqual([]);
        // the Commits section lists `ref..HEAD`: with no edit yet that is still the session's commits
        expect(state?.ref).toBe("session-start");
    });

    it("keeps why the read failed, so the rail does not call the folder not a repository", async () => {
        vi.resetModules();
        const { resolveCwd } = await import("./agentcwdresolve");
        vi.mocked(resolveCwd).mockResolvedValue("/repo");
        const { ensureSessionStart } = await import("./agentsessionstore");
        vi.mocked(ensureSessionStart).mockResolvedValue(555);
        const { RpcApi } = await import("@/app/store/wshclientapi");
        Object.assign(RpcApi, {
            GitChangesCommand: async () => ({ branch: "main", statusz: "", numstat: "", isrepo: true }),
            GitAgentEditsCommand: async () => {
                throw new Error("git timed out");
            },
            GitListWorktreesCommand: async () => ({ worktrees: [] }),
        });
        const { globalStore } = await import("@/app/store/jotaiStore");
        const rail = await import("./railstore");
        await rail.loadRailForAgent({ id: "a4", agent: "claude", transcriptPath: "/t.jsonl" });
        const state = globalStore.get(rail.railStateAtom);
        expect(state).toMatchObject({ cwd: "/repo", isRepo: false, changes: null, failure: "git timed out" });
    });

    it("has no failure on a read that worked, or on a folder that is not a repository", async () => {
        const { state } = await read(
            { id: "a5", agent: "claude" },
            {
                edits: { base: "", end: "", files: [], bashcalls: 0, reason: "Not a git repository" },
                changes: () => ({ ...checkout, isrepo: false }),
            }
        );
        expect(state?.isRepo).toBe(false);
        expect(state?.failure).toBeUndefined();
    });

    it("lists any other agent's checkout since its session started", async () => {
        const { state, changes, agentEdits } = await read({ id: "a3", agent: "pi" }, { changes: () => checkout });
        expect(agentEdits).not.toHaveBeenCalled();
        const sessionReads = changes.mock.calls.filter(([, d]) => !d.branchbase).map(([, d]) => d);
        expect(sessionReads).toEqual([{ cwd: "/repo", sessionstartts: 555 }]);
        expect(state?.changes?.files.map((f) => f.path)).toEqual(["own.ts", "other.ts"]);
        expect(state?.ref).toBe("session-start");
    });
});

describe("loadRailForAgent: a switch back to an agent read before", () => {
    // fresh modules; each agent's checkout is its own folder, and a read waits until the case lets git answer
    async function setup() {
        vi.resetModules();
        const { resolveCwd } = await import("./agentcwdresolve");
        vi.mocked(resolveCwd).mockImplementation(async (t?: string) => `/repo${t}`);
        const { ensureSessionStart } = await import("./agentsessionstore");
        vi.mocked(ensureSessionStart).mockResolvedValue(555);
        const gates: { cwd: string; open: (fail?: boolean) => void }[] = [];
        const { RpcApi } = await import("@/app/store/wshclientapi");
        Object.assign(RpcApi, {
            GitChangesCommand: (_c: unknown, d: any) =>
                d.branchbase
                    ? Promise.resolve(null)
                    : new Promise((resolve, reject) =>
                          gates.push({
                              cwd: d.cwd,
                              open: (fail) =>
                                  fail
                                      ? reject(new Error("git timed out"))
                                      : resolve({
                                            branch: d.cwd,
                                            statusz: " M f.ts\0",
                                            numstat: "1\t0\tf.ts\n",
                                            isrepo: true,
                                        }),
                          })
                      ),
            GitListWorktreesCommand: async () => ({ worktrees: [] }),
        });
        const { globalStore } = await import("@/app/store/jotaiStore");
        const rail = await import("./railstore");
        const seen: (string | null)[] = [];
        globalStore.sub(rail.railStateAtom, () => seen.push(globalStore.get(rail.railStateAtom)?.cwd ?? null));
        const settle = () => new Promise((r) => setTimeout(r, 0));
        // read an agent through: focus it, let git answer, wait until the state lands
        const view = async (id: string, fail?: boolean) => {
            const load = rail.loadRailForAgent({ id, transcriptPath: `/${id}`, agent: "pi" });
            await settle();
            gates.shift()!.open(fail);
            await load;
        };
        return { globalStore, rail, seen, gates, settle, view };
    }

    it("shows a first view's skeleton, then the agent's list", async () => {
        const { globalStore, rail, gates, settle, view } = await setup();
        await view("b");
        const first = rail.loadRailForAgent({ id: "a", transcriptPath: "/a", agent: "pi" });
        expect(globalStore.get(rail.railStateAtom)).toBeNull();
        await settle();
        gates.shift()!.open();
        await first;
        expect(globalStore.get(rail.railStateAtom)?.branch).toBe("/repo/a");
    });

    it("never passes through null for an agent shown before, and updates it in place when the read lands", async () => {
        const { globalStore, rail, seen, gates, settle, view } = await setup();
        await view("a");
        await view("b");
        seen.length = 0;
        const back = rail.loadRailForAgent({ id: "a", transcriptPath: "/a", agent: "pi" });
        expect(globalStore.get(rail.railStateAtom)?.cwd).toBe("/repo/a");
        await settle();
        gates.shift()!.open();
        await back;
        expect(seen).not.toContain(null);
        expect(seen.every((cwd) => cwd === "/repo/a")).toBe(true);
    });

    it("drops a late read for an agent the focus moved off, and keeps it from another agent's entry", async () => {
        const { globalStore, rail, gates, settle, view } = await setup();
        await view("b");
        const late = rail.loadRailForAgent({ id: "a", transcriptPath: "/a", agent: "pi" });
        await settle();
        const lateGate = gates.shift()!;
        await view("b");
        lateGate.open();
        await late;
        expect(globalStore.get(rail.railStateAtom)?.cwd).toBe("/repo/b");
        // a never landed, so a's next view is a first view
        void rail.loadRailForAgent({ id: "a", transcriptPath: "/a", agent: "pi" });
        expect(globalStore.get(rail.railStateAtom)).toBeNull();
    });

    it("does not show a remembered failure again: that agent reads as on a first view", async () => {
        const { globalStore, rail, view } = await setup();
        await view("a", true);
        expect(globalStore.get(rail.railStateAtom)?.failure).toBe("git timed out");
        await view("b");
        void rail.loadRailForAgent({ id: "a", transcriptPath: "/a", agent: "pi" });
        expect(globalStore.get(rail.railStateAtom)).toBeNull();
    });

    it("forgets an agent that left the roster", async () => {
        const { globalStore, rail, view } = await setup();
        await view("a");
        await view("b");
        const { retainAgentMemories } = await import("./agentmemory");
        retainAgentMemories(new Set(["b"]));
        void rail.loadRailForAgent({ id: "a", transcriptPath: "/a", agent: "pi" });
        expect(globalStore.get(rail.railStateAtom)).toBeNull();
    });
});
