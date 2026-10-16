// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { PASTIMES, SLEEP_AFTER_MS } from "@/app/view/jarvis/petwalk";
import { describe, expect, it } from "vitest";
import { bossPet, pickRest, REST_AFTER_MS, type BossPetInput } from "./officepet";

const base: BossPetInput = {
    moving: false,
    dir: "down",
    frame: 0,
    flip: false,
    stillSince: 1_000,
    lastInputAt: 1_000,
    now: 1_000,
    rest: "read",
    character: "sprout",
    expression: "at-rest",
    posture: "none",
    speaking: false,
    unread: false,
};

describe("bossPet", () => {
    it("walks on the office's walk frame", () => {
        expect(bossPet({ ...base, moving: true, frame: 0 }).pose).toBe("walk1");
        expect(bossPet({ ...base, moving: true, frame: 1 }).pose).toBe("walk2");
    });

    it("faces the way it walks left or right, and keeps its facing walking up or down", () => {
        expect(bossPet({ ...base, moving: true, dir: "left" }).flip).toBe(true);
        expect(bossPet({ ...base, moving: true, dir: "right", flip: true }).flip).toBe(false);
        expect(bossPet({ ...base, moving: true, dir: "up", flip: true }).flip).toBe(true);
        expect(bossPet({ ...base, moving: true, dir: "down", flip: false }).flip).toBe(false);
    });

    it("turns where it walks: its back going up, its side going left or right, its front going down", () => {
        expect(bossPet({ ...base, moving: true, dir: "up" }).facing).toBe("back");
        expect(bossPet({ ...base, moving: true, dir: "down" }).facing).toBe("front");
        expect(bossPet({ ...base, moving: true, dir: "left" }).facing).toBe("side");
        expect(bossPet({ ...base, moving: true, dir: "right" }).facing).toBe("side");
    });

    it("keeps turned standing, so an arrow with no walking (reduced motion) still turns it", () => {
        const standing = { ...base, now: base.stillSince + 1 };
        expect(bossPet({ ...standing, dir: "left" })).toMatchObject({ pose: "stand", facing: "side", flip: true });
        expect(bossPet({ ...standing, dir: "up" })).toMatchObject({ pose: "stand", facing: "back" });
    });

    it("faces the viewer in a pastime", () => {
        expect(bossPet({ ...base, dir: "up", now: base.stillSince + REST_AFTER_MS + 1 }).facing).toBe("front");
    });

    it("mirrors Peter's side going left, never his front", () => {
        expect(bossPet({ ...base, moving: true, dir: "left", character: "spidey" }).flip).toBe(true);
        const pastime = { ...base, character: "spidey" as const, flip: true, now: base.stillSince + REST_AFTER_MS + 1 };
        expect(bossPet(pastime).flip).toBe(false);
    });

    it("stands when it has just stopped", () => {
        expect(bossPet({ ...base, now: base.stillSince + REST_AFTER_MS - 1 }).pose).toBe("stand");
    });

    it("plays its pastime once it has stood still a while, frame by frame", () => {
        const { frames, frameMs } = PASTIMES.read!;
        const t0 = base.stillSince + REST_AFTER_MS;
        expect(bossPet({ ...base, now: t0 }).pose).toBe(frames[0]);
        expect(bossPet({ ...base, now: t0 + frameMs }).pose).toBe(frames[1]);
    });

    it("sits or stands for the rests that have no frames", () => {
        const now = base.stillSince + REST_AFTER_MS;
        expect(bossPet({ ...base, now, rest: "sit" }).pose).toBe("sit");
        expect(bossPet({ ...base, now, rest: "stand" }).pose).toBe("stand");
    });

    it("sleeps with a z after the footer's sleep time with no input", () => {
        const r = bossPet({ ...base, now: base.lastInputAt + SLEEP_AFTER_MS });
        expect(r.pose).toBe("sleep");
        expect(r.marks).toContain("z");
    });

    it("is tired with the drop when the window is low, in place of a pastime", () => {
        const r = bossPet({ ...base, expression: "tired", now: base.stillSince + REST_AFTER_MS });
        expect(r.pose).toBe("tired");
        expect(r.marks).toContain("drop");
    });

    it("speaks while a bubble shows", () => {
        expect(bossPet({ ...base, speaking: true, now: base.stillSince + REST_AFTER_MS }).pose).toBe("speak");
    });

    it("walking wins over every rest", () => {
        expect(bossPet({ ...base, moving: true, speaking: true, expression: "tired" }).pose).toBe("walk1");
    });

    it("carries the posture's mark and the unread mark", () => {
        expect(bossPet({ ...base, posture: "review-gate", unread: true }).marks).toEqual(["gate", "unread"]);
    });
});

describe("pickRest", () => {
    it("picks one of the footer's rest poses", () => {
        expect(pickRest(() => 0)).toBe("stand");
        expect(pickRest(() => 0.999)).toBe("ball");
    });
});
