// frontend/app/view/code/codestore.session.test.ts
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// The session kept across a refresh, a re-pick, a new folder and a failed delete, the worktree folders that stat as
// directories, the refused save, and the diff header's picks. Its own file: these answer each RPC per case, which
// codestore.test.ts's fixed stand-ins do not give.

import { globalStore } from "@/app/store/jotaiStore";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const listFiles = vi.fn();
const fileInfo = vi.fn();
const fileRead = vi.fn();
const fileDelete = vi.fn();
const fileMkdir = vi.fn();
const fileMove = vi.fn();
const listWorktrees = vi.fn();
const listBranches = vi.fn();
const divergence = vi.fn();
vi.mock("@/app/store/wshclientapi", () => ({
    RpcApi: {
        GitListFilesCommand: (...a: any[]) => listFiles(...a),
        GitChangesCommand: async () => ({ statusz: "", numstat: "" }),
        GitListWorktreesCommand: (...a: any[]) => listWorktrees(...a),
        FileInfoCommand: (...a: any[]) => fileInfo(...a),
        FileReadCommand: (...a: any[]) => fileRead(...a),
        FileDeleteCommand: (...a: any[]) => fileDelete(...a),
        FileMkdirCommand: (...a: any[]) => fileMkdir(...a),
        FileMoveCommand: (...a: any[]) => fileMove(...a),
        ListBranchesCommand: (...a: any[]) => listBranches(...a),
        GitDivergenceCommand: (...a: any[]) => divergence(...a),
    },
}));
// the real atom reads the app's config, which vitest never boots; selectPath resolves names through it
vi.mock("@/app/view/agents/projectsstore", async (importOriginal) => {
    const { atom } = await import("jotai");
    return { ...(await importOriginal<object>()), projectsAtom: atom({}) };
});

import { EMPTY_HISTORY, push } from "./codehistory";
import {
    codeCursorAtom,
    codeDiffBaseAtom,
    codeDiffTargetAtom,
    codeEditAtom,
    codeExpandedAtom,
    codeFileAtom,
    codeHeadAtom,
    codeHistoryAtom,
    codeIndexAtom,
    codeIndexErrorAtom,
    codeMutateErrorAtom,
    codeProjectAtom,
    codeRowsAtom,
    codeSaveAtom,
    codeSessionDirsAtom,
    codeStaleAtom,
    codeViewModeAtom,
    codeWorktreeFoldersAtom,
    compareWithDisk,
    createEntry,
    deletePath,
    DISK_REF,
    ensureIndex,
    isCurrentPick,
    loadDisk,
    openPickedPath,
    probeDiffBase,
    refreshIndex,
    renamePath,
    revertDraft,
    selectProject,
    showDiffTarget,
    type CodeIndex,
} from "./codestore";

// a project path per test: the store caches each project's index, and a shared path would answer from it
let seq = 0;
const nextProject = () => ({ name: "repo", path: `C:\\repos\\session-${++seq}` });
const index = (paths: string[]): CodeIndex => ({ paths, ignored: [], isRepo: true, truncated: false });
const text = (path: string, body = "one\n") =>
    ({ kind: "text", path, text: body, size: body.length, modtime: 1 }) as const;

function deferred<T>() {
    let resolve!: (v: T) => void;
    const promise = new Promise<T>((r) => (resolve = r));
    return { promise, resolve };
}

// an open session: a file, its expanded folder, two history entries
function seedSession(paths: string[]) {
    const project = nextProject();
    globalStore.set(codeProjectAtom, project);
    globalStore.set(codeIndexAtom, index(paths));
    globalStore.set(codeIndexErrorAtom, null);
    globalStore.set(codeFileAtom, text("src/a.ts"));
    globalStore.set(codeCursorAtom, "src/a.ts");
    globalStore.set(codeExpandedAtom, new Set(["src"]));
    globalStore.set(codeHistoryAtom, push(push(EMPTY_HISTORY, "README.md"), "src/a.ts"));
    globalStore.set(codeSessionDirsAtom, new Set<string>());
    return project;
}

