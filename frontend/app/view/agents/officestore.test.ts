// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { cockpitView, DEFAULT_SOUND, officeAnimation, soundSwitch, soundVolume } from "./officestore";

describe("officestore", () => {
    it("reads the view back as cards unless it says office", () => {
        expect(cockpitView("office")).toBe("office");
        expect(cockpitView("cards")).toBe("cards");
        expect(cockpitView("anything")).toBe("cards");
        expect(cockpitView(undefined)).toBe("cards");
    });

    it("keeps the animation on unless it is explicitly off", () => {
        expect(officeAnimation(false)).toBe(false);
        expect(officeAnimation(true)).toBe(true);
        expect(officeAnimation("off")).toBe(true);
        expect(officeAnimation(undefined)).toBe(true);
    });

    it("reads a sound switch back as its default unless it is a boolean", () => {
        expect(soundSwitch(true, false)).toBe(true);
        expect(soundSwitch(false, true)).toBe(false);
        expect(soundSwitch("on", true)).toBe(true);
        expect(soundSwitch(undefined, false)).toBe(false);
    });

    it("keeps the volume to one of its four steps, else the default", () => {
        expect(soundVolume(0.25)).toBe(0.25);
        expect(soundVolume(1)).toBe(1);
        expect(soundVolume(0.3)).toBe(DEFAULT_SOUND.volume);
        expect(soundVolume("1")).toBe(DEFAULT_SOUND.volume);
        expect(soundVolume(undefined)).toBe(0.5);
    });

    it("has jingles on and the rest off by default", () => {
        expect(DEFAULT_SOUND).toEqual({ events: true, ui: false, music: false, volume: 0.5, muted: false });
    });
});
