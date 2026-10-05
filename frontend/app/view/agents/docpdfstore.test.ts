// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { globalStore } from "@/app/store/jotaiStore";
import { RpcApi } from "@/app/store/wshclientapi";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pdfPaneState } from "./docpdf";
import { COMPILE_RPC_TIMEOUT_MS, compileCalls, docPdfAtom, setCompileFixture, startDocCompile } from "./docpdfstore";

vi.mock("@/app/store/wshrpcutil", () => ({ TabRpcClient: {} }));
vi.mock("@/app/store/wshclientapi", () => ({
    RpcApi: { DocCompileCommand: vi.fn() },
}));

const PATH = "/r/paper/main.tex";
const RESULT: CommandDocCompileRtnData = {
    rootpath: PATH,
    pdfpath: "/data/doccompile/abc/main.pdf",
    ok: true,
    engine: "latexmk",
    durationms: 1200,
    pages: 3,
};

function deferred<T>() {
    let resolve!: (v: T) => void;
    let reject!: (e: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

// each test gets its own agent, so the atom family starts empty
let n = 0;
const freshAgent = () => `pdf-agent-${++n}`;
const compile = vi.mocked(RpcApi.DocCompileCommand);

beforeEach(() => {
    compile.mockReset();
    compile.mockResolvedValue(RESULT);
});

afterEach(() => setCompileFixture(null));

describe("startDocCompile", () => {
    it("compiles the review's file with a timeout above the server's 90 s limit, and keeps the result", async () => {
        const id = freshAgent();
        await startDocCompile(id, PATH, "a1", {}, 1000);
        expect(compile).toHaveBeenCalledTimes(1);
        expect(compile.mock.calls[0][1]).toEqual({ path: PATH });
        expect(compile.mock.calls[0][2]).toEqual({ timeout: COMPILE_RPC_TIMEOUT_MS });
        expect(COMPILE_RPC_TIMEOUT_MS).toBeGreaterThan(90_000);
        expect(globalStore.get(docPdfAtom(id))).toMatchObject({
            askId: "a1",
            path: PATH,
            pending: false,
            result: RESULT,
            error: null,
            startedAt: 1000,
        });
    });

    it("is pending while the compile runs", async () => {
        const id = freshAgent();
        const d = deferred<CommandDocCompileRtnData>();
        compile.mockReturnValue(d.promise);
        const run = startDocCompile(id, PATH, "a1");
        expect(globalStore.get(docPdfAtom(id))).toMatchObject({ askId: "a1", pending: true, result: null });
        d.resolve(RESULT);
        await run;
        expect(globalStore.get(docPdfAtom(id))).toMatchObject({ pending: false, result: RESULT });
    });

    it("does not compile again for the same askId: switching tabs or remounting reuses the result", async () => {
        const id = freshAgent();
        await startDocCompile(id, PATH, "a1");
        await startDocCompile(id, PATH, "a1");
        expect(compile).toHaveBeenCalledTimes(1);
    });

    it("runs one compile per review: a second start while one runs does not call the RPC", async () => {
        const id = freshAgent();
        const d = deferred<CommandDocCompileRtnData>();
        compile.mockReturnValue(d.promise);
        const run = startDocCompile(id, PATH, "a1");
        await startDocCompile(id, PATH, "a1");
        expect(compile).toHaveBeenCalledTimes(1);
        d.resolve(RESULT);
        await run;
    });

    it("compiles again on force (Recompile)", async () => {
        const id = freshAgent();
        await startDocCompile(id, PATH, "a1");
        compile.mockResolvedValue({ ...RESULT, pages: 4 });
        await startDocCompile(id, PATH, "a1", { force: true });
        expect(compile).toHaveBeenCalledTimes(2);
        expect(globalStore.get(docPdfAtom(id))?.result?.pages).toBe(4);
    });

    it("ignores force while a compile runs", async () => {
        const id = freshAgent();
        const d = deferred<CommandDocCompileRtnData>();
        compile.mockReturnValue(d.promise);
        const run = startDocCompile(id, PATH, "a1");
        await startDocCompile(id, PATH, "a1", { force: true });
        expect(compile).toHaveBeenCalledTimes(1);
        d.resolve(RESULT);
        await run;
    });

    it("drops the old result for a new askId and compiles for it", async () => {
        const id = freshAgent();
        await startDocCompile(id, PATH, "a1");
        const d = deferred<CommandDocCompileRtnData>();
        compile.mockReturnValue(d.promise);
        const run = startDocCompile(id, PATH, "a2");
        expect(compile).toHaveBeenCalledTimes(2);
        expect(globalStore.get(docPdfAtom(id))).toMatchObject({ askId: "a2", pending: true, result: null });
        d.resolve(RESULT);
        await run;
        expect(globalStore.get(docPdfAtom(id))).toMatchObject({ askId: "a2", pending: false, result: RESULT });
    });

    it("drops a result that lands after the agent asked again", async () => {
        const id = freshAgent();
        const old = deferred<CommandDocCompileRtnData>();
        compile.mockReturnValueOnce(old.promise);
        const first = startDocCompile(id, PATH, "a1");
        await startDocCompile(id, PATH, "a2");
        old.resolve({ ...RESULT, pages: 99 });
        await first;
        expect(globalStore.get(docPdfAtom(id))).toMatchObject({ askId: "a2", result: RESULT });
    });

    it("turns a rejected RPC into a failed state with the error text", async () => {
        const id = freshAgent();
        compile.mockRejectedValue(new Error("context deadline exceeded"));
        await startDocCompile(id, PATH, "a1");
        const s = globalStore.get(docPdfAtom(id));
        expect(s).toMatchObject({ pending: false, error: "context deadline exceeded" });
        expect(pdfPaneState(s.result, s.pending, s.error)).toBe("failed");
    });

    it("clears the error when a recompile succeeds", async () => {
        const id = freshAgent();
        compile.mockRejectedValueOnce("timeout");
        await startDocCompile(id, PATH, "a1");
        expect(globalStore.get(docPdfAtom(id))?.error).toBe("timeout");
        await startDocCompile(id, PATH, "a1", { force: true });
        expect(globalStore.get(docPdfAtom(id))).toMatchObject({ error: null, result: RESULT });
    });

    it("counts every compile it starts", async () => {
        const id = freshAgent();
        const before = compileCalls();
        await startDocCompile(id, PATH, "a1");
        await startDocCompile(id, PATH, "a1");
        await startDocCompile(id, PATH, "a1", { force: true });
        expect(compileCalls()).toBe(before + 2);
    });
});

describe("the compile fixture", () => {
    it("answers the next compile in place of the RPC, merged over an ok result for the file, then is used up", async () => {
        const id = freshAgent();
        setCompileFixture({ pages: 9, pdfpath: "/r/paper/sample.pdf" });
        await startDocCompile(id, PATH, "a1");
        expect(compile).not.toHaveBeenCalled();
        expect(globalStore.get(docPdfAtom(id))?.result).toEqual({
            rootpath: PATH,
            ok: true,
            engine: "latexmk",
            durationms: 6200,
            pages: 9,
            pdfpath: "/r/paper/sample.pdf",
        });
        await startDocCompile(id, PATH, "a1", { force: true });
        expect(compile).toHaveBeenCalledTimes(1);
    });

    it("stays for every compile when kept", async () => {
        const id = freshAgent();
        setCompileFixture({ ok: false, engine: "" }, { keep: true });
        await startDocCompile(id, PATH, "a1");
        await startDocCompile(id, PATH, "a2");
        expect(compile).not.toHaveBeenCalled();
        const s = globalStore.get(docPdfAtom(id));
        expect(pdfPaneState(s.result, s.pending, s.error)).toBe("noengine");
    });

    it("leaves the compile pending", async () => {
        const id = freshAgent();
        setCompileFixture("pending");
        void startDocCompile(id, PATH, "a1");
        await Promise.resolve();
        expect(globalStore.get(docPdfAtom(id))?.pending).toBe(true);
        await startDocCompile(id, PATH, "a1", { force: true });
        expect(compile).not.toHaveBeenCalled();
    });

    it("null puts the real RPC back", async () => {
        const id = freshAgent();
        setCompileFixture({ pages: 9 }, { keep: true });
        setCompileFixture(null);
        await startDocCompile(id, PATH, "a1");
        expect(compile).toHaveBeenCalledTimes(1);
    });
});