beforeEach(() => {
    listFiles.mockImplementation(async () => ({ files: ["src/a.ts", "README.md"], isrepo: true }));
    listWorktrees.mockResolvedValue({ worktrees: [] });
    fileInfo.mockResolvedValue({ isdir: true });
});

afterEach(() => {
    vi.clearAllMocks();
    revertDraft();
    globalStore.set(codeSaveAtom, { kind: "idle" });
    globalStore.set(codeStaleAtom, null);
    globalStore.set(codeMutateErrorAtom, null);
    globalStore.set(codeDiffTargetAtom, "head");
    globalStore.set(codeDiffBaseAtom, null);
    globalStore.set(codeViewModeAtom, "preview");
    globalStore.set(codeHeadAtom, { kind: "idle" });
});

describe("isCurrentPick", () => {
    const alpha = { name: "alpha", path: "C:\\repos\\alpha" };

    it("is true for the same path in another case or separator", () => {
        expect(isCurrentPick(alpha, "c:/Repos/ALPHA/")).toBe(true);
        expect(isCurrentPick(alpha, "C:\\repos\\alpha")).toBe(true);
    });

    it("is false for another path or with nothing selected", () => {
        expect(isCurrentPick(alpha, "C:\\repos\\alpha\\sub")).toBe(false);
        expect(isCurrentPick(null, "C:\\repos\\alpha")).toBe(false);
    });

    it("openPickedPath on the shown project only clears the picker's error", async () => {
        const project = seedSession(["src/a.ts"]);
        expect(await openPickedPath(`${project.path}\\`)).toBe(true);
        expect(fileInfo).not.toHaveBeenCalled();
        expect(globalStore.get(codeFileAtom)).toMatchObject({ kind: "text", path: "src/a.ts" });
    });
});

describe("refreshIndex", () => {
    it("refreshIndex keeps the open file, expanded folders and history", async () => {
        seedSession(["src/a.ts", "README.md"]);
        const file = globalStore.get(codeFileAtom);
        const expanded = globalStore.get(codeExpandedAtom);
        const history = globalStore.get(codeHistoryAtom);
        listFiles.mockResolvedValue({ files: ["src/a.ts", "src/b.ts", "README.md"], isrepo: true });

        await refreshIndex();

        expect(globalStore.get(codeIndexAtom)?.paths).toContain("src/b.ts");
        expect(globalStore.get(codeFileAtom)).toBe(file);
        expect(globalStore.get(codeExpandedAtom)).toBe(expanded);
        expect(globalStore.get(codeHistoryAtom)).toBe(history);
    });

    it("a session dir leaves once the index lists a file under it", async () => {
        seedSession(["src/a.ts"]);
        globalStore.set(codeSessionDirsAtom, new Set(["fresh", "other"]));
        listFiles.mockResolvedValue({ files: ["src/a.ts", "fresh/x.ts"], isrepo: true });

        await refreshIndex();

        expect([...globalStore.get(codeSessionDirsAtom)]).toEqual(["other"]);
    });
});

describe("ensureIndex", () => {
    it("ensureIndex does not reset the session", async () => {
        seedSession([]);
        globalStore.set(codeIndexAtom, null);
        const file = globalStore.get(codeFileAtom);
        const expanded = globalStore.get(codeExpandedAtom);
        const history = globalStore.get(codeHistoryAtom);

        await ensureIndex();

        expect(globalStore.get(codeIndexAtom)?.paths).toEqual(["src/a.ts", "README.md"]);
        expect(globalStore.get(codeFileAtom)).toBe(file);
        expect(globalStore.get(codeExpandedAtom)).toBe(expanded);
        expect(globalStore.get(codeHistoryAtom)).toBe(history);
    });

    it("ensureIndex does nothing while a load is in flight", async () => {
        const slow = deferred<{ files: string[]; isrepo: boolean }>();
        listFiles.mockReturnValue(slow.promise);
        // the kept listing a load shows meanwhile (`cached`) is not a load of its own
        const walks = () => listFiles.mock.calls.filter((c) => c[1]?.cached !== true).length;
        const loading = selectProject(nextProject());
        expect(walks()).toBe(1);

        await ensureIndex();
        expect(walks()).toBe(1);

        slow.resolve({ files: ["a.ts"], isrepo: true });
        await loading;
        expect(globalStore.get(codeIndexAtom)?.paths).toEqual(["a.ts"]);
    });
});

