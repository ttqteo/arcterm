// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
    coerceFontSize,
    coerceScrollback,
    coerceStartupSurface,
    coerceTransparency,
    startupSurfaceOptions,
    vaultPathError,
} from "./cockpitprefsstore";

describe("startupSurfaceOptions", () => {
    it("returns the workflow surfaces without the agent surface", () => {
        const opts = startupSurfaceOptions();
        expect(opts).not.toContain("agent");
        expect(opts).not.toContain("settings");
        expect(opts).toContain("cockpit");
        expect(opts).toContain("usage");
    });
});

describe("coerceFontSize", () => {
    it("parses a valid integer", () => {
        expect(coerceFontSize("14")).toBe(14);
    });
    it("clamps below the minimum", () => {
        expect(coerceFontSize("2")).toBe(6);
    });
    it("clamps above the maximum", () => {
        expect(coerceFontSize("999")).toBe(48);
    });
    it("floors a decimal", () => {
        expect(coerceFontSize("13.7")).toBe(13);
    });
    it("rejects non-numeric input", () => {
        expect(coerceFontSize("abc")).toBeNull();
    });
    it("rejects empty input", () => {
        expect(coerceFontSize("")).toBeNull();
    });
});

describe("coerceScrollback", () => {
    it("parses a valid integer", () => expect(coerceScrollback("5000")).toBe(5000));
    it("clamps below zero", () => expect(coerceScrollback("-10")).toBe(0));
    it("clamps above the max", () => expect(coerceScrollback("999999")).toBe(100000));
    it("floors a decimal", () => expect(coerceScrollback("100.9")).toBe(100));
    it("rejects non-numeric", () => expect(coerceScrollback("abc")).toBeNull());
    it("rejects empty", () => expect(coerceScrollback("")).toBeNull());
});

describe("coerceTransparency", () => {
    it("passes a mid value", () => expect(coerceTransparency(0.5)).toBe(0.5));
    it("clamps above 1", () => expect(coerceTransparency(1.5)).toBe(1));
    it("clamps below 0", () => expect(coerceTransparency(-0.2)).toBe(0));
    it("coerces NaN to 0", () => expect(coerceTransparency(Number.NaN)).toBe(0));
});

describe("vaultPathError", () => {
    it("accepts an existing directory", () => expect(vaultPathError({ isdir: true })).toBeNull());
    it("rejects a missing path", () => expect(vaultPathError({ notfound: true })).toBe("Folder not found"));
    it("rejects a file (not a directory)", () => expect(vaultPathError({ isdir: false })).toBe("Not a folder"));
    it("rejects when isdir is absent", () => expect(vaultPathError({})).toBe("Not a folder"));
});

describe("coerceStartupSurface", () => {
    it("sends a stored sessions or activity startup surface to the Agent surface", () => {
        expect(coerceStartupSurface("sessions")).toBe("agent");
        expect(coerceStartupSurface("activity")).toBe("agent");
    });
    it("leaves a current surface alone", () => {
        expect(coerceStartupSurface("radar")).toBe("radar");
        expect(coerceStartupSurface("cockpit")).toBe("cockpit");
    });
});
