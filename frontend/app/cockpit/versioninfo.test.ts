// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { deriveVersionInfo, formatBuildTime, UNKNOWN_VERSION } from "./versioninfo";

describe("deriveVersionInfo", () => {
    it("agrees when the shell and the backend were built from the same version", () => {
        const info = deriveVersionInfo("0.14.5", "0.14.5", 202609081530, "win32");
        expect(info.mismatch).toBe(false);
        expect(info.app).toBe("0.14.5");
        expect(info.server).toBe("0.14.5");
    });

    it("ignores a v prefix on either side", () => {
        expect(deriveVersionInfo("v0.14.5", "0.14.5", 0, "win32").mismatch).toBe(false);
        expect(deriveVersionInfo("0.14.5", "V0.14.5", 0, "win32").mismatch).toBe(false);
    });

    it("flags a stale backend", () => {
        const info = deriveVersionInfo("0.14.6", "0.14.5", 0, "win32");
        expect(info.mismatch).toBe(true);
        expect(info.app).toBe("0.14.6");
        expect(info.server).toBe("0.14.5");
    });

    it("treats prerelease identifiers as part of the version", () => {
        expect(deriveVersionInfo("0.14.5-beta.1", "0.14.5", 0, "win32").mismatch).toBe(true);
    });

    it("does not claim a mismatch when the backend never reported", () => {
        const info = deriveVersionInfo("0.14.5", "", 0, "win32");
        expect(info.mismatch).toBe(false);
        expect(info.server).toBe(UNKNOWN_VERSION);
    });

    it("does not claim a mismatch when the shell version is missing", () => {
        expect(deriveVersionInfo("", "0.14.5", 0, "win32").mismatch).toBe(false);
    });

    it("keeps a positive build time and zeroes one that is negative or infinite", () => {
        expect(deriveVersionInfo("0.14.5", "0.14.5", 202609081530, "win32").buildTime).toBe(202609081530);
        expect(deriveVersionInfo("0.14.5", "0.14.5", -5, "win32").buildTime).toBe(0);
        expect(deriveVersionInfo("0.14.5", "0.14.5", Infinity, "win32").buildTime).toBe(0);
    });

    it("normalizes a missing platform and a non-finite build time", () => {
        const info = deriveVersionInfo("0.14.5", "0.14.5", Number.NaN, "");
        expect(info.platform).toBe(UNKNOWN_VERSION);
        expect(info.buildTime).toBe(0);
    });
});

describe("formatBuildTime", () => {
    it("formats the %Y%m%d%H%M stamp the Taskfile writes", () => {
        expect(formatBuildTime(202609081530)).toBe("2026-09-08 15:30");
    });

    it("falls back to the raw value when the stamp is not 12 digits", () => {
        expect(formatBuildTime(1719240000)).toBe("1719240000");
    });

    it("reports unknown for an unstamped build", () => {
        expect(formatBuildTime(0)).toBe(UNKNOWN_VERSION);
    });
});
