// frontend/app/view/code/codestore.test.ts
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { globalStore } from "@/app/store/jotaiStore";
import { describe, expect, it, vi } from "vitest";
import {
    canRestoreProject,
    codeBodyPhase,
    codeIndexAtom,
    codeProjectAtom,
    createEntry,
    deletePath,
    registeredProjects,
    renamePath,
} from "./codestore";

// the tree's mutations go to wavesrv; here the repo is a list of paths the next ls-files answers with
const repo = vi.hoisted(() => ({ files: [] as string[] }));
vi.mock("@/app/store/wshclientapi", () => ({
    RpcApi: {
        FileDeleteCommand: async () => {},
        FileCreateCommand: async () => {},
        FileMoveCommand: async () => {},
        GitListFilesCommand: async () => ({ files: repo.files, isrepo: true }),
        GitChangesCommand: async () => ({ statusz: "", numstat: "" }),
        GitListWorktreesCommand: async () => ({ worktrees: [] }),
        FileReadCommand: async () => ({ data64: "" }),
        FileInfoCommand: async () => ({ size: 0, modtime: 0 }),
    },
}));

const registry = {
    alpha: { path: "C:\\repos\\alpha" },
    beta: { path: "/home/u/beta" },
} as Record<string, ProjectKeywords>;

describe("canRestoreProject", () => {
    it("rejects when nothing was stored", () => {
        expect(canRestoreProject(null, registry)).toBe(false);
    });

    it("restores a project still in the registry", () => {
        expect(canRestoreProject({ name: "alpha", path: "C:\\repos\\alpha" }, registry)).toBe(true);
    });

    it("ignores separator and case differences in the path", () => {
        expect(canRestoreProject({ name: "alpha", path: "c:/repos/ALPHA" }, registry)).toBe(true);
    });

    it("rejects a project the registry no longer knows", () => {
        expect(canRestoreProject({ name: "gone", path: "C:\\repos\\gone" }, registry)).toBe(false);
    });

    it("rejects while the registry has not loaded yet", () => {
        expect(canRestoreProject({ name: "alpha", path: "C:\\repos\\alpha" }, {})).toBe(false);
    });
});

describe("registeredProjects", () => {
    it("lists every entry that has a path, sorted by name", () => {
        const unsorted = { zeta: { path: "C:\\z" }, blank: {}, ...registry } as Record<string, ProjectKeywords>;
        expect(registeredProjects(unsorted)).toEqual([
            { name: "alpha", path: "C:\\repos\\alpha" },
            { name: "beta", path: "/home/u/beta" },
            { name: "zeta", path: "C:\\z" },
        ]);
    });

    it("is empty while the registry has not loaded yet", () => {
        expect(registeredProjects(undefined)).toEqual([]);
    });
});

describe("codeBodyPhase", () => {
    const alpha = { name: "alpha", path: "C:\\repos\\alpha" };
    const idx = (isRepo: boolean) => ({ paths: [], ignored: [], isRepo, truncated: false });
    const base = { registry, project: alpha, stored: null, index: idx(true), indexError: null };

    it("is loading while a stored project is about to be restored, not no-project", () => {
        expect(codeBodyPhase({ ...base, project: null, stored: alpha })).toBe("loading");
    });
    it("is no-project when nothing restorable was stored", () => {
        expect(codeBodyPhase({ ...base, project: null })).toBe("no-project");
        expect(codeBodyPhase({ ...base, project: null, stored: { name: "gone", path: "/gone" } })).toBe("no-project");
    });
    it("is loading while the file list has not arrived", () => {
        expect(codeBodyPhase({ ...base, index: null })).toBe("loading");
    });
    it("keeps the existing branches", () => {
        expect(codeBodyPhase({ ...base, registry: {}, project: null })).toBe("no-projects");
        expect(codeBodyPhase({ ...base, index: null, indexError: "boom" })).toBe("error");
        expect(codeBodyPhase({ ...base, index: idx(false) })).toBe("not-repo");
        expect(codeBodyPhase(base)).toBe("ready");
    });
    it("shows a project opened by a jump when none is registered", () => {
        expect(codeBodyPhase({ ...base, registry: {} })).toBe("ready");
        expect(codeBodyPhase({ ...base, registry: {}, index: null })).toBe("loading");
        expect(codeBodyPhase({ ...base, registry: undefined })).toBe("ready");
    });
});

describe("a create, rename or delete in the tree", () => {
    const alpha = { name: "alpha", path: "/repos/alpha" };
    // Every value the index takes while the mutation runs. A null one is the bug: the body drops to its skeleton,
    // and the surface's mount effect reads the empty index as a project never loaded and selects it again, which
    // closes the open file and collapses every folder.
    const indexValuesDuring = async (mutate: () => Promise<void>) => {
        globalStore.set(codeProjectAtom, alpha);
        globalStore.set(codeIndexAtom, { paths: ["a.ts", "b.ts"], ignored: [], isRepo: true, truncated: false });
        const seen: (string[] | null)[] = [];
        const unsub = globalStore.sub(codeIndexAtom, () => seen.push(globalStore.get(codeIndexAtom)?.paths ?? null));
        try {
            await mutate();
        } finally {
            unsub();
        }
        return seen;
    };

    it("keeps the listing on screen until the new one lands", async () => {
        repo.files = ["b.ts"];
        expect(await indexValuesDuring(() => deletePath("a.ts", false))).toEqual([["b.ts"]]);
        repo.files = ["a.ts", "b.ts", "c.ts"];
        expect(await indexValuesDuring(() => createEntry("", "c.ts", false))).toEqual([["a.ts", "b.ts", "c.ts"]]);
        repo.files = ["a2.ts", "b.ts"];
        expect(await indexValuesDuring(() => renamePath("a.ts", "a2.ts"))).toEqual([["a2.ts", "b.ts"]]);
    });
});
