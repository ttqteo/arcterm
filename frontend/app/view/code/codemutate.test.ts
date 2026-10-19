// frontend/app/view/code/codemutate.test.ts
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { deleteWarning, nameErrorMessage, provisionalIndex, renamedPath, targetDir, validateName } from "./codemutate";
import type { TreeRow } from "./codetree";

const EXISTING = ["src/a.ts", "src/util/b.ts", "README.md"];

const rows: TreeRow[] = [
    { kind: "dir", path: "src", name: "src", depth: 0, expanded: true },
    { kind: "file", path: "src/a.ts", name: "a.ts", depth: 1, expanded: false },
    { kind: "dir", path: "src/util", name: "util", depth: 1, expanded: false },
    { kind: "file", path: "README.md", name: "README.md", depth: 0, expanded: false },
];

describe("validateName", () => {
    it("accepts an ordinary new name", () => {
        expect(validateName("c.ts", "src", EXISTING)).toBeNull();
    });

    it("rejects an empty or whitespace-only name", () => {
        expect(validateName("", "src", EXISTING)).toBe("empty");
        expect(validateName("   ", "src", EXISTING)).toBe("empty");
    });

    it("rejects a path separator in either direction", () => {
        expect(validateName("sub/c.ts", "src", EXISTING)).toBe("separator");
        expect(validateName("sub\\c.ts", "src", EXISTING)).toBe("separator");
    });

    it("rejects the directory dots", () => {
        expect(validateName(".", "src", EXISTING)).toBe("dots");
        expect(validateName("..", "src", EXISTING)).toBe("dots");
    });

    it("accepts a leading dot, which is an ordinary hidden file", () => {
        expect(validateName(".gitignore", "", EXISTING)).toBeNull();
    });

    it("rejects characters Windows cannot put in a filename", () => {
        for (const bad of ["a<b", "a>b", "a:b", 'a"b', "a|b", "a?b", "a*b"]) {
            expect(validateName(bad, "src", EXISTING)).toBe("illegal-char");
        }
    });

    it("rejects a reserved device name with or without an extension", () => {
        expect(validateName("CON", "src", EXISTING)).toBe("reserved");
        expect(validateName("nul.txt", "src", EXISTING)).toBe("reserved");
        expect(validateName("COM1", "src", EXISTING)).toBe("reserved");
        expect(validateName("LPT9.log", "src", EXISTING)).toBe("reserved");
    });

    it("does not treat a name that merely starts with a device name as reserved", () => {
        expect(validateName("console.ts", "src", EXISTING)).toBeNull();
    });

    it("rejects a name already in the index, as a file or as a directory", () => {
        expect(validateName("a.ts", "src", EXISTING)).toBe("exists");
        expect(validateName("util", "src", EXISTING)).toBe("exists");
    });

    it("words every error", () => {
        expect(nameErrorMessage("empty")).toBe("Enter a name.");
        expect(nameErrorMessage("separator")).toBe("A name cannot contain a path separator.");
        expect(nameErrorMessage("dots")).toBe('"." and ".." are not names.');
        expect(nameErrorMessage("illegal-char")).toBe('A name cannot contain < > : " | ? * or control characters.');
        expect(nameErrorMessage("reserved")).toBe("That is a reserved device name on Windows.");
        expect(nameErrorMessage("exists")).toBe("Something with that name is already here.");
    });
});

describe("targetDir", () => {
    it("uses the cursor directory itself", () => {
        expect(targetDir("src/util", rows)).toBe("src/util");
    });

    it("uses a cursor file's parent", () => {
        expect(targetDir("src/a.ts", rows)).toBe("src");
    });

    it("falls back to the repo root for a file at the root", () => {
        expect(targetDir("README.md", rows)).toBe("");
    });

    it("falls back to the repo root with no cursor, or a cursor no row matches", () => {
        expect(targetDir(null, rows)).toBe("");
        expect(targetDir("gone/x.ts", rows)).toBe("");
    });
});

describe("provisionalIndex", () => {
    it("puts a new entry at the top for the repo root", () => {
        expect(provisionalIndex(rows, "")).toBe(0);
    });

    it("puts it directly under its target directory row", () => {
        expect(provisionalIndex(rows, "src")).toBe(1);
        expect(provisionalIndex(rows, "src/util")).toBe(3);
    });

    it("falls back to the top when the directory has no visible row", () => {
        expect(provisionalIndex(rows, "nowhere")).toBe(0);
    });
});

describe("renamedPath", () => {
    it("rewrites the renamed path itself", () => {
        expect(renamedPath("src/a.ts", "src/a.ts", "src/z.ts")).toBe("src/z.ts");
    });

    it("rewrites everything under a renamed directory", () => {
        expect(renamedPath("src/util/b.ts", "src/util", "src/helpers")).toBe("src/helpers/b.ts");
    });

    it("leaves an unrelated path alone, including a shared prefix that is not a directory", () => {
        expect(renamedPath("README.md", "src/a.ts", "src/z.ts")).toBe("README.md");
        expect(renamedPath("src/utilities.ts", "src/util", "src/helpers")).toBe("src/utilities.ts");
    });
});

describe("deleteWarning", () => {
    it("tells a tracked file the committed copy survives", () => {
        const msg = deleteWarning("src/a.ts", [undefined], false);
        expect(msg).toContain("src/a.ts");
        expect(msg).toContain("committed copy stays in git history");
    });

    it("tells a staged-but-uncommitted file that checkout restores it", () => {
        const msg = deleteWarning("src/new.ts", [{ status: "A", adds: 3, dels: 0 }], false);
        expect(msg).toContain("git checkout");
    });

    it("tells an untracked file it cannot be undone", () => {
        const msg = deleteWarning("scratch.txt", [{ status: "?", adds: 0, dels: 0 }], false);
        expect(msg).toContain("cannot be undone");
    });

    it("takes the weakest sentence for a directory: one untracked file makes the whole delete final", () => {
        const msg = deleteWarning(
            "src/util",
            [undefined, { status: "A", adds: 1, dels: 0 }, { status: "?", adds: 0, dels: 0 }],
            true
        );
        expect(msg).toContain("cannot be undone");
        expect(msg).toContain("3 files");
    });

    it("says the committed copies survive when everything under a directory is tracked", () => {
        const msg = deleteWarning("src/util", [undefined, { status: "M", adds: 2, dels: 1 }], true);
        expect(msg).toContain("committed copies stay in git history");
    });
});
