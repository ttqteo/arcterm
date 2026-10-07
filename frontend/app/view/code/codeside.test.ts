// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
    clampSideRatio,
    defaultSideMode,
    effectiveSideMode,
    parseSideRatio,
    SIDE_HIDE_BELOW,
    SIDE_MIN_COLUMN,
    sideFits,
    sideModesFor,
} from "./codeside";

describe("sideModesFor", () => {
    it("offers the main column's modes without Diff", () => {
        expect(sideModesFor("main.tex", true)).toEqual(["preview", "source", "pdf"]);
        expect(sideModesFor("main.tex", false)).toEqual(["preview", "source"]);
        expect(sideModesFor("README.md", true)).toEqual(["preview", "source"]);
        expect(sideModesFor("main.go", true)).toEqual(["source"]);
    });
});

describe("defaultSideMode", () => {
    it("shows a .tex file's PDF when one is built, else its preview", () => {
        expect(defaultSideMode("main.tex", true)).toBe("pdf");
        expect(defaultSideMode("main.tex", false)).toBe("preview");
    });

    it("reads markdown as a document and anything else as source", () => {
        expect(defaultSideMode("README.md", false)).toBe("preview");
        expect(defaultSideMode("main.go", false)).toBe("source");
    });
});

describe("effectiveSideMode", () => {
    it("uses the default until a mode is chosen", () => {
        expect(effectiveSideMode("main.tex", "auto", true)).toBe("pdf");
    });

    it("keeps a chosen mode the file offers, else falls back like the main column", () => {
        expect(effectiveSideMode("main.tex", "source", true)).toBe("source");
        expect(effectiveSideMode("main.tex", "pdf", false)).toBe("preview");
        expect(effectiveSideMode("main.go", "preview", false)).toBe("source");
    });
});

describe("clampSideRatio", () => {
    it("keeps each column at least SIDE_MIN_COLUMN wide", () => {
        const width = 1200;
        expect(clampSideRatio(0.1, width)).toBeCloseTo(SIDE_MIN_COLUMN / width);
        expect(clampSideRatio(0.95, width)).toBeCloseTo(1 - SIDE_MIN_COLUMN / width);
        expect(clampSideRatio(0.6, width)).toBe(0.6);
    });

    it("splits evenly when there is no room for two minimum columns", () => {
        expect(clampSideRatio(0.8, 500)).toBe(0.5);
        expect(clampSideRatio(0.8, 0)).toBe(0.5);
    });
});

describe("parseSideRatio", () => {
    it("reads a stored ratio, defaulting to an even split", () => {
        expect(parseSideRatio("0.62")).toBe(0.62);
        expect(parseSideRatio(null)).toBe(0.5);
        expect(parseSideRatio("nope")).toBe(0.5);
        expect(parseSideRatio("3")).toBe(0.5);
    });
});

describe("sideFits", () => {
    it("hides the side column under SIDE_HIDE_BELOW of editor width", () => {
        expect(sideFits(SIDE_HIDE_BELOW)).toBe(true);
        expect(sideFits(SIDE_HIDE_BELOW - 1)).toBe(false);
    });
});

describe("a side file with nothing to preview", () => {
    it("opens on Source and offers no Preview", () => {
        expect(defaultSideMode("numbers.tex", false, false)).toBe("source");
        expect(effectiveSideMode("numbers.tex", "preview", false, false)).toBe("source");
        expect(sideModesFor("numbers.tex", false, false)).toEqual(["source"]);
    });

    it("still opens a built PDF first", () => {
        expect(defaultSideMode("numbers.tex", true, false)).toBe("pdf");
    });
});
