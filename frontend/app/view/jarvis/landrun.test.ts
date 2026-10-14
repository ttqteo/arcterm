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

    // the server queues a land whose project has another in its turn, and a conflict goes to a resolver: neither
    // failed, and neither is landed, so each says what happens next instead of "The land ended queued."
    it("reads a land in line or being resolved as under way, not failed and not landed", () => {
        expect(landOutcome({ state: "queued", queuedts: 20 })).toEqual({
            failed: false,
            pending: true,
            text: "In line to land. It lands by itself when its turn comes.",
        });
        expect(landOutcome({ state: "resolving", conflicts: ["CHANGELOG.md", "docs/open-issues.md"] })).toEqual({
            failed: false,
            pending: true,
            text: "A resolver is merging the base in (CHANGELOG.md, docs/open-issues.md). It lands by itself once that is done.",
        });
        expect(landOutcome({ state: "resolving" }).text).toBe(
            "A resolver is merging the base in. It lands by itself once that is done."
        );
    });

    it("marks only a land still to come as pending", () => {
        expect(landOutcome({ state: "landed" }).pending).toBeUndefined();
        expect(landOutcome({ state: "held" }).pending).toBeUndefined();
    });
});
