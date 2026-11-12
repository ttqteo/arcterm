// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.hoisted(() => ({
    FileInfoCommand: vi.fn(),
    FileReadCommand: vi.fn(),
    GitFileAtRefCommand: vi.fn(),
    GitChangesCommand: vi.fn(),
}));
const openRefInCode = vi.hoisted(() => vi.fn());

vi.mock("@/app/store/wshclientapi", () => ({ RpcApi: rpc }));
vi.mock("@/app/store/wshrpcutil", () => ({ TabRpcClient: {} }));
vi.mock("../agents/agentrailstore", () => ({ openRefInCode: (...a: unknown[]) => openRefInCode(...a) }));

import { globalStore } from "@/app/store/jotaiStore";
import { stringToBase64 } from "@/util/util";
import type { AgentsViewModel } from "../agents/agents";
import { MAX_IMAGE_BYTES, MAX_VIEW_BYTES } from "./codeclassify";
import { closePeek, codePeekAtom, codePeekFocusedAtom, openPeekInCode, setPeekMode, togglePeek } from "./codepeekstore";

const ROOT = "C:/repo";
const DIR = "C:/repo/docs";
const anchor = { blockId: "b1", bufferLine: 10, start: 4, line: null, root: ROOT };
const at = (name: string) => ({ ...anchor, abs: `${DIR}/${name}` });

function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void } {
    let resolve!: (v: T) => void;
    const promise = new Promise<T>((r) => (resolve = r));
    return { promise, resolve };
}

function fileInfo(size = 12, mimetype = "") {
    return { size, mimetype, notfound: false };
}

function read(text: string) {
    return { data64: stringToBase64(text) };
}

function atRef(over: Partial<CommandGitFileAtRefRtnData> = {}): CommandGitFileAtRefRtnData {
    return { content: "old\n", isrepo: true, ...over };
}

beforeEach(() => {
    for (const fn of Object.values(rpc)) {
        fn.mockReset();
    }
    openRefInCode.mockReset();
    closePeek();
    rpc.FileInfoCommand.mockResolvedValue(fileInfo());
    rpc.FileReadCommand.mockResolvedValue(read("hello\n"));
    rpc.GitFileAtRefCommand.mockResolvedValue(atRef());
    rpc.GitChangesCommand.mockResolvedValue({ statusz: "", numstat: "", isrepo: true, branch: "main" });
});

