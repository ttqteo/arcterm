// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { globalStore } from "@/app/store/jotaiStore";
import type { PrimitiveAtom } from "jotai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

const listWorktrees = vi.fn();
const resolveCwd = vi.fn();
vi.mock("@/app/store/wshclientapi", () => ({
    RpcApi: { GitListWorktreesCommand: (...a: any[]) => listWorktrees(...a) },
}));
vi.mock("@/app/store/wshrpcutil", () => ({ TabRpcClient: {} }));
vi.mock("./agentcwdresolve", () => ({ resolveCwd: (...a: any[]) => resolveCwd(...a) }));
vi.mock("./projectsstore", async () => {
    const { atom } = await import("jotai");
    return { projectListAtom: atom<{ name: string; path: string }[]>([]) };
});

import type { FilesState } from "./filesstore";
import { projectListAtom } from "./projectsstore";
import {
    agentCwdsAtom,
    loadProjectWorktrees,
    refreshSidebar,
    resolveAgentCwds,
    sidebarExpandedAtom,
    sidebarFoldedAtom,
    withLiveCount,
    worktreeErrorsAtom,
    worktreesByProjectAtom,
} from "./worktreesidebarstore";

const ARC = { name: "arc", path: "C:/src/arc" };
const CUS = { name: "cus", path: "C:/src/cus" };
const wt = (path: string, extra: Partial<GitWorktree> = {}): GitWorktree => ({ path, ...extra });

