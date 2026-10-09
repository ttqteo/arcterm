// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { globalStore } from "@/app/store/jotaiStore";
import { afterEach, describe, expect, it } from "vitest";
import { fileStepLabel, firstShownPath, shownPaths, stepFile } from "./filestep";
import { collapsedDirsAtom, treeModeAtom } from "./filetree";
import type { GitChange } from "./gitstatus";

function change(path: string): GitChange {
    return { path, status: "M", adds: 1, dels: 0 };
}

// input order is deliberately not the tree's: a tree draws directories before files, each sorted by name
const FILES = [change("z.txt"), change("src/b.ts"), change("a.md"), change("src/a.ts"), change("docs/x.md")];

describe("shownPaths", () => {
    it("lists the input order in flat mode", () => {
        expect(shownPaths(FILES, false, new Set())).toEqual(["z.txt", "src/b.ts", "a.md", "src/a.ts", "docs/x.md"]);
    });

    it("lists the tree's draw order in tree mode, directories first", () => {
        expect(shownPaths(FILES, true, new Set())).toEqual(["docs/x.md", "src/a.ts", "src/b.ts", "a.md", "z.txt"]);
    });

    it("skips the files of a collapsed directory in tree mode", () => {
        expect(shownPaths(FILES, true, new Set(["src"]))).toEqual(["docs/x.md", "a.md", "z.txt"]);
    });

    it("ignores the collapsed set in flat mode", () => {
        expect(shownPaths(FILES, false, new Set(["src"]))).toHaveLength(5);
    });

    it("is empty for no files", () => {
        expect(shownPaths([], true, new Set())).toEqual([]);
        expect(shownPaths([], false, new Set())).toEqual([]);
    });
});

describe("stepFile", () => {
    const paths = ["a", "b", "c"];

    it("moves to the next path", () => {
        expect(stepFile(paths, "a", 1)).toBe("b");
    });

    it("moves to the previous path", () => {
        expect(stepFile(paths, "c", -1)).toBe("b");
    });

    it("clamps at the ends", () => {
        expect(stepFile(paths, "c", 1)).toBe("c");
        expect(stepFile(paths, "a", -1)).toBe("a");
    });

    it("picks the first path when nothing is selected", () => {
        expect(stepFile(paths, null, 1)).toBe("a");
        expect(stepFile(paths, null, -1)).toBe("a");
    });

    it("picks the first path when the current one is no longer listed", () => {
        expect(stepFile(paths, "gone", 1)).toBe("a");
    });

    it("returns null when there is nothing to step through", () => {
        expect(stepFile([], null, 1)).toBeNull();
        expect(stepFile([], "a", 1)).toBeNull();
    });
});

describe("fileStepLabel", () => {
    const paths = ["a", "b", "c"];

    it("reads file i of n", () => {
        expect(fileStepLabel(paths, "a")).toBe("file 1 of 3");
        expect(fileStepLabel(paths, "c")).toBe("file 3 of 3");
    });

    it("counts from the first when the current file is not listed", () => {
        expect(fileStepLabel(paths, null)).toBe("file 1 of 3");
        expect(fileStepLabel(paths, "gone")).toBe("file 1 of 3");
    });

    it("reads file 0 of 0 for an empty list", () => {
        expect(fileStepLabel([], null)).toBe("file 0 of 0");
    });
});

describe("firstShownPath", () => {
    afterEach(() => {
        globalStore.set(treeModeAtom, true);
        globalStore.set(collapsedDirsAtom, new Set<string>());
    });

    it("is the top row of the tree, not the first file git listed", () => {
        globalStore.set(treeModeAtom, true);
        expect(firstShownPath(FILES)).toBe("docs/x.md");
    });

    it("is the first file listed in flat mode", () => {
        globalStore.set(treeModeAtom, false);
        expect(firstShownPath(FILES)).toBe("z.txt");
    });

    it("skips a collapsed folder's files", () => {
        globalStore.set(treeModeAtom, true);
        globalStore.set(collapsedDirsAtom, new Set(["docs"]));
        expect(firstShownPath(FILES)).toBe("src/a.ts");
    });

    it("ignores the folds when every folder is collapsed and nothing would be drawn", () => {
        globalStore.set(treeModeAtom, true);
        globalStore.set(collapsedDirsAtom, new Set(["docs"]));
        expect(firstShownPath([change("docs/x.md")])).toBe("docs/x.md");
    });

    it("is undefined for no files", () => {
        expect(firstShownPath([])).toBeUndefined();
    });
});