describe("togglePeek", () => {
    it("loads a markdown file new since HEAD as text, opened on Preview", async () => {
        rpc.GitFileAtRefCommand.mockResolvedValue(atRef({ missing: true, content: "" }));
        rpc.GitChangesCommand.mockResolvedValue({
            statusz: "?? notes.md\0",
            numstat: "",
            isrepo: true,
            branch: "main",
        });

        await togglePeek(at("notes.md"));

        // read in the file's own folder, so the repository's cwd-relative reads need no repository root
        expect(rpc.GitFileAtRefCommand).toHaveBeenCalledWith(expect.anything(), {
            cwd: DIR,
            ref: "HEAD",
            path: "notes.md",
            maxbytes: MAX_VIEW_BYTES,
        });
        expect(rpc.GitChangesCommand).toHaveBeenCalledWith(expect.anything(), { cwd: DIR });
        const peek = globalStore.get(codePeekAtom);
        expect(peek?.abs).toBe(`${DIR}/notes.md`);
        expect(peek?.mode).toBe("preview");
        expect(peek?.file).toEqual({
            kind: "text",
            text: "hello\n",
            git: { kind: "repo", head: { kind: "absent" }, change: { adds: 0, dels: 0 } },
        });
    });

    it("opens a source file on Source with its HEAD copy and numstat change", async () => {
        rpc.GitChangesCommand.mockResolvedValue({
            statusz: " M a.ts\0",
            numstat: "3\t1\ta.ts\n",
            isrepo: true,
            branch: "main",
        });

        await togglePeek({ ...at("a.ts"), line: 12 });

        const peek = globalStore.get(codePeekAtom);
        expect(peek?.mode).toBe("source");
        expect(peek?.line).toBe(12);
        expect(peek?.file).toMatchObject({
            kind: "text",
            git: { kind: "repo", head: { kind: "text", text: "old\n" }, change: { adds: 3, dels: 1 } },
        });
    });

    it("carries the reason git counts no lines, so the card says so instead of +0 −0", async () => {
        rpc.GitChangesCommand.mockResolvedValue({
            statusz: " M sub\0",
            numstat: "",
            isrepo: true,
            branch: "main",
        });

        await togglePeek(at("sub"));

        expect(globalStore.get(codePeekAtom)?.file).toMatchObject({
            git: { kind: "repo", change: { adds: 0, dels: 0, note: "dirty" } },
        });
    });

    it("maps a binary or oversized HEAD copy to a head error", async () => {
        rpc.GitFileAtRefCommand.mockResolvedValue(atRef({ binary: true, content: "" }));

        await togglePeek(at("a.ts"));

        const file = globalStore.get(codePeekAtom)?.file;
        expect(file?.kind === "text" && file.git.kind === "repo" && file.git.head).toEqual({
            kind: "error",
            message: "The committed copy is a binary blob.",
        });
    });

    it("reports a file that is not there as missing", async () => {
        rpc.FileInfoCommand.mockResolvedValue({ notfound: true });

        await togglePeek(at("gone.ts"));

        expect(globalStore.get(codePeekAtom)?.file).toEqual({ kind: "missing" });
        expect(rpc.FileReadCommand).not.toHaveBeenCalled();
    });

    it("says a path that became a folder is not a file, without reading it", async () => {
        rpc.FileInfoCommand.mockResolvedValue({ isdir: true, size: 4096, mimetype: "directory" });

        await togglePeek(at("src"));

        expect(globalStore.get(codePeekAtom)?.file).toEqual({ kind: "error", message: `Not a file: ${DIR}/src` });
        expect(rpc.FileReadCommand).not.toHaveBeenCalled();
    });

    it("gates a text file over the view limit without reading it", async () => {
        rpc.FileInfoCommand.mockResolvedValue(fileInfo(MAX_VIEW_BYTES + 1));

        await togglePeek(at("big.log"));

        expect(globalStore.get(codePeekAtom)?.file).toEqual({ kind: "toolarge", size: MAX_VIEW_BYTES + 1 });
        expect(rpc.FileReadCommand).not.toHaveBeenCalled();
        expect(rpc.GitFileAtRefCommand).not.toHaveBeenCalled();
    });

    it("calls a large font binary, not too large: the MIME is checked before the size", async () => {
        rpc.FileInfoCommand.mockResolvedValue(fileInfo(MAX_VIEW_BYTES * 3, "font/woff2"));

        await togglePeek(at("a.woff2"));

        expect(globalStore.get(codePeekAtom)?.file).toEqual({ kind: "binary", size: MAX_VIEW_BYTES * 3 });
    });

    it("leaves an image or a PDF to Code, unread", async () => {
        rpc.FileInfoCommand.mockResolvedValue(fileInfo(5000, "image/png"));
        await togglePeek(at("logo.png"));
        expect(globalStore.get(codePeekAtom)?.file).toEqual({ kind: "binary", size: 5000 });

        rpc.FileInfoCommand.mockResolvedValue(fileInfo(5000, "application/pdf"));
        await togglePeek({ ...at("paper.pdf"), bufferLine: 11 });
        expect(globalStore.get(codePeekAtom)?.file).toEqual({ kind: "binary", size: 5000 });

        rpc.FileInfoCommand.mockResolvedValue(fileInfo(MAX_IMAGE_BYTES + 1, "image/png"));
        await togglePeek({ ...at("huge.png"), bufferLine: 12 });
        expect(globalStore.get(codePeekAtom)?.file).toEqual({ kind: "toolarge", size: MAX_IMAGE_BYTES + 1 });
        expect(rpc.FileReadCommand).not.toHaveBeenCalled();
    });

    it("treats content with a NUL byte as binary", async () => {
        rpc.FileReadCommand.mockResolvedValue(read("ab\u0000cd"));

        await togglePeek(at("blob.dat"));

        expect(globalStore.get(codePeekAtom)?.file).toMatchObject({ kind: "binary", size: 12 });
    });

    it("opens a file outside a repository with no git side", async () => {
        rpc.GitFileAtRefCommand.mockResolvedValue({ content: "", isrepo: false });

        await togglePeek(at("a.ts"));

        expect(globalStore.get(codePeekAtom)?.file).toEqual({ kind: "text", text: "hello\n", git: { kind: "norepo" } });
        expect(rpc.GitChangesCommand).not.toHaveBeenCalled();
    });

    it("reads a file at a drive root from that root, not from a relative folder", async () => {
        await togglePeek({ ...anchor, abs: "C:/a.ts" });

        expect(rpc.GitFileAtRefCommand).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({ cwd: "C:/" })
        );
    });

    it("closes on the same anchor and moves on a different one", async () => {
        await togglePeek(at("a.ts"));
        await togglePeek(at("a.ts"));
        expect(globalStore.get(codePeekAtom)).toBeNull();

        await togglePeek(at("a.ts"));
        await togglePeek({ ...at("b.ts"), bufferLine: 11 });
        expect(globalStore.get(codePeekAtom)).toMatchObject({ bufferLine: 11, abs: `${DIR}/b.ts` });
    });

    it("never shows a superseded load's file in the newer card", async () => {
        const first = deferred<FileData>();
        rpc.FileReadCommand.mockReturnValueOnce(first.promise).mockResolvedValueOnce(read("second\n"));

        const p1 = togglePeek(at("first.ts"));
        await vi.waitFor(() => expect(rpc.FileReadCommand).toHaveBeenCalledTimes(1));
        const p2 = togglePeek({ ...at("second.ts"), bufferLine: 20 });
        await p2;
        first.resolve(read("first\n"));
        await p1;

        const peek = globalStore.get(codePeekAtom);
        expect(peek?.abs).toBe(`${DIR}/second.ts`);
        expect(peek?.file).toMatchObject({ kind: "text", text: "second\n" });
    });

    it("keeps the card when the change lookup fails, its change unknown rather than none", async () => {
        rpc.GitChangesCommand.mockRejectedValue(new Error("git exploded"));

        await togglePeek(at("a.ts"));

        expect(globalStore.get(codePeekAtom)?.file).toMatchObject({
            kind: "text",
            git: { kind: "repo", change: "unknown" },
        });
    });

    it("turns a thrown RPC error into an error card", async () => {
        rpc.FileInfoCommand.mockRejectedValue(new Error("connection lost"));

        await togglePeek(at("a.ts"));

        expect(globalStore.get(codePeekAtom)?.file).toEqual({ kind: "error", message: "connection lost" });
    });
});