function deferred<T>() {
    let resolve!: (v: T) => void;
    let reject!: (e: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

beforeEach(() => {
    listWorktrees.mockReset();
    resolveCwd.mockReset();
    globalStore.set(worktreesByProjectAtom, {});
    globalStore.set(worktreeErrorsAtom, {});
    globalStore.set(agentCwdsAtom, {});
    globalStore.set(sidebarExpandedAtom, new Set<string>());
    globalStore.set(projectListAtom as unknown as PrimitiveAtom<{ name: string; path: string }[]>, [ARC, CUS]);
    vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
    vi.restoreAllMocks();
    window.__worktreeSidebarFault = undefined;
});

describe("loadProjectWorktrees", () => {
    it("asks for status of the project's path", async () => {
        listWorktrees.mockResolvedValue({ worktrees: [wt("C:/src/arc", { ismain: true })] });
        await loadProjectWorktrees(ARC);
        expect(listWorktrees).toHaveBeenCalledWith({}, { cwd: "C:/src/arc", status: true });
        expect(globalStore.get(worktreesByProjectAtom).arc).toEqual([wt("C:/src/arc", { ismain: true })]);
    });

    it("drops a stale response for a project", async () => {
        const first = deferred<CommandGitListWorktreesRtnData>();
        listWorktrees.mockReturnValueOnce(first.promise);
        listWorktrees.mockResolvedValueOnce({ worktrees: [wt("C:/src/arc", { changed: 2 })] });
        const older = loadProjectWorktrees(ARC);
        await loadProjectWorktrees(ARC);
        first.resolve({ worktrees: [wt("C:/src/arc", { changed: 9 })] });
        await older;
        expect(globalStore.get(worktreesByProjectAtom).arc).toEqual([wt("C:/src/arc", { changed: 2 })]);
    });

    it("a rejected call sets that group's error, logs it, and leaves another group's data", async () => {
        listWorktrees.mockResolvedValueOnce({ worktrees: [wt("C:/src/cus", { ismain: true })] });
        await loadProjectWorktrees(CUS);
        listWorktrees.mockRejectedValueOnce(new Error("git worktree: boom"));
        await loadProjectWorktrees(ARC);
        expect(globalStore.get(worktreeErrorsAtom)).toEqual({ arc: "git worktree: boom" });
        expect(globalStore.get(worktreesByProjectAtom)).toEqual({ cus: [wt("C:/src/cus", { ismain: true })] });
        expect(console.error).toHaveBeenCalled();
    });

    it("a good read clears the group's earlier error", async () => {
        listWorktrees.mockRejectedValueOnce(new Error("boom"));
        await loadProjectWorktrees(ARC);
        listWorktrees.mockResolvedValueOnce({ worktrees: [] });
        await loadProjectWorktrees(ARC);
        expect(globalStore.get(worktreeErrorsAtom)).toEqual({});
        expect(globalStore.get(worktreesByProjectAtom).arc).toEqual([]);
    });

    it("the fault hook makes exactly one load reject and is cleared", async () => {
        listWorktrees.mockResolvedValue({ worktrees: [wt("C:/src/arc")] });
        window.__worktreeSidebarFault = "error";
        await loadProjectWorktrees(ARC);
        expect(globalStore.get(worktreeErrorsAtom).arc).toMatch(/__worktreeSidebarFault/);
        expect(window.__worktreeSidebarFault).toBeUndefined();
        expect(listWorktrees).not.toHaveBeenCalled();
        await loadProjectWorktrees(ARC);
        expect(globalStore.get(worktreeErrorsAtom).arc).toBeUndefined();
        expect(globalStore.get(worktreesByProjectAtom).arc).toEqual([wt("C:/src/arc")]);
    });
});

describe("refreshSidebar", () => {
    it("loads only expanded groups", async () => {
        listWorktrees.mockResolvedValue({ worktrees: [] });
        globalStore.set(sidebarExpandedAtom, new Set(["cus"]));
        await refreshSidebar();
        expect(listWorktrees).toHaveBeenCalledTimes(1);
        expect(listWorktrees).toHaveBeenCalledWith({}, { cwd: "C:/src/cus", status: true });
    });
});

describe("resolveAgentCwds", () => {
    it("resolves an agent's cwd once per transcript path", async () => {
        resolveCwd.mockResolvedValueOnce("C:/src/arc").mockResolvedValueOnce("C:/src/arc/.waveterm/worktrees/x");
        await resolveAgentCwds([{ id: "a1", transcriptPath: "/t1.jsonl", blockId: "b1" }]);
        await resolveAgentCwds([{ id: "a1", transcriptPath: "/t1.jsonl", blockId: "b1" }]);
        expect(resolveCwd).toHaveBeenCalledTimes(1);
        expect(resolveCwd).toHaveBeenCalledWith("/t1.jsonl", "b1");
        expect(globalStore.get(agentCwdsAtom)).toEqual({ a1: "C:/src/arc" });
        await resolveAgentCwds([{ id: "a1", transcriptPath: "/t2.jsonl", blockId: "b1" }]);
        expect(resolveCwd).toHaveBeenCalledTimes(2);
        expect(globalStore.get(agentCwdsAtom)).toEqual({ a1: "C:/src/arc/.waveterm/worktrees/x" });
    });

    it("stores null for an agent whose cwd does not resolve", async () => {
        resolveCwd.mockResolvedValueOnce(null);
        await resolveAgentCwds([{ id: "a2", transcriptPath: "/none.jsonl" }]);
        expect(globalStore.get(agentCwdsAtom)).toEqual({ a2: null });
    });
});

describe("withLiveCount", () => {
    const state = (over: Partial<FilesState>): FilesState => ({
        cwd: "C:\\src\\arc\\",
        branch: "main",
        isRepo: true,
        changes: {
            files: [
                { path: "a.ts", status: "M", adds: 1, dels: 0 },
                { path: "b.ts", status: "?", adds: 0, dels: 0 },
            ],
            adds: 1,
            dels: 0,
        },
        ref: "",
        head: "abc",
        ...over,
    });
    const wts = [
        wt("C:/src/arc", { ismain: true, changed: 7 }),
        wt("C:/src/arc/.waveterm/worktrees/x", { changed: 3 }),
    ];

    it("overrides only the open checkout's count, matching its path across spellings", () => {
        expect(withLiveCount(wts, state({}))).toEqual([
            wt("C:/src/arc", { ismain: true, changed: 2 }),
            wt("C:/src/arc/.waveterm/worktrees/x", { changed: 3 }),
        ]);
    });

    it("leaves the counts alone for an anchored read, a non-repo, or no load yet", () => {
        expect(withLiveCount(wts, state({ ref: "base000" }))).toEqual(wts);
        expect(withLiveCount(wts, state({ isRepo: false }))).toEqual(wts);
        expect(withLiveCount(wts, null)).toEqual(wts);
    });
});

describe("sidebarFoldedAtom", () => {
    it("persists under cockpit.files.sidebar.folded and defaults to open", async () => {
        lsMock.clear();
        expect(globalStore.get(sidebarFoldedAtom)).toBe(false);
        globalStore.set(sidebarFoldedAtom, true);
        expect(lsMock.store.get("cockpit.files.sidebar.folded")).toBe("true");
        vi.resetModules();
        const { createStore } = await import("jotai");
        const fresh = await import("./worktreesidebarstore");
        expect(createStore().get(fresh.sidebarFoldedAtom)).toBe(true);
    });
});
