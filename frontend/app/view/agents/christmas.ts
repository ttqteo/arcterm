// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The Christmas theme's two gates and its gift clamp. Pure; christmasstore.ts holds the hooks every view reads.
// Static decor (trees, hats, gifts, the wreath, the lights lit and still) keys off hasChristmasDecor; the snow and
// the lights' blink key off christmasMotionOn as well.

export const CHRISTMAS_THEME = "christmas";

// At most six boxes under a room's tree: four on the floor, two stacked, so the space they take stays fixed.
export const GIFT_MAX = 6;

/** Whether the Christmas decor shows: the Christmas preset with its effects not turned off. */
export function hasChristmasDecor(preset: string, effectsOff: boolean): boolean {
    return preset === CHRISTMAS_THEME && !effectsOff;
}

/** Whether the Christmas motion runs (snow, the lights' blink): the decor shows and reduced motion is off. */
export function christmasMotionOn(decorOn: boolean, reducedMotion: boolean): boolean {
    return decorOn && !reducedMotion;
}

/** Gift boxes under a room's tree: one per finished agent and per done task, between 0 and GIFT_MAX. */
export function giftCount(finished: number, done: number): number {
    const n = Math.max(0, finished) + Math.max(0, done);
    return Math.min(GIFT_MAX, n);
}
