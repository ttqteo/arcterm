// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { RUN_SPEED, RUN_STEP_MS, runFrame } from "./startuprun";

const TRACK = 348;
const SPRITE = 48;
const SPAN = TRACK - SPRITE;

describe("runFrame", () => {
    it("starts at the left edge facing right", () => {
        expect(runFrame(0, TRACK, SPRITE, 3)).toEqual({ x: 0, facing: "right", pose: "walk1", lift: 0 });
    });

    it("runs right, turns at the far edge and comes back", () => {
        const half = SPAN / RUN_SPEED;
        expect(runFrame(half / 2, TRACK, SPRITE, 3)).toMatchObject({ x: SPAN / 2, facing: "right" });
        expect(runFrame(half * 1.5, TRACK, SPRITE, 3)).toMatchObject({ x: SPAN / 2, facing: "left" });
        expect(runFrame(half * 2, TRACK, SPRITE, 3)).toMatchObject({ x: 0, facing: "right" });
    });

    it("never leaves the track", () => {
        for (let t = 0; t < 20_000; t += 37) {
            const { x } = runFrame(t, TRACK, SPRITE, 3);
            expect(x).toBeGreaterThanOrEqual(0);
            expect(x).toBeLessThanOrEqual(SPAN);
        }
    });

    it("swaps legs every step and bounces on the second", () => {
        expect(runFrame(RUN_STEP_MS - 1, TRACK, SPRITE, 3)).toMatchObject({ pose: "walk1", lift: 0 });
        expect(runFrame(RUN_STEP_MS, TRACK, SPRITE, 3)).toMatchObject({ pose: "walk2", lift: 3 });
        expect(runFrame(RUN_STEP_MS * 2, TRACK, SPRITE, 3)).toMatchObject({ pose: "walk1", lift: 0 });
    });

    it("runs in place on a track no wider than the sprite", () => {
        expect(runFrame(5_000, SPRITE, SPRITE, 3)).toMatchObject({ x: 0, facing: "right" });
    });

    it("treats a bad clock as the start", () => {
        expect(runFrame(NaN, TRACK, SPRITE, 3)).toEqual(runFrame(0, TRACK, SPRITE, 3));
        expect(runFrame(-50, TRACK, SPRITE, 3)).toEqual(runFrame(0, TRACK, SPRITE, 3));
    });
});
