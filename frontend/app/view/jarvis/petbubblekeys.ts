// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The bubble opens over the bottom of the terminal beside the creature, which is where a prompt is typed. Typing there
// puts it away (petbubble.tsx), as its time running out would: what it said stays unread.

// keys that type nothing on their own: held for the digit hints (Mod) or as half of a chord
const MODIFIER_KEYS = new Set([
    "Shift",
    "Control",
    "Alt",
    "AltGraph",
    "Meta",
    "OS",
    "Super",
    "Hyper",
    "Fn",
    "FnLock",
    "CapsLock",
    "NumLock",
    "ScrollLock",
    "Symbol",
    "SymbolLock",
]);

export interface BubbleKey {
    key: string;
    metaKey: boolean;
    ctrlKey: boolean;
}

/**
 * Whether a keydown puts the bubble away: any key that types, but not a bare modifier, not a shortcut (⌘ or Ctrl
 * held: ⌘J opens the peek on the question the bubble was asking, so the bubble must still be there to read), and not a
 * key pressed on the bubble itself (Enter opens it).
 */
export function keyPutsBubbleAway(e: BubbleKey, onBubble: boolean): boolean {
    if (onBubble || MODIFIER_KEYS.has(e.key)) {
        return false;
    }
    return !e.metaKey && !e.ctrlKey;
}
