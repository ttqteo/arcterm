// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { afterEach, describe, expect, it } from "vitest";
import { officeSink, officeSoundLog, pulseHarmonics, setOfficeSoundLog } from "./officeaudio";

describe("officeaudio", () => {
    afterEach(() => setOfficeSoundLog(false));

    it("draws a pulse wave's harmonics from its duty", () => {
        const half = pulseHarmonics(0.5, 4);
        expect(half.length).toBe(5);
        expect(half[0]).toBe(0);
        expect(half[1]).toBeCloseTo(2 / Math.PI, 5);
        expect(half[2]).toBeCloseTo(0, 5);
    });

    it("logs what it would play while the DEV log is on", () => {
        setOfficeSoundLog(true);
        officeSink().play("taskDone");
        officeSink().music("day");
        officeSink().music(null);
        expect(officeSoundLog()).toEqual(["taskDone", "music:day", "music:off"]);
        setOfficeSoundLog(false);
        expect(officeSoundLog()).toBeNull();
    });
});
