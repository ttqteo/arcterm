// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { contextLabel, contextWarn, footerParts, modeLabel } from "./chatfootermodel";

describe("modeLabel", () => {
    it("names every mode the footer can read", () => {
        expect(modeLabel("default")).toBe("Default");
        expect(modeLabel("acceptEdits")).toBe("Accept edits");
        expect(modeLabel("plan")).toBe("Plan");
        expect(modeLabel("bypassPermissions")).toBe("Bypass permissions");
        expect(modeLabel("auto")).toBe("Auto");
    });
});

describe("contextLabel", () => {
    it("rounds the percentage", () => {
        expect(contextLabel(42.6)).toBe("ctx 43%");
        expect(contextLabel(0)).toBe("ctx 0%");
    });
    it("is null when no usage is known", () => {
        expect(contextLabel(undefined)).toBeNull();
        expect(contextLabel(Number.NaN)).toBeNull();
    });
});

describe("contextWarn", () => {
    it("warns from 80%", () => {
        expect(contextWarn(80)).toBe(true);
        expect(contextWarn(95)).toBe(true);
        expect(contextWarn(79.4)).toBe(false);
        expect(contextWarn(undefined)).toBe(false);
    });
});

describe("footerParts", () => {
    it("keeps the parts that exist, in order", () => {
        expect(footerParts("opus 5.5", 42.6)).toEqual([
            { text: "opus 5.5", warn: false },
            { text: "ctx 43%", warn: false },
        ]);
        expect(footerParts(undefined, 42.6)).toEqual([{ text: "ctx 43%", warn: false }]);
        expect(footerParts("opus 5.5", undefined)).toEqual([{ text: "opus 5.5", warn: false }]);
        expect(footerParts("", undefined)).toEqual([]);
    });
    it("marks a full context", () => {
        expect(footerParts("opus 5.5", 85)[1]).toEqual({ text: "ctx 85%", warn: true });
    });
});
