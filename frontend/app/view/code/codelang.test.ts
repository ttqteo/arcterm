// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { extOf, langGlobs, langOf } from "./codelang";

describe("langOf", () => {
    it("maps each family's extensions", () => {
        expect(langOf("pkg/gitinfo/gitinfo.go")).toBe("go");
        expect(langOf("frontend/app/view/code/codestore.ts")).toBe("ts");
        expect(langOf("src-tauri/src/main.rs")).toBe("rust");
        expect(langOf("tools/x.py")).toBe("python");
        expect(langOf("A.java")).toBe("java");
        expect(langOf("scripts/build.sh")).toBe("shell");
        expect(langOf("frontend/tailwindsetup.css")).toBe("css");
        expect(langOf("README.md")).toBe("markdown");
    });

    it("puts the ambiguous JavaScript module extensions in the ts family", () => {
        for (const p of ["a.mjs", "a.cjs", "a.mts", "a.cts", "a.jsx", "a.tsx"]) {
            expect(langOf(p)).toBe("ts");
        }
    });

    it("claims no language it has no forms for", () => {
        expect(langOf("csrc/x.h")).toBe("unknown");
        expect(langOf("Taskfile")).toBe("unknown");
        expect(langOf(".gitignore")).toBe("unknown");
    });

    it("ignores case and directories with dots", () => {
        expect(langOf("Docs/NOTES.MD")).toBe("markdown");
        expect(langOf("a.b/c")).toBe("unknown");
    });
});

describe("extOf", () => {
    it("is empty for a dotfile or a bare name", () => {
        expect(extOf(".bashrc")).toBe("");
        expect(extOf("Makefile")).toBe("");
        expect(extOf("x/y.FOO")).toBe("foo");
    });
});

describe("langGlobs", () => {
    it("lists one any-depth glob per extension", () => {
        expect(langGlobs("go")).toEqual(["*.go"]);
        expect(langGlobs("ts")).toEqual(["*.ts", "*.tsx", "*.mts", "*.cts", "*.js", "*.jsx", "*.mjs", "*.cjs"]);
        expect(langGlobs("rust")).toEqual(["*.rs"]);
        expect(langGlobs("python")).toEqual(["*.py", "*.pyi"]);
        expect(langGlobs("java")).toEqual(["*.java"]);
        expect(langGlobs("shell")).toEqual(["*.sh", "*.bash", "*.zsh"]);
        expect(langGlobs("css")).toEqual(["*.css", "*.scss", "*.less"]);
        expect(langGlobs("markdown")).toEqual(["*.md", "*.markdown", "*.mdx"]);
    });

    it("scopes nothing for an unknown language", () => {
        expect(langGlobs("unknown")).toEqual([]);
    });
});
