// frontend/app/view/code/codeworktrees.test.ts
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { setPlatform } from "@/util/platformutil";
import { beforeEach, describe, expect, it } from "vitest";
import { worktreeFolders } from "./codeworktrees";

const worktrees: GitWorktree[] = [
    { path: "C:/repos/alpha", branch: "main", ismain: true },
    { path: "C:/repos/alpha-feat", branch: "feat" },
];

describe("worktreeFolders", () => {
    // joinRepoPath builds native paths, and these expectations are Windows ones
    beforeEach(() => setPlatform("win32"));

    it("maps a subfolder project across separators and case", () => {
        expect(worktreeFolders("c:\\Repos\\ALPHA\\pkg\\web\\", worktrees)).toEqual([
            { label: "main", path: "C:\\repos\\alpha\\pkg\\web" },
            { label: "feat", path: "C:\\repos\\alpha-feat\\pkg\\web" },
        ]);
    });

    it("labels a detached checkout by its folder", () => {
        const detached = [...worktrees, { path: "C:/tmp/review-1" }];
        expect(worktreeFolders("C:\\repos\\alpha", detached)[2]).toEqual({
            label: "review-1 (detached)",
            path: "C:/tmp/review-1",
        });
    });

    it("a project at the repo root maps to the worktree roots", () => {
        expect(worktreeFolders("C:\\repos\\alpha", worktrees)).toEqual([
            { label: "main", path: "C:/repos/alpha" },
            { label: "feat", path: "C:/repos/alpha-feat" },
        ]);
    });

    it("maps against the innermost worktree when one is nested in another", () => {
        const nested = [...worktrees, { path: "C:/repos/alpha/.worktrees/fix", branch: "fix" }];
        expect(worktreeFolders("C:\\repos\\alpha\\.worktrees\\fix\\docs", nested).map((f) => f.path)).toEqual([
            "C:\\repos\\alpha\\docs",
            "C:\\repos\\alpha-feat\\docs",
            "C:\\repos\\alpha\\.worktrees\\fix\\docs",
        ]);
    });

    it("is empty when no worktree contains the project", () => {
        expect(worktreeFolders("D:\\elsewhere", worktrees)).toEqual([]);
    });
});
