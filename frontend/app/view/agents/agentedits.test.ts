// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { editsApply } from "./agentedits";

describe("editsApply", () => {
    it("is true for a claude agent, named or absent", () => {
        expect(editsApply(undefined)).toBe(true);
        expect(editsApply("")).toBe(true);
        expect(editsApply("claude")).toBe(true);
    });

    it("is false for every other runtime", () => {
        for (const runtime of ["pi", "codex", "agy", "opencode", "terminal"]) {
            expect(editsApply(runtime), runtime).toBe(false);
        }
    });
});
