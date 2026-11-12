// frontend/app/view/code/codestore.jumps.test.ts
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// A pending jump carries its path (codePendingJumpAtom), a folder opens in the tree, and the Opening… placeholder
// waits for a slow read. Its own file: these need a stat and a read the test can answer per case, which
// codestore.test.ts's fixed RPC stand-ins do not give.

import { globalStore } from "@/app/store/jotaiStore";
import type { AgentsViewModel } from "@/app/view/agents/agents";
import { atom } from "jotai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EMPTY_HISTORY } from "./codehistory";
import { codeSearchModeAtom } from "./codesearchstore";
import {
    codeCursorAtom,
    codeExpandedAtom,
    codeFileAtom,
    codeHistoryAtom,
    codeIndexAtom,
    codePendingJumpAtom,
    codePendingLineAtom,
    codeProjectAtom,
    goToLine,
    openInCode,
    openPath,
} from "./codestore";

const rpc = vi.hoisted(() => ({
    fileInfo: null as null | ((path: string) => Promise<unknown>),
    fileRead: null as null | ((path: string) => Promise<unknown>),
}));
vi.mock("@/app/store/wshclientapi", () => ({
    RpcApi: {
        FileInfoCommand: (_c: unknown, d: { info: { path: string } }) => rpc.fileInfo(d.info.path),
        FileReadCommand: (_c: unknown, d: { info: { path: string } }) => rpc.fileRead(d.info.path),
        GitListFilesCommand: async () => ({ files: [], isrepo: true }),
        GitChangesCommand: async () => ({ statusz: "", numstat: "" }),
        GitListWorktreesCommand: async () => ({ worktrees: [] }),
    },
}));
vi.mock("@/app/view/agents/projectsstore", async (importOriginal) => {
    const { atom } = await import("jotai");
    return { ...(await importOriginal<object>()), projectsAtom: atom({}) };
});

const PROJECT = { name: "alpha", path: "/repos/alpha" };
// already on Code, so a jump does not move the surface
const model = { surfaceAtom: atom("code") } as unknown as AgentsViewModel;

function textFile(body: string): void {
    rpc.fileInfo = async () => ({ size: body.length, mimetype: "text/plain", modtime: 2 });
    rpc.fileRead = async () => ({ data64: btoa(body) });
}

function seed(paths: string[], open = "src/a.ts"): void {
    globalStore.set(codeProjectAtom, PROJECT);
    globalStore.set(codeIndexAtom, { paths, ignored: [], isRepo: true, truncated: false });
    globalStore.set(codeFileAtom, { kind: "text", path: open, text: "a\n", size: 2, modtime: 1 });
    globalStore.set(codeHistoryAtom, EMPTY_HISTORY);
    globalStore.set(codeExpandedAtom, new Set<string>());
    globalStore.set(codeCursorAtom, null);
    globalStore.set(codePendingJumpAtom, null);
}

beforeEach(() => {
    textFile("x\n");
});

afterEach(() => {
    vi.useRealTimers();
    globalStore.set(codePendingJumpAtom, null);
});

