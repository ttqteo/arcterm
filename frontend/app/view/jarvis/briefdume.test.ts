// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { dumeLine } from "./briefdume";

const base: DumeStatusData = { enabled: true, waiting: 0, blocked: 0, done: 0 };

describe("dumeLine", () => {
    it("is absent when DUM-E is off or unread", () => {
        expect(dumeLine(null, false)).toBeNull();
        expect(dumeLine({ ...base, enabled: false }, false)).toBeNull();
        expect(dumeLine(base, false)).toBeNull(); // the setting is the switch
    });
    it("says it has not checked yet", () => {
        expect(dumeLine(base, true)).toBe("DUM-E · not checked yet");
    });
    it("names the chunk it works", () => {
        const s = { ...base, reason: "working", running: { effortoid: "e", effort: "Tidy", chunk: "Drop old flag" } };
        expect(dumeLine(s, true)).toBe("DUM-E · working: Drop old flag");
    });
    it("gives the reason and what waits to land", () => {
        const s = {
            ...base,
            reason: "2h10 to the 5h reset; starts within 1h00",
            toland: [{ effortoid: "e", effort: "T", chunk: "c" }],
        };
        expect(dumeLine(s, true)).toBe("DUM-E · 2h10 to the 5h reset; starts within 1h00 · 1 to land");
    });
});
