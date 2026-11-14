// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
    ASSEMBLE_DONE_S,
    ASSEMBLE_PARTS,
    assembleReveal,
    DEFAULT_PET_FORM,
    easeMix,
    HOLOGRAM_FAIL_WINDOW_MS,
    HOLOGRAM_IDLE_FPS,
    HOLOGRAM_LIVE_FPS,
    HOLOGRAM_SIZE_PX,
    hologramFps,
    hologramPose,
    hologramRetry,
    hologramSize,
    morphPose,
    petForm,
    stepMix,
} from "./hologrammodel";

const calm = { asking: 0, working: 0, speaking: false, peekOpen: false };

describe("petForm", () => {
    it("keeps the two choices and turns anything else into the hologram, the default", () => {
        expect(DEFAULT_PET_FORM).toBe("hologram");
        expect(petForm("hologram")).toBe("hologram");
        expect(petForm("sprout")).toBe("sprout");
        expect(petForm("orb")).toBe("hologram");
        expect(petForm(undefined)).toBe("hologram");
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
        expect(hologramPose(calm)).toEqual({ sphere: 0, busy: false, activity: 0, speaking: false, quiet: true });
    });

    it("turns to the neural sphere while an agent asks you something", () => {
        expect(hologramPose({ ...calm, asking: 1 })).toMatchObject({ sphere: 1, busy: false, quiet: true });
    });

    it("sets the HUD to work while agents work or Jarvis speaks, without leaving the HUD", () => {
        const working = hologramPose({ ...calm, working: 2 });
        expect(working).toMatchObject({ sphere: 0, busy: true, speaking: false, quiet: true });
        expect(working.activity).toBeGreaterThan(0);
        expect(working.activity).toBeLessThan(1);
        expect(hologramPose({ ...calm, speaking: true })).toEqual({
            sphere: 0,
            busy: true,
            activity: 0,
            speaking: true,
            quiet: true,
        });
    });

    it("a question outranks work: the sphere shows, and the form still counts as busy", () => {
        expect(hologramPose({ ...calm, asking: 1, working: 3 })).toMatchObject({ sphere: 1, busy: true, quiet: true });
    });

    it("stays faint while agents work or ask, and is solid only while the peek is open", () => {
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

describe("hologramRetry", () => {
    it("tries the hologram again after a first and a second loss", () => {
        const one = hologramRetry([], 1_000);
        expect(one).toEqual({ fails: [1_000], retry: true });
        const two = hologramRetry(one.fails, 10_000);
        expect(two).toEqual({ fails: [1_000, 10_000], retry: true });
    });
    it("stops on the third loss inside the window, so a failing GPU cannot loop", () => {
        expect(hologramRetry([1_000, 10_000], 20_000)).toEqual({ fails: [1_000, 10_000, 20_000], retry: false });
    });
    it("forgets losses older than the window, so a loss now and then always comes back", () => {
        const now = 5_000 + HOLOGRAM_FAIL_WINDOW_MS;
        expect(hologramRetry([1_000, 5_000], now)).toEqual({ fails: [now], retry: true });
    });
});

describe("morphPose", () => {
    it("rests at either end: the HUD whole at 0, the sphere whole at 1, no flare", () => {
        expect(morphPose(0)).toEqual({ hudScale: 1, hudTwist: 0, sphereScale: 0.38, flare: 1 });
        const end = morphPose(1);
        expect(end.hudScale).toBeCloseTo(0.38);
        expect(end.sphereScale).toBeCloseTo(1);
        expect(end.flare).toBeCloseTo(1);
    });

    it("flares and overshoots at the crossing", () => {
        const mid = morphPose(0.5);
        expect(mid.flare).toBeCloseTo(3.4);
        expect(mid.sphereScale).toBeGreaterThan(0.38 + 0.62 * 0.5);
        expect(mid.hudScale).toBeCloseTo(0.69);
    });

    it("clamps a mix outside 0..1", () => {
        expect(morphPose(-1)).toEqual(morphPose(0));
        expect(morphPose(2)).toEqual(morphPose(1));
    });
});
