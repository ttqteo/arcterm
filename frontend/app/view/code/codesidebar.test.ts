// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
    CODE_SIDEBAR_DEFAULT_WIDTH,
    CODE_SIDEBAR_EDITOR_FLOOR,
    CODE_SIDEBAR_MAX_WIDTH,
    CODE_SIDEBAR_MIN_WIDTH,
    codeSidebarDragEndWidth,
    codeSidebarDragWidthForWorkspace,
    codeSidebarMaxWidth,
    codeSidebarPrefsJson,
    codeSidebarVisibility,
    codeSidebarWidthAfterPointer,
    codeSidebarWidthFor,
    defaultCodeSidebarPrefs,
    nextCodeSidebarWidth,
    parseCodeSidebarPrefs,
} from "./codesidebar";

describe("Code sidebar preferences", () => {
    it("uses defaults for malformed or invalid persisted state", () => {
        expect(parseCodeSidebarPrefs("not json")).toEqual(defaultCodeSidebarPrefs());
        expect(parseCodeSidebarPrefs(JSON.stringify({ width: "380", open: "no" }))).toEqual(defaultCodeSidebarPrefs());
        expect(parseCodeSidebarPrefs(JSON.stringify({ width: 900, open: false }))).toEqual({ width: 480, open: false });
    });

    it("carries the Files width over from per-mode prefs", () => {
        expect(
            parseCodeSidebarPrefs(JSON.stringify({ widths: { files: 240, search: 410, changed: 360 }, open: true }))
        ).toEqual({ width: 240, open: true });
        expect(parseCodeSidebarPrefs(JSON.stringify({ widths: { search: 410 } }))).toEqual(defaultCodeSidebarPrefs());
    });

    it("round-trips the shared width and collapse preference", () => {
        const prefs = { width: 312, open: false };
        expect(parseCodeSidebarPrefs(codeSidebarPrefsJson(prefs))).toEqual(prefs);
        expect(CODE_SIDEBAR_DEFAULT_WIDTH).toBe(280);
    });
});

describe("Code sidebar geometry", () => {
    it("keeps the editor floor in the effective max", () => {
        expect(codeSidebarMaxWidth(1200)).toBe(CODE_SIDEBAR_MAX_WIDTH);
        expect(codeSidebarMaxWidth(700)).toBe(412);
        expect(codeSidebarMaxWidth(400)).toBe(CODE_SIDEBAR_MIN_WIDTH);
        expect(codeSidebarMaxWidth(0)).toBe(CODE_SIDEBAR_MAX_WIDTH);
        expect(CODE_SIDEBAR_EDITOR_FLOOR).toBe(280);
    });

    it("clamps the stored width to the workspace", () => {
        expect(codeSidebarWidthFor(220, 900)).toBe(220);
        expect(codeSidebarWidthFor(470, 700)).toBe(412);
        expect(codeSidebarWidthFor(380, 1600)).toBe(380);
    });

    it("clamps a provisional drag width when the workspace narrows", () => {
        expect(codeSidebarDragWidthForWorkspace(480, 700)).toBe(412);
        expect(codeSidebarDragWidthForWorkspace(260, 488)).toBe(200);
    });

    it("returns a width only for completed drags", () => {
        expect(codeSidebarDragEndWidth(360, 700, true)).toBe(360);
        expect(codeSidebarDragEndWidth(360, 700, false)).toBeNull();
    });

    it("clamps pointer movement at both bounds", () => {
        expect(codeSidebarWidthAfterPointer(280, 40, 480)).toBe(320);
        expect(codeSidebarWidthAfterPointer(220, -40, 480)).toBe(200);
        expect(codeSidebarWidthAfterPointer(470, 40, 480)).toBe(480);
        expect(codeSidebarWidthAfterPointer(450, 40, 420)).toBe(420);
    });

    it("handles keyboard steps and hard bounds", () => {
        expect(nextCodeSidebarWidth(280, "ArrowRight", false, 480)).toBe(296);
        expect(nextCodeSidebarWidth(280, "ArrowLeft", true, 480)).toBe(240);
        expect(nextCodeSidebarWidth(470, "ArrowRight", false, 480)).toBe(480);
        expect(nextCodeSidebarWidth(208, "ArrowLeft", false, 480)).toBe(200);
        expect(nextCodeSidebarWidth(300, "Home", false, 480)).toBe(200);
        expect(nextCodeSidebarWidth(300, "End", false, 420)).toBe(420);
    });

    it("temporarily compacts below the sidebar and editor minimum", () => {
        expect(codeSidebarVisibility(700, true)).toEqual({ temporary: false, compact: false });
        expect(codeSidebarVisibility(487, true)).toEqual({ temporary: true, compact: true });
        expect(codeSidebarVisibility(487, false)).toEqual({ temporary: true, compact: true });
        expect(codeSidebarVisibility(488, true)).toEqual({ temporary: false, compact: false });
        expect(codeSidebarVisibility(760, false)).toEqual({ temporary: false, compact: true });
        expect(codeSidebarVisibility(0, true)).toEqual({ temporary: false, compact: false });
    });
});
