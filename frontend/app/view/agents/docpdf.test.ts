// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
    appendNote,
    compiledMeta,
    compilingMeta,
    errorForAnswer,
    failureLines,
    overLimit,
    overLimitLabel,
    pagesLabel,
    pdfPaneState,
    urlFor,
} from "./docpdf";

const ROOT = "D:\\thesis\\paper\\main.tex";
const ok = (patch: Partial<CommandDocCompileRtnData> = {}): CommandDocCompileRtnData => ({
    rootpath: ROOT,
    pdfpath: "C:\\data\\doccompile\\abc\\main.pdf",
    ok: true,
    engine: "latexmk",
    durationms: 6200,
    pages: 9,
    ...patch,
});
const ERROR = "! Undefined control sequence.\nl.212 ...the generator calls \\xyzgen";

describe("pdfPaneState", () => {
    it("is compiling while a compile runs, whatever the last result was", () => {
        expect(pdfPaneState(null, true)).toBe("compiling");
        expect(pdfPaneState(ok(), true)).toBe("compiling");
        expect(pdfPaneState(ok({ ok: false, engine: "" }), true)).toBe("compiling");
    });

    it("is compiling before the first result lands", () => {
        expect(pdfPaneState(null, false)).toBe("compiling");
    });

    it("reads no root before no engine: a file with no root never looks for an engine", () => {
        expect(pdfPaneState(ok({ rootpath: "", engine: "", ok: false, pdfpath: undefined }), false)).toBe("noroot");
    });

    it("reads no engine when a root was found and no engine was", () => {
        expect(pdfPaneState(ok({ engine: "", ok: false, pdfpath: undefined }), false)).toBe("noengine");
    });

    it("reads failed when the engine ran and the compile did not succeed", () => {
        expect(pdfPaneState(ok({ ok: false, firsterror: ERROR, pdfpath: undefined }), false)).toBe("failed");
    });

    it("reads ok for a successful compile", () => {
        expect(pdfPaneState(ok(), false)).toBe("ok");
    });

    it("reads a rejected RPC as failed, whatever result came before", () => {
        expect(pdfPaneState(null, false, "context deadline exceeded")).toBe("failed");
        expect(pdfPaneState(ok(), false, "context deadline exceeded")).toBe("failed");
        expect(pdfPaneState(ok(), true, "context deadline exceeded")).toBe("compiling");
    });
});

describe("overLimit", () => {
    it("counts the pages past the limit", () => {
        expect(overLimit(9, 8)).toBe(1);
        expect(overLimit(11, 8)).toBe(3);
    });

    it("is 0 with no limit, at the limit, or under it", () => {
        expect(overLimit(9)).toBe(0);
        expect(overLimit(8, 8)).toBe(0);
        expect(overLimit(3, 8)).toBe(0);
        expect(overLimit(9, 0)).toBe(0);
    });
});

describe("page copy", () => {
    it("says page or pages", () => {
        expect(pagesLabel(9)).toBe("9 pages");
        expect(pagesLabel(1)).toBe("1 page");
    });

    it("names the overrun and the limit", () => {
        expect(overLimitLabel(9, 8)).toBe("1 page over the 8-page limit");
        expect(overLimitLabel(11, 8)).toBe("3 pages over the 8-page limit");
    });
});

describe("compiledMeta", () => {
    it("reads the local time the result landed, the engine and the seconds to one decimal", () => {
        const at = new Date(2026, 9, 5, 14, 6, 30).getTime();
        expect(compiledMeta(ok(), at)).toBe("compiled 14:06 · latexmk · 6.2 s");
        expect(compiledMeta(ok({ engine: "tectonic", durationms: 480 }), new Date(2026, 9, 5, 9, 3).getTime())).toBe(
            "compiled 09:03 · tectonic · 0.5 s"
        );
    });
});

describe("compilingMeta", () => {
    it("counts whole seconds and names the engine once one is known", () => {
        expect(compilingMeta(4800, "latexmk")).toBe("compiling with latexmk · 4 s");
        expect(compilingMeta(300)).toBe("compiling · 0 s");
        expect(compilingMeta(2000, "")).toBe("compiling · 2 s");
    });
});

describe("failureLines", () => {
    it("is the first error and its l. line", () => {
        expect(failureLines(ok({ ok: false, firsterror: ERROR }))).toEqual([
            "! Undefined control sequence.",
            "l.212 ...the generator calls \\xyzgen",
        ]);
    });

    it("falls back to the end of the log when the error isn't in TeX's format", () => {
        const logtail = "This is pdfTeX\n\nsome line\nlatexmk: could not start\nCompile timed out after 1m30s.\n";
        expect(failureLines(ok({ ok: false, logtail }))).toEqual([
            "some line",
            "latexmk: could not start",
            "Compile timed out after 1m30s.",
        ]);
    });

    it("is the RPC's error when the call itself failed", () => {
        expect(failureLines(ok(), "context deadline exceeded")).toEqual(["context deadline exceeded"]);
    });
});

describe("errorForAnswer", () => {
    it("names the file and carries both log lines, on one line for the general note", () => {
        const text = errorForAnswer(ok({ ok: false, firsterror: ERROR }), "main.tex");
        expect(text).toBe(
            "main.tex didn't compile: ! Undefined control sequence. l.212 ...the generator calls \\xyzgen"
        );
        expect(text).not.toContain("\n");
    });

    it("names the root when the reviewed file is not the root", () => {
        const r = ok({ ok: false, firsterror: ERROR });
        expect(errorForAnswer(r, "chapter3.tex")).toBe(
            "chapter3.tex didn't compile (root main.tex): ! Undefined control sequence. l.212 ...the generator calls \\xyzgen"
        );
    });
});

describe("appendNote", () => {
    it("fills an empty note and appends to one with text", () => {
        expect(appendNote("", "main.tex didn't compile.")).toBe("main.tex didn't compile.");
        expect(appendNote("  ", "main.tex didn't compile.")).toBe("main.tex didn't compile.");
        expect(appendNote("Tighten §3.", "main.tex didn't compile.")).toBe("Tighten §3. main.tex didn't compile.");
    });

    it("does not add the same error twice", () => {
        expect(appendNote("Tighten §3. main.tex didn't compile.", "main.tex didn't compile.")).toBe(
            "Tighten §3. main.tex didn't compile."
        );
    });
});

describe("urlFor", () => {
    const ENDPOINT = "http://127.0.0.1:61234";

    it("streams a Windows path with a drive letter, backslashes and a space as a wsh://local URI, with the auth key", () => {
        const path = "C:\\Users\\me\\Arc data\\doccompile\\abc\\main.pdf";
        const url = urlFor(path, ENDPOINT, "key 1");
        expect(url.startsWith(`${ENDPOINT}/wave/stream-file?`)).toBe(true);
        const parsed = new URL(url);
        expect(parsed.searchParams.get("path")).toBe(`wsh://local/${path}`);
        expect(parsed.searchParams.get("authkey")).toBe("key 1");
        expect(url).toContain("authkey=");
        expect(url).not.toContain(" ");
    });

    it("adds a version so a recompile that writes the same path is not served from cache", () => {
        const url = new URL(urlFor("/home/me/main.pdf", ENDPOINT, "k", 1759650000000));
        expect(url.searchParams.get("path")).toBe("wsh://local//home/me/main.pdf");
        expect(url.searchParams.get("v")).toBe("1759650000000");
        expect(new URL(urlFor("/home/me/main.pdf", ENDPOINT, "k")).searchParams.has("v")).toBe(false);
    });
});
