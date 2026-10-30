// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { patchStarting, startingMeta, startingTitle, type StartingRun } from "./startingrunsmodel";

const row = (over: Partial<StartingRun> = {}): StartingRun => ({
    id: "s-1",
    project: "arcterm",
    title: "Build it",
    ts: 1_000,
    state: "starting",
    ...over,
});

describe("startingTitle", () => {
    it("names a goal start by its first line", () => {
        expect(startingTitle("\n  Build the rail\nwith details", "")).toBe("Build the rail");
    });

    it("names a plan start by the plan file", () => {
        expect(startingTitle("", "D:\\repo\\docs\\plans\\2026-10-29-rail.md")).toBe("2026-10-29-rail.md");
    });

    it("falls back to Run for an empty goal", () => {
        expect(startingTitle("   ", "")).toBe("Run");
    });
});

describe("startingMeta", () => {
    it("reads a start's age", () => {
        expect(startingMeta(row(), 1_000 + 30_000)).toBe("Starting · <1m");
        expect(startingMeta(row(), 1_000 + 3 * 60_000)).toBe("Starting · 3m");
    });

    it("reads a cancel in flight and a failure with its reason", () => {
        expect(startingMeta(row({ state: "cancelling" }), 0)).toBe("Cancelling…");
        expect(startingMeta(row({ state: "failed", error: "Error: no route" }), 0)).toBe("Failed · Error: no route");
        expect(startingMeta(row({ state: "failed" }), 0)).toBe("Failed");
    });
});

describe("patchStarting", () => {
    it("changes the one row and leaves the list as it was for an unknown id", () => {
        const list = [row(), row({ id: "s-2" })];
        expect(patchStarting(list, "s-2", { state: "failed" }).map((r) => r.state)).toEqual(["starting", "failed"]);
        expect(patchStarting(list, "nope", { state: "failed" })).toEqual(list);
    });
});
