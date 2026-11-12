// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
    easeMix,
    HOLOGRAM_IDLE_FPS,
    HOLOGRAM_LIVE_FPS,
    hologramFps,
    hologramPose,
    petForm,
    stepMix,
} from "./hologrammodel";

const calm = { waiting: 0, working: 0, speaking: false, peekOpen: false };

describe("petForm", () => {
    it("keeps the two choices and turns anything else into Sprout", () => {
        expect(petForm("hologram")).toBe("hologram");
        expect(petForm("sprout")).toBe("sprout");
        expect(petForm("orb")).toBe("sprout");
        expect(petForm(undefined)).toBe("sprout");
    });
});

describe("hologramPose", () => {
    it("is the quiet HUD when nothing runs and nothing waits", () => {
        expect(hologramPose(calm)).toEqual({ sphere: 0, busy: false, quiet: true });
    });

    it("turns to the neural sphere while something waits on you", () => {
        expect(hologramPose({ ...calm, waiting: 1 })).toEqual({ sphere: 1, busy: false, quiet: false });
    });

    it("beats the HUD's core while agents work or Jarvis speaks, without leaving the HUD", () => {
        expect(hologramPose({ ...calm, working: 2 })).toEqual({ sphere: 0, busy: true, quiet: false });
        expect(hologramPose({ ...calm, speaking: true })).toEqual({ sphere: 0, busy: true, quiet: false });
    });

    it("a question outranks work: the sphere shows, and the core still counts as busy", () => {
        expect(hologramPose({ ...calm, waiting: 1, working: 3 })).toEqual({ sphere: 1, busy: true, quiet: false });
    });

    it("is not faint while the peek is open", () => {
        expect(hologramPose({ ...calm, peekOpen: true }).quiet).toBe(false);
    });
});

describe("stepMix", () => {
    it("moves toward the target by the elapsed share of the fade", () => {
        expect(stepMix(0, 1, 350, 700)).toBeCloseTo(0.5);
        expect(stepMix(1, 0, 175, 700)).toBeCloseTo(0.75);
    });

    it("never passes the target", () => {
        expect(stepMix(0.9, 1, 700, 700)).toBe(1);
        expect(stepMix(0.1, 0, 700, 700)).toBe(0);
        expect(stepMix(1, 1, 50)).toBe(1);
    });

    it("ignores a negative step and jumps when there is no fade", () => {
        expect(stepMix(0.3, 1, -20, 700)).toBe(0.3);
        expect(stepMix(0, 1, 0, 0)).toBe(1);
    });
});

describe("easeMix", () => {
    it("holds the ends and the middle and clamps outside them", () => {
        expect(easeMix(0)).toBe(0);
        expect(easeMix(1)).toBe(1);
        expect(easeMix(0.5)).toBeCloseTo(0.5);
        expect(easeMix(-1)).toBe(0);
        expect(easeMix(2)).toBe(1);
    });
});

describe("hologramFps", () => {
    it("draws slowly only for a settled, calm HUD", () => {
        const pose = hologramPose(calm);
        expect(hologramFps(pose, 0)).toBe(HOLOGRAM_IDLE_FPS);
        expect(hologramFps(pose, 0.4)).toBe(HOLOGRAM_LIVE_FPS);
        expect(hologramFps(hologramPose({ ...calm, working: 1 }), 0)).toBe(HOLOGRAM_LIVE_FPS);
        expect(hologramFps(hologramPose({ ...calm, waiting: 1 }), 1)).toBe(HOLOGRAM_LIVE_FPS);
    });
});
