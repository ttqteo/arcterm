// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { clockShouldRun, OfficeMeter } from "./officeclock";

describe("officeclock", () => {
    it("runs a clock only when something needs it, it is on, the window shows, and motion is allowed", () => {
        const on = { need: true, on: true, hidden: false, reduced: false };
        expect(clockShouldRun(on)).toBe(true);
        expect(clockShouldRun({ ...on, need: false })).toBe(false);
        expect(clockShouldRun({ ...on, on: false })).toBe(false);
        expect(clockShouldRun({ ...on, hidden: true })).toBe(false);
        expect(clockShouldRun({ ...on, reduced: true })).toBe(false);
    });

    it("shares the office's JS time over the last ten seconds, as a percent of one core", () => {
        const m = new OfficeMeter();
        m.record(1_000, 30);
        m.record(5_000, 20);
        expect(m.share(10_000)).toBe(0.5);
        expect(m.share(12_000)).toBe(0.2);
        expect(m.share(30_000)).toBe(0);
    });
});
