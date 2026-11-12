// frontend/app/view/code/codeviewmode.test.ts
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { showsSourceEditor } from "./codeviewmode";

describe("showsSourceEditor", () => {
    it("showsSourceEditor is false for markdown Preview and for Diff, true for a Go file in preview mode", () => {
        expect(showsSourceEditor("preview", "docs/README.md")).toBe(false);
        expect(showsSourceEditor("diff", "main.go")).toBe(false);
        expect(showsSourceEditor("diff", "docs/README.md")).toBe(false);
        expect(showsSourceEditor("preview", "main.go")).toBe(true);
        expect(showsSourceEditor("source", "docs/README.md")).toBe(true);
        expect(showsSourceEditor("source", "main.go")).toBe(true);
    });

    it("reads a web page's Preview and a .tex file's Preview and PDF as rendered, not Source", () => {
        expect(showsSourceEditor("preview", "slides/slide.html")).toBe(false);
        expect(showsSourceEditor("source", "slides/slide.html")).toBe(true);
        expect(showsSourceEditor("preview", "paper/main.tex")).toBe(false);
        expect(showsSourceEditor("pdf", "paper/main.tex", { hasPdf: true })).toBe(false);
    });

    it("falls back the way the viewer does when the chosen mode is not on offer", () => {
        // PDF chosen on a .tex file with no built PDF reads as its Preview
        expect(showsSourceEditor("pdf", "paper/main.tex")).toBe(false);
        // a .tex file with nothing to preview opens on Source
        expect(showsSourceEditor("preview", "paper/numbers.tex", { previewable: false })).toBe(true);
        // PDF chosen, then a Go file opened: Source
        expect(showsSourceEditor("pdf", "main.go")).toBe(true);
    });
});
