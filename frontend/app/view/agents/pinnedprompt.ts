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
