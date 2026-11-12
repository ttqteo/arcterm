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

// fired (bubbling) on a transcript's root as its pinned prompt starts the scroll back, so a feed that sticks to its tail
// (sticktobottom.tsx) lets go first: a smooth scroll starts at the bottom, and a re-pin on the next streamed entry would
// snap it back down, over and over while the agent writes
export const PROMPT_JUMP_EVENT = "pinnedprompt:jump";
