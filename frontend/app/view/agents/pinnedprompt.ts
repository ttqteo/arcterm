// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Pure: which of your prompts a transcript pins to its top. The turn at the top of the view is the last one whose prompt
// starts at or above it; its prompt is pinned once it has scrolled out of view, so the reply on screen always says what
// it answers. No React.

// a prompt's extent in the scroller's content coordinates
export interface PromptAnchor {
    top: number;
    bottom: number;
}

/** Pure: the index of the prompt to pin (anchors in document order), or -1 for none. viewTop is the scroller's
 *  scrollTop. */
export function pinnedPromptIndex(anchors: PromptAnchor[], viewTop: number): number {
    let at = -1;
    for (let i = 0; i < anchors.length && anchors[i].top <= viewTop; i++) {
        at = i;
    }
    return at >= 0 && anchors[at].bottom <= viewTop ? at : -1;
}

/** Pure: how far the pinned band moves up (0 or less, px) as the next prompt comes up under it: not at all while that
 *  prompt is more than the band's height below the top, then pixel for pixel with it, so the next prompt shoves the band
 *  out instead of the band vanishing over it. nextTop is the next prompt's top below the scroller's top edge, null with
 *  no next prompt. It stops at the band's height, where the band is out of view. */
export function pinnedPromptPush(nextTop: number | null, bandHeight: number): number {
    if (nextTop == null) {
        return 0;
    }
    return Math.max(-bandHeight, Math.min(0, nextTop - bandHeight));
}

/** The fewest prompts a transcript has before the bar offers the list of them: with one, the list is the bar. */
export const PROMPT_MENU_MIN = 2;

/** The widest the list of prompts opens; under a narrower bar it takes the bar's width. */
export const PROMPT_MENU_MAX_W = 440;

/** Pure: the list's width under a bar this wide. */
export function promptMenuWidth(barWidth: number): number {
    return Math.max(0, Math.min(PROMPT_MENU_MAX_W, Math.round(barWidth)));
}

/** Pure: the bar's counter, the pinned prompt's place among count ("10/12"). */
export function promptCounter(index: number, count: number): string {
    return `${index + 1}/${count}`;
}

/** Pure: the row a key moves to in the list of count prompts from row at, or null for a key the list leaves alone.
 *  ArrowUp / ArrowDown stop at the ends rather than wrap: the list is in conversation order, and wrapping from the
 *  first prompt to the last reads as a jump to the other end of the conversation. */
export function stepPromptMenu(at: number, key: string, count: number): number | null {
    if (count <= 0) {
        return null;
    }
    const last = count - 1;
    switch (key) {
        case "ArrowDown":
            return Math.min(last, Math.max(0, at + 1));
        case "ArrowUp":
            return Math.max(0, Math.min(last, at - 1));
        case "Home":
            return 0;
        case "End":
            return last;
    }
    return null;
}

// fired (bubbling) on a transcript's root as its pinned prompt starts the scroll back, so a feed that sticks to its tail
// (sticktobottom.tsx) lets go first: a smooth scroll starts at the bottom, and a re-pin on the next streamed entry would
// snap it back down, over and over while the agent writes
export const PROMPT_JUMP_EVENT = "pinnedprompt:jump";
