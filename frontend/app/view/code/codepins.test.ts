// frontend/app/view/code/codepins.test.ts
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { isPinned, parsePins, pinsFor, pinsToMigrate, renamePins, togglePin, unpinUnder } from "./codepins";

const repo = "C:\\papers\\thesis";

describe("togglePin", () => {
    it("pins in the order files were pinned, and unpins", () => {
        let pins = togglePin({}, repo, "main.tex");
        pins = togglePin(pins, repo, "refs.bib");
        expect(pinsFor(pins, repo)).toEqual(["main.tex", "refs.bib"]);
        pins = togglePin(pins, repo, "main.tex");
        expect(pinsFor(pins, repo)).toEqual(["refs.bib"]);
    });

    it("drops a project's key once its last pin goes", () => {
        expect(togglePin(togglePin({}, repo, "a.md"), repo, "a.md")).toEqual({});
    });

    it("keeps one list per project, whatever the path's spelling", () => {
        const pins = togglePin(togglePin({}, repo, "main.tex"), "c:/papers/THESIS", "refs.bib");
        expect(Object.keys(pins)).toEqual([repo]);
        expect(isPinned(pins, "c:/papers/thesis", "refs.bib")).toBe(true);
    });

    it("keeps projects apart", () => {
        const pins = togglePin({}, repo, "main.tex");
        expect(isPinned(pins, "C:\\papers\\other", "main.tex")).toBe(false);
    });
});

describe("renamePins", () => {
    it("carries a renamed file and a renamed directory's files", () => {
        const pins = { [repo]: ["sections/intro.tex", "main.tex", "sectionsx/a.tex"] };
        expect(pinsFor(renamePins(pins, repo, "sections", "chapters"), repo)).toEqual([
            "chapters/intro.tex",
            "main.tex",
            "sectionsx/a.tex",
        ]);
        expect(pinsFor(renamePins(pins, repo, "main.tex", "paper.tex"), repo)).toContain("paper.tex");
    });

    it("leaves the map alone for a project with no pins", () => {
        const pins = { [repo]: ["main.tex"] };
        expect(renamePins(pins, "C:\\other", "main.tex", "x.tex")).toBe(pins);
    });
});

describe("unpinUnder", () => {
    it("drops a deleted file, or every file under a deleted directory", () => {
        const pins = { [repo]: ["figs/a.png", "figs/b.png", "figsx.png", "main.tex"] };
        expect(pinsFor(unpinUnder(pins, repo, "figs"), repo)).toEqual(["figsx.png", "main.tex"]);
        expect(pinsFor(unpinUnder(pins, repo, "main.tex"), repo)).toHaveLength(3);
    });

    it("returns the same map when nothing was pinned there", () => {
        const pins = { [repo]: ["main.tex"] };
        expect(unpinUnder(pins, repo, "other.tex")).toBe(pins);
    });
});

describe("parsePins", () => {
    it("keeps only lists of non-empty strings", () => {
        expect(parsePins({ a: ["x", 3, ""], b: "nope", c: [] })).toEqual({ a: ["x"] });
        expect(parsePins(["x"])).toEqual({});
        expect(parsePins(null)).toEqual({});
    });
});

describe("pinsToMigrate", () => {
    const old = JSON.stringify({ [repo]: ["main.tex", "refs.bib", "build/main.pdf", "notes.md"] });

    it("moves the localStorage pins, in their order, into a workspace that has none", () => {
        expect(pinsToMigrate(undefined, old)).toEqual({
            [repo]: ["main.tex", "refs.bib", "build/main.pdf", "notes.md"],
        });
    });

    it("keeps the workspace's pins first and adds only the old ones it lacks", () => {
        const meta = { [repo]: ["notes.md"], "D:\\other": ["a.go"] };
        expect(pinsToMigrate(meta, old)).toEqual({
            [repo]: ["notes.md", "main.tex", "refs.bib", "build/main.pdf"],
            "D:\\other": ["a.go"],
        });
    });

    it("matches a project spelled another way instead of starting a second list", () => {
        const meta = { "c:/papers/thesis": ["main.tex"] };
        expect(pinsToMigrate(meta, JSON.stringify({ [repo]: ["main.tex", "x.md"] }))).toEqual({
            "c:/papers/thesis": ["main.tex", "x.md"],
        });
    });

    it("has nothing to write when there is no old key, it is empty or garbage, or the workspace holds it all", () => {
        expect(pinsToMigrate(undefined, null)).toBeNull();
        expect(pinsToMigrate(undefined, "{}")).toBeNull();
        expect(pinsToMigrate(undefined, "not json")).toBeNull();
        expect(pinsToMigrate(undefined, JSON.stringify({ [repo]: "main.tex" }))).toBeNull();
        expect(pinsToMigrate({ [repo]: ["main.tex"] }, JSON.stringify({ [repo]: ["main.tex"] }))).toBeNull();
    });
});
