// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { hideChoices, hideEndsInMs, jarvisHidden, typedHide } from "./pethide";

// Fri 13 Nov 2026, 14:00 local
const NOW = new Date(2026, 10, 13, 14, 0, 0, 0).getTime();
const HOUR = 3_600_000;

describe("jarvisHidden", () => {
    it("is shown when the setting is unset", () => {
        expect(jarvisHidden(undefined, NOW)).toBe(false);
        expect(jarvisHidden(null, NOW)).toBe(false);
    });
    it("is shown at 0", () => {
        expect(jarvisHidden(0, NOW)).toBe(false);
    });
    it("is shown once the time has passed, and at the very end", () => {
        expect(jarvisHidden(NOW - 1, NOW)).toBe(false);
        expect(jarvisHidden(NOW, NOW)).toBe(false);
    });
    it("is hidden while time is left", () => {
        expect(jarvisHidden(NOW + 1, NOW)).toBe(true);
        expect(jarvisHidden(NOW + HOUR, NOW)).toBe(true);
    });
    it("reads a value that is not a number as shown", () => {
        expect(jarvisHidden(String(NOW + HOUR), NOW)).toBe(false);
    });
});

describe("hideEndsInMs", () => {
    it("is null when nothing is hidden", () => {
        expect(hideEndsInMs(undefined, NOW)).toBeNull();
        expect(hideEndsInMs(0, NOW)).toBeNull();
        expect(hideEndsInMs(NOW - 5, NOW)).toBeNull();
    });
    it("is what is left of the hide", () => {
        expect(hideEndsInMs(NOW + HOUR, NOW)).toBe(HOUR);
    });
    it("caps a far end at setTimeout's longest wait", () => {
        expect(hideEndsInMs(NOW + 60 * 24 * HOUR, NOW)).toBe(2 ** 31 - 1);
    });
});

describe("hideChoices", () => {
    it("offers an hour and the next 8:00, built from now", () => {
        const choices = hideChoices(NOW);
        expect(choices.map((c) => c.label)).toEqual(["Hide for 1 hour", "Hide till 8:00"]);
        expect(choices[0].until).toBe(NOW + HOUR);
        expect(choices[1].until).toBe(new Date(2026, 10, 14, 8, 0, 0, 0).getTime());
    });
    it("waits for this morning's 8:00 before it", () => {
        const early = new Date(2026, 10, 13, 6, 30, 0, 0).getTime();
        expect(hideChoices(early)[1].until).toBe(new Date(2026, 10, 13, 8, 0, 0, 0).getTime());
    });
});

describe("typedHide", () => {
    it("reads a length", () => {
        expect(typedHide("2h", NOW)).toEqual({ until: NOW + 2 * HOUR, label: "16:00" });
        expect(typedHide("30m", NOW)?.until).toBe(NOW + 30 * 60_000);
        expect(typedHide("1h30", NOW)?.until).toBe(NOW + 90 * 60_000);
    });
    it("reads a clock time, the next one to come", () => {
        expect(typedHide("14:30", NOW)?.until).toBe(new Date(2026, 10, 13, 14, 30).getTime());
        expect(typedHide("8pm", NOW)?.until).toBe(new Date(2026, 10, 13, 20, 0).getTime());
        expect(typedHide("9:00", NOW)).toEqual({
            until: new Date(2026, 10, 14, 9, 0).getTime(),
            label: "9:00 tomorrow",
        });
    });
    it("refuses text that is no time, and more than 7 days", () => {
        expect(typedHide("", NOW)).toBeNull();
        expect(typedHide("soon", NOW)).toBeNull();
        expect(typedHide("200h", NOW)).toBeNull();
    });
});
