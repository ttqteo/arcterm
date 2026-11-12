// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { resolveUsageCursor, usageBackStep, usageNavIds } from "./usagenav";

describe("usageBackStep", () => {
    it("goes from an item back to the scope it was opened from", () => {
        expect(usageBackStep("work", "C:/work/arc", { key: "run:r1", back: "all" })).toEqual({
            scope: "all",
            item: null,
        });
        expect(usageBackStep("work", "all", { key: "session:claude:s1", back: "C:/work/arc" })).toEqual({
            scope: "C:/work/arc",
            item: null,
        });
    });

    it("goes from a project or initiative scope to All usage", () => {
        expect(usageBackStep("work", "C:/work/arc", null)).toEqual({ scope: "all", item: null });
        expect(usageBackStep("work", "effort:e1", null)).toEqual({ scope: "all", item: null });
    });

    it("has no step on All usage, so Escape leaves the surface", () => {
        expect(usageBackStep("work", "all", null)).toBeNull();
    });

    it("has no step outside By work, whatever its atoms hold", () => {
        expect(usageBackStep("provider", "C:/work/arc", { key: "run:r1", back: "all" })).toBeNull();
        expect(usageBackStep("workflow", "C:/work/arc", null)).toBeNull();
    });
});

describe("usageNavIds", () => {
    it("walks the scope cards, then the shown rows, in one order", () => {
        expect(usageNavIds(["all", "C:/a", "effort:e"], ["run:r1", "session:claude:s1"])).toEqual([
            "all",
            "C:/a",
            "effort:e",
            "run:r1",
            "session:claude:s1",
        ]);
    });

    it("is just the scopes when no row shows", () => {
        expect(usageNavIds(["all"], [])).toEqual(["all"]);
    });
});

describe("resolveUsageCursor", () => {
    const scopes = ["all", "C:/a", "effort:e"];

    it("names a scope card", () => {
        expect(resolveUsageCursor("C:/a", scopes)).toEqual({ kind: "scope", id: "C:/a" });
        expect(resolveUsageCursor("effort:e", scopes)).toEqual({ kind: "scope", id: "effort:e" });
    });

    it("names a row for anything that is not a scope", () => {
        expect(resolveUsageCursor("run:r1", scopes)).toEqual({ kind: "row", id: "run:r1" });
    });
});
