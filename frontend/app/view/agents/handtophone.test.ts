// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { canHandToPhone, isHandedOver } from "./handtophone";

const claude = { kind: undefined, blockId: "blk-1", agent: "claude" } as const;

describe("canHandToPhone", () => {
    it("allows a plain claude, a plain pi and a lead", () => {
        expect(canHandToPhone(claude, null)).toBe(true);
        expect(canHandToPhone({ ...claude, kind: "agent" }, undefined)).toBe(true);
        expect(canHandToPhone({ ...claude, agent: "pi" }, null)).toBe(true);
        expect(canHandToPhone(claude, { kind: "lead", runId: "r1" })).toBe(true);
    });

    it("refuses a run's worker and stage sessions", () => {
        expect(canHandToPhone(claude, { kind: "worker", leadRunId: "r1", taskId: "t-1" })).toBe(false);
        expect(canHandToPhone(claude, { kind: "stage", leadRunId: "r1", stageRole: "final" })).toBe(false);
    });

    it("refuses a terminal, a background agent, no block and codex", () => {
        expect(canHandToPhone({ ...claude, kind: "terminal" }, null)).toBe(false);
        expect(canHandToPhone({ ...claude, kind: "background" }, null)).toBe(false);
        expect(canHandToPhone({ ...claude, blockId: undefined }, null)).toBe(false);
        expect(canHandToPhone({ ...claude, agent: "codex" }, null)).toBe(false);
    });
});

describe("isHandedOver", () => {
    const status: RemoteStatusData = { on: true, tunnel: "up", subscriptions: 0 };

    it("is false with no status or no handed list", () => {
        expect(isHandedOver(null, "tab-1")).toBe(false);
        expect(isHandedOver(status, "tab-1")).toBe(false);
    });

    it("is true only for a tab in the handed list", () => {
        const handed = { ...status, handed: ["tab-1", "tab-2"] };
        expect(isHandedOver(handed, "tab-1")).toBe(true);
        expect(isHandedOver(handed, "tab-3")).toBe(false);
    });
});