describe("jumps", () => {
    it("openInCode tags the pending jump with its path", async () => {
        seed(["src/a.ts", "src/b.ts"]);
        textFile("b\n");

        await openInCode(model, { projectPath: PROJECT.path, rel: "src/b.ts", line: 9 });

        expect(globalStore.get(codeFileAtom)).toMatchObject({ kind: "text", path: "src/b.ts" });
        expect(globalStore.get(codePendingJumpAtom)).toEqual({ path: "src/b.ts", line: 9 });
    });

    it("openInCode carries an anchor", async () => {
        seed(["src/a.ts", "docs/b.md"]);
        textFile("# B\n");

        await openInCode(model, { projectPath: PROJECT.path, rel: "docs/b.md", anchor: "b" });

        expect(globalStore.get(codePendingJumpAtom)).toEqual({ path: "docs/b.md", anchor: "b" });
    });

    it("opening another file drops a pending jump for a different path", async () => {
        seed(["src/a.ts", "src/b.ts", "README.md"]);
        globalStore.set(codePendingJumpAtom, { path: "src/b.ts", line: 9 });

        await openPath("src/b.ts");
        expect(globalStore.get(codePendingJumpAtom)).toEqual({ path: "src/b.ts", line: 9 });

        await openPath("README.md");
        expect(globalStore.get(codePendingJumpAtom)).toBeNull();
    });

    it("goToLine tags the pending jump with the open file", () => {
        seed(["src/a.ts"]);

        goToLine(152);

        expect(globalStore.get(codePendingJumpAtom)).toEqual({ path: "src/a.ts", line: 152 });
    });

    it("a line written to codePendingLineAtom is the open file's, and reads back as a line", () => {
        seed(["src/a.ts"]);

        globalStore.set(codePendingLineAtom, 7);

        expect(globalStore.get(codePendingJumpAtom)).toEqual({ path: "src/a.ts", line: 7 });
        expect(globalStore.get(codePendingLineAtom)).toBe(7);
        globalStore.set(codePendingJumpAtom, { path: "src/a.ts", anchor: "x" });
        expect(globalStore.get(codePendingLineAtom)).toBeNull();
        globalStore.set(codePendingLineAtom, null);
        expect(globalStore.get(codePendingJumpAtom)).toBeNull();
    });

    it("a line set before an openPath that passes it lands on the opened file, not the one showing", async () => {
        seed(["src/a.ts", "src/b.ts"]);
        // what Open file does (openfilestore.ts): the line first, then the read
        globalStore.set(codePendingLineAtom, 12);

        await openPath("src/b.ts", { line: 12 });

        expect(globalStore.get(codePendingJumpAtom)).toEqual({ path: "src/b.ts", line: 12 });
    });

    it("openPath of a directory reveals the folder and leaves the file and history", async () => {
        seed(["src/a.ts", "docs/x/y.md"]);
        const file = globalStore.get(codeFileAtom);
        const history = globalStore.get(codeHistoryAtom);
        globalStore.set(codeSearchModeAtom, "search");
        const read = vi.fn();
        rpc.fileInfo = async () => ({ isdir: true, mimetype: "directory" });
        rpc.fileRead = read;

        await openPath("docs/x");

        expect(globalStore.get(codeFileAtom)).toBe(file);
        expect(globalStore.get(codeHistoryAtom)).toBe(history);
        expect(read).not.toHaveBeenCalled();
        expect(globalStore.get(codeCursorAtom)).toBe("docs/x");
        expect([...globalStore.get(codeExpandedAtom)]).toEqual(expect.arrayContaining(["docs", "docs/x"]));
        expect(globalStore.get(codeSearchModeAtom)).toBe("files");
    });
});

describe("the Opening… placeholder", () => {
    it("never shows for a quick read: the previous file stays up until the new one lands", async () => {
        seed(["src/a.ts", "src/b.ts"]);
        const seen: string[] = [];
        const unsub = globalStore.sub(codeFileAtom, () => seen.push(globalStore.get(codeFileAtom).kind));

        await openPath("src/b.ts");
        unsub();

        expect(seen).toEqual(["text"]);
        expect(globalStore.get(codeFileAtom)).toMatchObject({ kind: "text", path: "src/b.ts" });
    });

    it("shows for a read slower than its delay", async () => {
        vi.useFakeTimers();
        seed(["src/a.ts", "src/b.ts"]);
        let answer: (v: unknown) => void = () => {};
        rpc.fileInfo = () => new Promise((resolve) => (answer = resolve));

        const opening = openPath("src/b.ts");
        expect(globalStore.get(codeFileAtom)).toMatchObject({ kind: "text", path: "src/a.ts" });
        await vi.advanceTimersByTimeAsync(200);
        expect(globalStore.get(codeFileAtom)).toEqual({ kind: "loading", path: "src/b.ts" });

        answer({ size: 2, mimetype: "text/plain", modtime: 2 });
        await opening;
        expect(globalStore.get(codeFileAtom)).toMatchObject({ kind: "text", path: "src/b.ts" });
    });
});