describe("setPeekMode", () => {
    it("switches to an enabled mode and ignores a disabled one", async () => {
        await togglePeek(at("a.ts"));

        setPeekMode("preview");
        expect(globalStore.get(codePeekAtom)?.mode).toBe("source");
        setPeekMode("diff");
        expect(globalStore.get(codePeekAtom)?.mode).toBe("diff");
    });
});

describe("closePeek", () => {
    it("clears the card and its focus flag", async () => {
        await togglePeek(at("a.ts"));
        globalStore.set(codePeekFocusedAtom, true);

        closePeek();

        expect(globalStore.get(codePeekAtom)).toBeNull();
        expect(globalStore.get(codePeekFocusedAtom)).toBe(false);
    });
});

describe("openPeekInCode", () => {
    const model = {} as AgentsViewModel;

    it("opens the file in Code at the clicked line, rooted at the terminal's folder, and closes", async () => {
        openRefInCode.mockResolvedValue(undefined);
        await togglePeek({ ...at("a.ts"), line: 7 });

        await openPeekInCode(model);

        expect(openRefInCode).toHaveBeenCalledWith(model, { abs: `${DIR}/a.ts`, root: ROOT, line: 7 });
        expect(globalStore.get(codePeekAtom)).toBeNull();
    });

    it("opens a file with no line without one", async () => {
        openRefInCode.mockResolvedValue(undefined);
        await togglePeek({ ...at("a.ts"), root: null });

        await openPeekInCode(model);

        expect(openRefInCode).toHaveBeenCalledWith(model, { abs: `${DIR}/a.ts`, root: null });
    });

    it("keeps the card when the landing fails", async () => {
        openRefInCode.mockRejectedValue(new Error("No such file: docs/a.ts"));
        await togglePeek(at("a.ts"));

        await expect(openPeekInCode(model)).rejects.toThrow("No such file");

        expect(globalStore.get(codePeekAtom)).not.toBeNull();
    });

    it("leaves a card that moved meanwhile open", async () => {
        const landing = deferred<void>();
        openRefInCode.mockReturnValue(landing.promise);
        await togglePeek(at("a.ts"));

        const opening = openPeekInCode(model);
        await togglePeek({ ...at("b.ts"), bufferLine: 30 });
        landing.resolve();
        await opening;

        expect(globalStore.get(codePeekAtom)).toMatchObject({ abs: `${DIR}/b.ts` });
    });

    it("does nothing for a card with no file to open", async () => {
        rpc.FileInfoCommand.mockResolvedValue({ notfound: true });
        await togglePeek(at("gone.ts"));

        await openPeekInCode(model);

        expect(openRefInCode).not.toHaveBeenCalled();
    });
});
