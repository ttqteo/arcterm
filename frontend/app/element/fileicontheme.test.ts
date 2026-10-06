// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { fileIconName, folderIconName } from "./fileicontheme";

describe("fileIconName", () => {
    it("prefers an exact file name over the extension", () => {
        expect(fileIconName("package.json")).toBe("nodejs");
        expect(fileIconName("apps/web/tsconfig.json")).toBe("tsconfig");
        expect(fileIconName(".gitignore")).toBe("git");
    });

    it("matches file names case-insensitively", () => {
        expect(fileIconName("README.md")).toBe("readme");
        expect(fileIconName("Dockerfile")).toBe("docker");
    });

    it("tries the longest compound extension first", () => {
        expect(fileIconName("src/foo.d.ts")).toBe("typescript-def");
        expect(fileIconName("src/foo.ts")).toBe("typescript");
    });

    it("matches a name scoped to its parent folder only under that folder", () => {
        expect(fileIconName("app/src/bashly-strings.yaml")).toBe("bashly-strings");
        expect(fileIconName("app/bashly-strings.yaml")).toBe("yaml");
    });

    it("falls back to the generic file icon", () => {
        expect(fileIconName("notes.zzzunknown")).toBe("file");
        expect(fileIconName("LICENSE_NOPE")).toBe("file");
    });
});

describe("folderIconName", () => {
    it("uses the named folder icon, open when expanded", () => {
        expect(folderIconName("src", false)).toBe("folder-src");
        expect(folderIconName("apps/web/src", true)).toBe("folder-src-open");
    });

    it("falls back to the plain folder", () => {
        expect(folderIconName("zzz-nothing", false)).toBe("folder");
        expect(folderIconName("zzz-nothing", true)).toBe("folder-open");
    });
});
