// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { harnessRowState, rowLabel, shortVersion } from "./harnessupdatemodel";

const claude = (over: Partial<HarnessInfo> = {}): HarnessInfo =>
    ({
        runtime: "claude",
        label: "Claude Code",
        installed: true,
        version: "2.1.292 (Claude Code)",
        ...over,
    }) as HarnessInfo;

describe("shortVersion", () => {
    it("keeps the x.y.z", () => {
        expect(shortVersion("2.1.292 (Claude Code)")).toBe("2.1.292");
        expect(shortVersion("weird")).toBe("weird");
    });
});

describe("harnessRowState", () => {
    it("is null for a harness that is not installed", () => {
        expect(harnessRowState(claude({ installed: false }), undefined)).toBeNull();
    });
    it("is current with no newer release, available with one", () => {
        expect(harnessRowState(claude(), undefined)).toEqual({ kind: "current", version: "2.1.292" });
        expect(harnessRowState(claude({ latestversion: "2.1.292" }), undefined)).toEqual({
            kind: "current",
            version: "2.1.292",
        });
        expect(harnessRowState(claude({ latestversion: "2.1.300" }), undefined)).toEqual({
            kind: "available",
            version: "2.1.292",
            latest: "2.1.300",
        });
    });
    it("follows a run: updating, then updated or failed", () => {
        const h = claude({ latestversion: "2.1.300" });
        expect(harnessRowState(h, { status: "running" }).kind).toBe("updating");
        expect(harnessRowState(h, { status: "done", version: "2.1.300" })).toEqual({
            kind: "updated",
            version: "2.1.300",
        });
        expect(harnessRowState(h, { status: "failed", error: "EACCES" })).toEqual({
            kind: "failed",
            version: "2.1.292",
            latest: "2.1.300",
            error: "EACCES",
        });
    });
});

describe("rowLabel", () => {
    it("says what the row is doing", () => {
        expect(rowLabel({ kind: "available", version: "2.1.292", latest: "2.1.300" })).toBe("2.1.300 available");
        expect(rowLabel({ kind: "updating", version: "2.1.292", latest: "2.1.300" })).toBe("Updating…");
        expect(rowLabel({ kind: "updated", version: "2.1.300" })).toBe("Updated to 2.1.300 · new sessions use it");
    });
});
