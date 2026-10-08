// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { HISTORY_COLLAPSE_PX, resolveCollapsed, resolveSidebarFolded, SIDEBAR_FOLD_PX } from "./difflayout";

describe("resolveCollapsed", () => {
    it("collapses by default below the threshold — the shipped window is 1000px wide", () => {
        expect(resolveCollapsed(null, 1000)).toBe(true);
    });

    it("expands by default above the threshold", () => {
        expect(resolveCollapsed(null, 1600)).toBe(false);
    });

    it("treats the threshold itself as wide enough", () => {
        expect(resolveCollapsed(null, HISTORY_COLLAPSE_PX)).toBe(false);
    });

    // an explicit choice is a choice: resizing must not silently undo it
    it("lets an explicit expand win at a narrow width", () => {
        expect(resolveCollapsed(false, 900)).toBe(false);
    });

    it("lets an explicit collapse win at a wide width", () => {
        expect(resolveCollapsed(true, 1900)).toBe(true);
    });

    // width is 0 before the first ResizeObserver callback; collapsing then would flash the rail
    it("does not collapse on an unmeasured width", () => {
        expect(resolveCollapsed(null, 0)).toBe(false);
    });
});

describe("resolveSidebarFolded", () => {
    // about 920px: the shipped 1000px window less the nav
    it("folds by default below the threshold", () => {
        expect(resolveSidebarFolded(null, 920)).toBe(true);
    });

    it("stays open by default at and above the threshold", () => {
        expect(resolveSidebarFolded(null, SIDEBAR_FOLD_PX)).toBe(false);
        expect(resolveSidebarFolded(null, 1600)).toBe(false);
    });

    it("lets an explicit choice win at any width", () => {
        expect(resolveSidebarFolded(false, 900)).toBe(false);
        expect(resolveSidebarFolded(true, 1900)).toBe(true);
    });

    it("does not fold on an unmeasured width", () => {
        expect(resolveSidebarFolded(null, 0)).toBe(false);
    });
});
