// frontend/util/paths.test.ts
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { beforeEach, describe, expect, it } from "vitest";
import { joinRepoPath, repoBasename, sameRepoPath, splitRepoPath } from "./paths";
import { setPlatform } from "./platformutil";

describe("joinRepoPath on Windows", () => {
    beforeEach(() => setPlatform("win32"));

    it("joins a forward-slashed git path onto a backslashed Windows root", () => {
        expect(joinRepoPath("C:\\repo", "src/main.ts")).toBe("C:\\repo\\src\\main.ts");
    });

    it("normalizes a mixed-separator join to a single separator style", () => {
        expect(joinRepoPath("C:/repo", "src/main.ts")).toBe("C:\\repo\\src\\main.ts");
    });

    it("handles a root-level file", () => {
        expect(joinRepoPath("C:\\repo", "README.md")).toBe("C:\\repo\\README.md");
    });

    it("does not choke on a trailing separator on the root", () => {
        expect(joinRepoPath("C:\\repo\\", "a.ts")).toBe("C:\\repo\\a.ts");
    });
});

describe("joinRepoPath on macOS", () => {
    beforeEach(() => setPlatform("darwin"));

    it("keeps the forward slashes of a POSIX root", () => {
        expect(joinRepoPath("/Users/x/repo", "src/main.ts")).toBe("/Users/x/repo/src/main.ts");
    });

    it("does not double the separator after a trailing slash on the root", () => {
        expect(joinRepoPath("/Users/x/repo/", "a.ts")).toBe("/Users/x/repo/a.ts");
    });
});

describe("sameRepoPath", () => {
    it("ignores separator style", () => {
        expect(sameRepoPath("C:/repo/sub", "C:\\repo\\sub")).toBe(true);
    });

    it("ignores a trailing separator", () => {
        expect(sameRepoPath("C:\\repo\\", "C:\\repo")).toBe(true);
    });

    it("ignores case, because NTFS does", () => {
        expect(sameRepoPath("C:\\Repo\\Sub", "c:\\repo\\sub")).toBe(true);
    });

    it("still distinguishes genuinely different paths", () => {
        expect(sameRepoPath("C:\\repo\\a", "C:\\repo\\b")).toBe(false);
    });

    it("treats an empty path as matching nothing, so a blank cwd cannot claim a project", () => {
        expect(sameRepoPath("", "")).toBe(false);
        expect(sameRepoPath("", "C:\\repo")).toBe(false);
    });
});

describe("repoBasename", () => {
    it("takes the last segment of a backslashed path", () => {
        expect(repoBasename("C:\\code\\my-worktree")).toBe("my-worktree");
    });

    it("takes the last segment of a forward-slashed path", () => {
        expect(repoBasename("C:/code/my-worktree")).toBe("my-worktree");
    });

    it("ignores a trailing separator", () => {
        expect(repoBasename("C:\\code\\my-worktree\\")).toBe("my-worktree");
    });

    it("falls back to the whole string when there is no separator", () => {
        expect(repoBasename("repo")).toBe("repo");
    });

    it("returns an empty string for an empty path", () => {
        expect(repoBasename("")).toBe("");
    });
});

describe("splitRepoPath", () => {
    it("keeps the trailing slash on the directory", () => {
        expect(splitRepoPath("frontend/app/view/agents/agenttree.tsx")).toEqual({
            dir: "frontend/app/view/agents/",
            file: "agenttree.tsx",
        });
    });
    it("has an empty directory at the root", () => {
        expect(splitRepoPath("README.md")).toEqual({ dir: "", file: "README.md" });
    });
});