describe("selectProject", () => {
    it("selectProject clears a pending create", async () => {
        globalStore.set(codeEditAtom, { kind: "create", dir: "", isDir: false });
        await selectProject(null);
        expect(globalStore.get(codeEditAtom)).toBeNull();
    });

    it("clears the session dirs", async () => {
        globalStore.set(codeSessionDirsAtom, new Set(["fresh"]));
        await selectProject(nextProject());
        expect(globalStore.get(codeSessionDirsAtom).size).toBe(0);
    });

    it("publishes only the worktree folders that stat as directories", async () => {
        listWorktrees.mockResolvedValue({
            worktrees: [
                { path: "C:/repos/w/main", branch: "main", ismain: true },
                { path: "C:/repos/w/feat", branch: "feat" },
                { path: "C:/repos/w/old", branch: "old" },
            ],
        });
        fileInfo.mockImplementation(async (_client: unknown, { info }: { info: { path: string } }) => {
            if (info.path.includes("feat")) return { notfound: true };
            if (info.path.includes("old")) throw new Error("denied");
            return { isdir: true };
        });
        const logged = vi.spyOn(console, "error").mockImplementation(() => {});

        await selectProject({ name: "web", path: "C:\\repos\\w\\main\\web" });

        await vi.waitFor(() => expect(globalStore.get(codeWorktreeFoldersAtom).map((f) => f.label)).toEqual(["main"]));
        expect(logged).toHaveBeenCalled();
        logged.mockRestore();
    });
});

describe("createEntry", () => {
    it("adds a created folder to the session dirs, expands and selects it", async () => {
        seedSession(["src/a.ts"]);
        fileMkdir.mockResolvedValue(undefined);
        listFiles.mockResolvedValue({ files: ["src/a.ts"], isrepo: true });

        await createEntry("src", "fresh", true);

        expect(globalStore.get(codeSessionDirsAtom).has("src/fresh")).toBe(true);
        expect(globalStore.get(codeExpandedAtom).has("src/fresh")).toBe(true);
        expect(globalStore.get(codeCursorAtom)).toBe("src/fresh");
        // and it is a row, though git lists no file under it
        expect(globalStore.get(codeRowsAtom).some((r) => r.path === "src/fresh" && r.kind === "dir")).toBe(true);
    });
});

describe("renamePath", () => {
    it("session dirs follow a rename", async () => {
        seedSession(["src/a.ts"]);
        globalStore.set(codeSessionDirsAtom, new Set(["src/fresh", "src/fresh/inner", "keep"]));
        fileMove.mockResolvedValue(undefined);

        await renamePath("src/fresh", "renamed");

        expect([...globalStore.get(codeSessionDirsAtom)].sort()).toEqual(["keep", "src/renamed", "src/renamed/inner"]);
    });
});

