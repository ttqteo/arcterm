// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
    ASSEMBLE_DONE_S,
    ASSEMBLE_PARTS,
    assembleReveal,
    easeMix,
    HOLOGRAM_IDLE_FPS,
    HOLOGRAM_LIVE_FPS,
    HOLOGRAM_SIZE_PX,
    hologramFps,
    hologramPose,
    hologramSize,
    petForm,
    stepMix,
} from "./hologrammodel";

const calm = { asking: 0, working: 0, speaking: false, peekOpen: false };

describe("petForm", () => {
    it("keeps the two choices and turns anything else into Sprout", () => {
        expect(petForm("hologram")).toBe("hologram");
        expect(petForm("sprout")).toBe("sprout");
        expect(petForm("orb")).toBe("sprout");
        expect(petForm(undefined)).toBe("sprout");
    });
});

describe("hologramSize", () => {
    it("keeps S, M and L, smallest first, and turns anything else into L", () => {
        expect(hologramSize("s")).toBe("s");
        expect(hologramSize("m")).toBe("m");
        expect(hologramSize("l")).toBe("l");
        expect(hologramSize("xl")).toBe("l");
        expect(hologramSize(undefined)).toBe("l");
        expect(HOLOGRAM_SIZE_PX.s).toBeLessThan(HOLOGRAM_SIZE_PX.m);
        expect(HOLOGRAM_SIZE_PX.m).toBeLessThan(HOLOGRAM_SIZE_PX.l);
        expect(HOLOGRAM_SIZE_PX.l).toBe(132);
    });
});

describe("hologramPose", () => {
    it("is the quiet HUD when nothing runs and nothing waits", () => {
        expect(hologramPose(calm)).toEqual({ sphere: 0, busy: false, quiet: true });
    });

    it("turns to the neural sphere while an agent asks you something", () => {
        expect(hologramPose({ ...calm, asking: 1 })).toEqual({ sphere: 1, busy: false, quiet: false });
    });

    it("beats the HUD's core while agents work or Jarvis speaks, without leaving the HUD", () => {
        expect(hologramPose({ ...calm, working: 2 })).toEqual({ sphere: 0, busy: true, quiet: false });
        expect(hologramPose({ ...calm, speaking: true })).toEqual({ sphere: 0, busy: true, quiet: false });
    });

    it("a question outranks work: the sphere shows, and the core still counts as busy", () => {
        expect(hologramPose({ ...calm, asking: 1, working: 3 })).toEqual({ sphere: 1, busy: true, quiet: false });
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
        expect(hologramFps(hologramPose({ ...calm, asking: 1 }), 1)).toBe(HOLOGRAM_LIVE_FPS);
    });
});

describe("assembleReveal", () => {
    it("shows nothing at the start and every part in place once the HUD is whole", () => {
        for (let part = 0; part < ASSEMBLE_PARTS; part++) {
            expect(assembleReveal(0, part)).toBe(0);
            expect(assembleReveal(ASSEMBLE_DONE_S, part)).toBe(1);
            expect(assembleReveal(60, part)).toBe(1);
        }
    });

    it("lights the core first, then the rings from the inside out", () => {
        const t = 0.5;
        const reveals = Array.from({ length: ASSEMBLE_PARTS }, (_, part) => assembleReveal(t, part));
        for (let part = 1; part < ASSEMBLE_PARTS; part++) {
            expect(reveals[part]).toBeLessThanOrEqual(reveals[part - 1]);
        }
        expect(reveals[0]).toBeGreaterThan(0);
        expect(reveals[ASSEMBLE_PARTS - 1]).toBe(0);
    });

    it("eases out: past half its time a part is more than half in", () => {
        const half = assembleReveal(0.1 + 0.25, 0);
        expect(half).toBeGreaterThan(0.5);
        expect(half).toBeLessThan(1);
    });

    it("reads a clock that is not a number as not started", () => {
        expect(assembleReveal(Number.NaN, 0)).toBe(0);
    });
});
