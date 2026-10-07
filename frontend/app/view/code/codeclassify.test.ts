// frontend/app/view/code/codeclassify.test.ts
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
    classifyFile,
    defaultWrap,
    hasNulByte,
    isMarkdownPath,
    languageForPath,
    lineAtOffset,
    MAX_VIEW_BYTES,
    resolveViewMode,
    viewModesFor,
} from "./codeclassify";

describe("classifyFile", () => {
    it("treats an unrecognized (empty) mimetype as text, because Go and Rust land there", () => {
        expect(classifyFile(1000, "")).toBe("text");
    });

    it("accepts any text/* type", () => {
        expect(classifyFile(1000, "text/x-python")).toBe("text");
    });

    it("accepts the application/* types that are really text", () => {
        expect(classifyFile(1000, "application/json")).toBe("text");
        expect(classifyFile(1000, "application/javascript")).toBe("text");
    });

    it("ignores a charset parameter on the mimetype", () => {
        expect(classifyFile(1000, "text/plain; charset=utf-8")).toBe("text");
    });

    it("calls a real binary type binary", () => {
        expect(classifyFile(1000, "image/png")).toBe("binary");
        expect(classifyFile(1000, "application/octet-stream")).toBe("binary");
    });

    it("lets the size gate win over a text mimetype", () => {
        expect(classifyFile(MAX_VIEW_BYTES + 1, "text/plain")).toBe("toolarge");
    });

    it("admits a file exactly at the cap", () => {
        expect(classifyFile(MAX_VIEW_BYTES, "text/plain")).toBe("text");
    });
});

describe("hasNulByte", () => {
    it("is false for ordinary source text", () => {
        expect(hasNulByte("package main\n\nfunc main() {}\n")).toBe(false);
    });

    it("is true when a NUL appears in the scanned head", () => {
        expect(hasNulByte("abc\u0000def")).toBe(true);
    });

    it("does not scan past the head window", () => {
        expect(hasNulByte("a".repeat(9000) + "\u0000")).toBe(false);
    });
});

describe("isMarkdownPath", () => {
    it("accepts .md and .markdown, case-insensitively, at any depth", () => {
        expect(isMarkdownPath("README.md")).toBe(true);
        expect(isMarkdownPath("docs/guide.markdown")).toBe(true);
        expect(isMarkdownPath("CHANGELOG.MD")).toBe(true);
        expect(isMarkdownPath("frontend/app/view/code/readme.md")).toBe(true);
    });

    it("rejects extensions that merely contain md", () => {
        expect(isMarkdownPath("file.md5")).toBe(false);
        expect(isMarkdownPath("file.mds")).toBe(false);
        expect(isMarkdownPath("foo.md.txt")).toBe(false);
        expect(isMarkdownPath("src/main.ts")).toBe(false);
        expect(isMarkdownPath("Makefile")).toBe(false);
    });
});

describe("classifyFile and PDFs", () => {
    it("calls a PDF pdf, whatever its size: it is streamed, never read whole", () => {
        expect(classifyFile(1000, "application/pdf")).toBe("pdf");
        expect(classifyFile(MAX_VIEW_BYTES * 10, "application/pdf")).toBe("pdf");
    });

    it("reads .latex and .tex mimetypes as text", () => {
        expect(classifyFile(1000, "application/x-latex")).toBe("text");
        expect(classifyFile(1000, "text/x-tex")).toBe("text");
    });
});

describe("languageForPath", () => {
    it("names latex for the LaTeX family, .cls included (the backend calls it Apex)", () => {
        for (const p of ["main.tex", "acmart.cls", "x.sty", "a.ltx", "b.latex", "PAPER/Main.TEX"]) {
            expect(languageForPath(p)).toBe("latex");
        }
    });

    it("names bibtex for .bib", () => {
        expect(languageForPath("base.bib")).toBe("bibtex");
    });

    it("leaves every other file to Monaco's own inference", () => {
        expect(languageForPath("main.go")).toBeUndefined();
        expect(languageForPath("notes.md")).toBeUndefined();
        expect(languageForPath("texfile.txt")).toBeUndefined();
    });
});

describe("defaultWrap", () => {
    it("wraps prose whatever the setting says", () => {
        for (const p of ["main.tex", "base.bib", "README.md", "a.markdown", "notes.txt"]) {
            expect(defaultWrap(p, false)).toBe(true);
        }
    });

    it("follows editor:wordwrap for code, off when unset", () => {
        expect(defaultWrap("main.go", true)).toBe(true);
        expect(defaultWrap("main.go", false)).toBe(false);
        expect(defaultWrap("main.go", undefined)).toBe(false);
    });
});

describe("viewModesFor", () => {
    it("offers preview to markdown and .tex, pdf only to a .tex with a built PDF", () => {
        expect(viewModesFor("README.md", false)).toEqual(["preview", "source", "diff"]);
        expect(viewModesFor("main.tex", false)).toEqual(["preview", "source", "diff"]);
        expect(viewModesFor("main.tex", true)).toEqual(["preview", "source", "diff", "pdf"]);
    });

    it("offers source and diff to any other text file, PDF or not", () => {
        expect(viewModesFor("main.go", false)).toEqual(["source", "diff"]);
        expect(viewModesFor("main.go", true)).toEqual(["source", "diff"]);
        expect(viewModesFor("acmart.cls", true)).toEqual(["source", "diff"]);
    });
});

describe("resolveViewMode", () => {
    it("keeps a mode the file offers", () => {
        expect(resolveViewMode("main.tex", "pdf", true)).toBe("pdf");
        expect(resolveViewMode("main.go", "diff", false)).toBe("diff");
    });

    it("falls back to preview where there is one, else source", () => {
        expect(resolveViewMode("main.tex", "pdf", false)).toBe("preview");
        expect(resolveViewMode("main.go", "pdf", false)).toBe("source");
        expect(resolveViewMode("main.go", "preview", false)).toBe("source");
    });
});

describe("lineAtOffset", () => {
    it("counts lines from 1", () => {
        const text = "ab\ncd\n\nef";
        expect(lineAtOffset(text, 0)).toBe(1);
        expect(lineAtOffset(text, 2)).toBe(1);
        expect(lineAtOffset(text, 3)).toBe(2);
        expect(lineAtOffset(text, 7)).toBe(4);
    });

    it("clamps an offset past the end to the last line", () => {
        expect(lineAtOffset("a\nb", 99)).toBe(2);
    });
});