describe("deletePath", () => {
    it("a failed delete keeps the open file", async () => {
        seedSession(["src/a.ts"]);
        fileDelete.mockRejectedValue(new Error("in use"));

        await deletePath("src/a.ts", false);

        expect(globalStore.get(codeFileAtom)).toMatchObject({ kind: "text", path: "src/a.ts" });
        expect(globalStore.get(codeCursorAtom)).toBe("src/a.ts");
        expect(globalStore.get(codeMutateErrorAtom)).toMatch(/in use/);
    });

    it("a successful delete closes it", async () => {
        seedSession(["src/a.ts"]);
        fileDelete.mockResolvedValue(undefined);

        await deletePath("src/a.ts", false);

        expect(globalStore.get(codeFileAtom)).toEqual({ kind: "none" });
        expect(globalStore.get(codeCursorAtom)).toBeNull();
    });

    it("a deleted session dir leaves the set", async () => {
        seedSession(["src/a.ts"]);
        globalStore.set(codeSessionDirsAtom, new Set(["fresh", "fresh/inner", "keep"]));
        fileDelete.mockResolvedValue(undefined);

        await deletePath("fresh", true);

        expect([...globalStore.get(codeSessionDirsAtom)]).toEqual(["keep"]);
    });
});

describe("the diff header's picks", () => {
    const usableBase = () => {
        listBranches.mockResolvedValue({ default: "main" });
        divergence.mockResolvedValue({ isrepo: true, ahead: [{ hash: "f00" }], mergebase: "abc1234def" });
    };
    const defaultBranch = () => {
        listBranches.mockResolvedValue({ default: "main" });
        divergence.mockResolvedValue({ isrepo: true, ahead: [], mergebase: "abc1234def" });
    };

    it("showDiffTarget head picks HEAD without asking for a base", async () => {
        globalStore.set(codeDiffTargetAtom, "base");
        await showDiffTarget("head");
        expect(globalStore.get(codeDiffTargetAtom)).toBe("head");
        expect(listBranches).not.toHaveBeenCalled();
    });

    it("showDiffTarget base resolves the base on the click and lands on it while Diff shows", async () => {
        usableBase();
        seedSession(["src/a.ts"]);
        globalStore.set(codeViewModeAtom, "diff");

        await showDiffTarget("base");

        expect(globalStore.get(codeDiffBaseAtom)).toEqual({ kind: "usable", branch: "main", sha: "abc1234def" });
        expect(globalStore.get(codeDiffTargetAtom)).toBe("base");
    });

    it("a skip stays on HEAD and is kept, so the header can disable Branch base", async () => {
        defaultBranch();
        seedSession(["src/a.ts"]);
        globalStore.set(codeViewModeAtom, "diff");

        await showDiffTarget("base");

        expect(globalStore.get(codeDiffBaseAtom)).toEqual({ kind: "skip" });
        expect(globalStore.get(codeDiffTargetAtom)).toBe("head");
    });

    it("probeDiffBase answers before any click", async () => {
        defaultBranch();
        seedSession(["src/a.ts"]);
        await probeDiffBase();
        expect(globalStore.get(codeDiffBaseAtom)).toEqual({ kind: "skip" });
        expect(globalStore.get(codeDiffTargetAtom)).toBe("head");
    });
});

describe("Compare with disk", () => {
    it("compareWithDisk switches Diff to the disk target", () => {
        compareWithDisk();
        expect(globalStore.get(codeDiffTargetAtom)).toBe("disk");
        expect(globalStore.get(codeViewModeAtom)).toBe("diff");
    });

    it("loadDisk reads the file fresh and tags the copy with the disk ref", async () => {
        const project = seedSession(["src/a.ts"]);
        fileRead.mockResolvedValue({ data64: btoa("on disk\n") });

        await loadDisk("src/a.ts");

        expect(fileRead.mock.calls[0][1].info.path.replace(/\\/g, "/")).toBe(
            `${project.path.replace(/\\/g, "/")}/src/a.ts`
        );
        expect(globalStore.get(codeHeadAtom)).toEqual({
            kind: "text",
            path: "src/a.ts",
            ref: DISK_REF,
            text: "on disk\n",
        });
    });

    it("loadDisk says why when the read fails", async () => {
        seedSession(["src/a.ts"]);
        fileRead.mockRejectedValue(new Error("gone"));

        await loadDisk("src/a.ts");

        expect(globalStore.get(codeHeadAtom)).toEqual({
            kind: "error",
            path: "src/a.ts",
            ref: DISK_REF,
            message: "gone",
        });
    });
});
