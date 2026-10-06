// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { landOutcome } from "./landrun";

describe("landOutcome", () => {
    it("reads a landed run as done, with its merge commit", () => {
        expect(landOutcome({ state: "landed", commit: "af6760b07d6b6c13" })).toEqual({
            failed: false,
            text: "Landed as af6760b0.",
        });
        expect(landOutcome({ state: "landed" })).toEqual({ failed: false, text: "Landed." });
    });

    it("reads a held land as a failure that names the reason", () => {
        expect(landOutcome({ state: "held", reason: "a merge is in progress" })).toEqual({
            failed: true,
            text: "Still held: a merge is in progress",
        });
        expect(landOutcome({ state: "held" }).text).toBe("Still held: the engine gave no reason");
    });

    it("never reads a missing or unfinished land as landed", () => {
        expect(landOutcome(null).failed).toBe(true);
        expect(landOutcome({ state: "pending" })).toEqual({ failed: true, text: "The land ended pending." });
    });
});
