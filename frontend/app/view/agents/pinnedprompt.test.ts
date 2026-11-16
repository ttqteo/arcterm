// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
    pinnedPromptIndex,
    pinnedPromptPush,
    PROMPT_MENU_MAX_W,
    promptCounter,
    promptMenuWidth,
    stepPromptMenu,
} from "./pinnedprompt";

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

describe("promptCounter", () => {
    it("counts the pinned prompt from one", () => {
        expect(promptCounter(9, 12)).toBe("10/12");
        expect(promptCounter(0, 2)).toBe("1/2");
    });
});

describe("promptMenuWidth", () => {
    it("takes the bar's width under a narrow bar, and stops at the cap under a wide one", () => {
        expect(promptMenuWidth(356.4)).toBe(356);
        expect(promptMenuWidth(720)).toBe(PROMPT_MENU_MAX_W);
        expect(promptMenuWidth(-5)).toBe(0);
    });
});

describe("stepPromptMenu", () => {
    it("moves one row with the arrows and stops at the ends instead of wrapping", () => {
        expect(stepPromptMenu(4, "ArrowDown", 12)).toBe(5);
        expect(stepPromptMenu(4, "ArrowUp", 12)).toBe(3);
        expect(stepPromptMenu(11, "ArrowDown", 12)).toBe(11);
        expect(stepPromptMenu(0, "ArrowUp", 12)).toBe(0);
    });

    it("jumps to the ends with Home and End", () => {
        expect(stepPromptMenu(6, "Home", 12)).toBe(0);
        expect(stepPromptMenu(6, "End", 12)).toBe(11);
    });

    it("starts from the first row when nothing has focus yet", () => {
        expect(stepPromptMenu(-1, "ArrowDown", 12)).toBe(0);
        expect(stepPromptMenu(-1, "ArrowUp", 12)).toBe(0);
    });

    it("leaves other keys and an empty list alone", () => {
        expect(stepPromptMenu(3, "Enter", 12)).toBeNull();
        expect(stepPromptMenu(3, "a", 12)).toBeNull();
        expect(stepPromptMenu(0, "ArrowDown", 0)).toBeNull();
    });
});
