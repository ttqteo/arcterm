// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { DEFAULT_HEADER_BUTTONS, headerButtonsOf, inHeader } from "./headerbuttons";

describe("headerButtonsOf", () => {
    it("takes the defaults for nothing stored or a bad value", () => {
        expect(headerButtonsOf(null)).toEqual(DEFAULT_HEADER_BUTTONS);
        expect(headerButtonsOf("yes")).toEqual(DEFAULT_HEADER_BUTTONS);
        expect(headerButtonsOf({ split: "on" })).toEqual(DEFAULT_HEADER_BUTTONS);
    });

    it("keeps what was stored and defaults the rest", () => {
        expect(headerButtonsOf({ split: true })).toEqual({ split: true, float: true, fullscreen: false });
        expect(headerButtonsOf({ float: false, fullscreen: true })).toEqual({
            split: false,
            float: false,
            fullscreen: true,
        });
    });

    it("puts Split and Fullscreen in More by default", () => {
        expect(DEFAULT_HEADER_BUTTONS).toEqual({ split: false, float: true, fullscreen: false });
    });
});

describe("inHeader", () => {
    const all = { split: true, float: true, fullscreen: true };

    it("follows the setting in a wide header", () => {
        expect(inHeader(all, "split", false)).toBe(true);
        expect(inHeader(DEFAULT_HEADER_BUTTONS, "split", false)).toBe(false);
        expect(inHeader(DEFAULT_HEADER_BUTTONS, "float", false)).toBe(true);
        expect(inHeader(DEFAULT_HEADER_BUTTONS, "fullscreen", false)).toBe(false);
    });

    it("folds every button into More in a narrow header, whatever the setting", () => {
        expect(inHeader(all, "split", true)).toBe(false);
        expect(inHeader(all, "float", true)).toBe(false);
        expect(inHeader(all, "fullscreen", true)).toBe(false);
    });
});
