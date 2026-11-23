// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// A name that changes in place (a session's first prompt giving way to its ai-title) shows the new words in, one
// after another. Only a change of the same thing's text plays: showing another thing (the header switching agents)
// swaps at once, like any navigation.

export interface TextSwapState {
    key: string; // what the text names (an agent's id)
    text: string;
    swap: number; // 0 until the text of the same key changes; each change counts up, which restarts the reveal
}

/** Pure: the state after a render with `key` and `text`. The same state object when nothing changed. */
export function nextTextSwap(prev: TextSwapState, key: string, text: string): TextSwapState {
    if (prev.key === key && prev.text === text) {
        return prev;
    }
    if (prev.key !== key || prev.text === "") {
        return { key, text, swap: 0 };
    }
    return { key, text, swap: prev.swap + 1 };
}

/** Pure: the text cut into words with the spaces between them kept as their own parts, so the parts joined give the
 *  text back. Words, not letters: a letter span would split Vietnamese marks and break the font's shaping. */
export function swapParts(text: string): string[] {
    return text.split(/(\s+)/).filter((p) => p !== "");
}

// the whole reveal fits in about MOTION.durMacro past its first word, however many words: a long title staggers less
const STAGGER_MAX = 0.05;
const STAGGER_SPAN = 0.24;

/** Pure: the delay of the nth word (seconds) of `words` words. */
export function swapDelay(index: number, words: number): number {
    if (words <= 1) {
        return 0;
    }
    return index * Math.min(STAGGER_MAX, STAGGER_SPAN / (words - 1));
}
