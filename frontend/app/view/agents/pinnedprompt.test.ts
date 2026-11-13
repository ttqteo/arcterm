// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { pinnedPromptIndex, pinnedPromptPush } from "./pinnedprompt";

// three prompts, 40px tall, at 0, 500 and 1200 in the scroller's content
const ANCHORS = [
    { top: 0, bottom: 40 },
    { top: 500, bottom: 540 },
    { top: 1200, bottom: 1240 },
];

describe("pinnedPromptIndex", () => {
    it("pins nothing while the top turn's prompt is still in view", () => {
        expect(pinnedPromptIndex(ANCHORS, 0)).toBe(-1);
        expect(pinnedPromptIndex(ANCHORS, 39)).toBe(-1);
    });

    it("pins the prompt of the turn at the top once it has scrolled away", () => {
        expect(pinnedPromptIndex(ANCHORS, 40)).toBe(0);
        expect(pinnedPromptIndex(ANCHORS, 499)).toBe(0);
    });

    it("lets the next prompt take over: nothing while it shows, then it", () => {
        expect(pinnedPromptIndex(ANCHORS, 520)).toBe(-1);
        expect(pinnedPromptIndex(ANCHORS, 600)).toBe(1);
        expect(pinnedPromptIndex(ANCHORS, 5000)).toBe(2);
    });

    it("pins nothing with no prompts, or above the first one", () => {
        expect(pinnedPromptIndex([], 300)).toBe(-1);
        expect(pinnedPromptIndex([{ top: 200, bottom: 240 }], 100)).toBe(-1);
    });
});

describe("pinnedPromptPush", () => {
    it("leaves the band in place with no next prompt, or one further down than the band is tall", () => {
        expect(pinnedPromptPush(null, 42)).toBe(0);
        expect(pinnedPromptPush(300, 42)).toBe(0);
        expect(pinnedPromptPush(42, 42)).toBe(0);
    });

    it("moves the band up pixel for pixel as the next prompt comes up under it", () => {
        expect(pinnedPromptPush(30, 42)).toBe(-12);
        expect(pinnedPromptPush(1, 42)).toBe(-41);
    });

    it("stops once the band is out of view", () => {
        expect(pinnedPromptPush(0, 42)).toBe(-42);
        expect(pinnedPromptPush(-200, 42)).toBe(-42);
    });
});
