// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// How a newcomer learns brainstorm mode from the app itself: a one-time card at the top of the first pane that opens on
// this machine, and the line that says where to start one. Pure: the card (brainstormhints.tsx) reads and writes the
// store this takes, and the tests hand it a fake one.

// the only thing remembered: that the card was dismissed on this machine
export const HINTS_SEEN_KEY = "brainstorm.hintsSeen";

// where it is remembered; window.localStorage in the app
export type HintStore = {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
};

// four short parts, plain words, that the card runs together on one row
export const HINT_LINES: readonly string[] = [
    "Enter sends your answer",
    "Not sure? “Guess for me”, then “That’s right”",
    "b or Ctrl+Shift+B: back to terminal",
    "“Check with a builder”, then Approve runs it",
];

// the line the Agent surface's empty state and the New dialog's agent row show
export const START_LINE =
    "Ask the agent to brainstorm a feature (superpowers:brainstorming) and Arc opens it here, one question at a time.";

// A read that fails, or a store that is not there, shows the card: showing it once too often costs a click, and hiding
// it for good on a failed read would cost the newcomer the one thing it is for.
export function hintsSeen(store: HintStore | undefined): boolean {
    try {
        return store?.getItem(HINTS_SEEN_KEY) === "1";
    } catch {
        return false;
    }
}

// A write that fails still dismisses the card for this session (the caller keeps its own flag, dismissedNow below); it
// shows again on the next launch.
export function markHintsSeen(store: HintStore | undefined): void {
    try {
        store?.setItem(HINTS_SEEN_KEY, "1");
    } catch {
        // nothing remembered
    }
}

// the card shows until it was dismissed, on an earlier launch (seenOnDisk) or in this session (dismissedNow)
export function shouldShowHints(seenOnDisk: boolean, dismissedNow: boolean): boolean {
    return !seenOnDisk && !dismissedNow;
}

// the browser's store, or none where the page has no localStorage (a hardened profile throws on the property read)
export function browserHintStore(): HintStore | undefined {
    try {
        return window.localStorage;
    } catch {
        return undefined;
    }
}
