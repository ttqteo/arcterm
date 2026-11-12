// frontend/app/view/code/codelink.test.ts
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { docLinkAnchor, resolveDocLink, slugHeadings } from "./codelink";

describe("resolveDocLink", () => {
    it("resolves a sibling against the open file's directory", () => {
        expect(resolveDocLink("docs/specs/a.md", "b.md")).toEqual({ rel: "docs/specs/b.md", line: null });
        expect(resolveDocLink("docs/specs/a.md", "./b.md")).toEqual({ rel: "docs/specs/b.md", line: null });
    });

    it("walks up with ..", () => {
        expect(resolveDocLink("docs/specs/a.md", "../plans/p.md")).toEqual({ rel: "docs/plans/p.md", line: null });
    });

    it("resolves from a file at the repository root", () => {
        expect(resolveDocLink("README.md", "docs/x.md")).toEqual({ rel: "docs/x.md", line: null });
    });

    it("treats a leading slash as the repository root, as GitHub does", () => {
        expect(resolveDocLink("docs/a.md", "/README.md")).toEqual({ rel: "README.md", line: null });
    });

    it("lands on the first line of a GitHub line anchor and drops any other fragment", () => {
        expect(resolveDocLink("a.md", "src/x.go#L12-L20")).toEqual({ rel: "src/x.go", line: 12 });
        expect(resolveDocLink("a.md", "b.md#some-heading")).toEqual({ rel: "b.md", line: null });
    });

    it("drops a query string and decodes escapes", () => {
        expect(resolveDocLink("a.md", "my%20notes.md?plain=1")).toEqual({ rel: "my notes.md", line: null });
    });

    it("leaves external links, bare anchors and empty hrefs alone", () => {
        for (const href of [
            "https://example.com/x.md",
            "mailto:a@b.c",
            "//cdn.example.com/x",
            "#heading",
            "",
            "C:\\x.md",
        ]) {
            expect(resolveDocLink("docs/a.md", href), href).toBeNull();
        }
    });

    it("refuses a link that climbs above the repository root", () => {
        expect(resolveDocLink("a.md", "../outside.md")).toBeNull();
    });
});

describe("slugHeadings", () => {
    it("slugHeadings matches GitHub for punctuation and repeats", () => {
        expect(slugHeadings(["The final stage", "A/B: test", "Setup", "Setup"])).toEqual([
            "the-final-stage",
            "ab-test",
            "setup",
            "setup-1",
        ]);
        expect(slugHeadings(["`codeFile` **kinds**", "snake_case-name", "x", "x", "x-1"])).toEqual([
            "codefile-kinds",
            "snake_case-name",
            "x",
            "x-1",
            "x-1-1",
        ]);
    });
});

describe("docLinkAnchor", () => {
    it("carries a cross-file heading anchor, decoded", () => {
        expect(docLinkAnchor("b.md#some-heading")).toBe("some-heading");
        expect(docLinkAnchor("b.md#caf%C3%A9")).toBe("café");
        expect(docLinkAnchor("../plans/p.md?plain=1#the-final-stage")).toBe("the-final-stage");
    });

    it("is null for no fragment, a line anchor, an in-page anchor, an external link or a bad escape", () => {
        for (const href of ["b.md", "b.md#", "src/x.go#L12-L20", "#heading", "https://x.dev/a.md#h", "b.md#%E0%A4%A"]) {
            expect(docLinkAnchor(href), href).toBeNull();
        }
    });
});
