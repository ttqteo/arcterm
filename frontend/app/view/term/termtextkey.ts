// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// An input method that rewrites a syllable (XKey, OpenKey and the other macOS Vietnamese IMEs) deletes the
// raw letters and then posts one key event carrying the whole replacement, "ặc" for "acj". xterm sends a
// keydown's key only when it is one character and otherwise falls back to the keypress's charCode, which
// holds one character, so everything after the first was lost. Returns that text for the caller to send
// whole, or null to leave the event to xterm. Named keys ("Enter", "ArrowLeft", "F5", "Dead") are ASCII
// words that start with a capital letter.
export function multiCharTextKey(e: KeyboardEvent): string | null {
    if (e.type !== "keydown" || e.ctrlKey || e.metaKey || e.altKey || e.isComposing) {
        return null;
    }
    const key = e.key ?? "";
    if ([...key].length < 2 || /^[A-Z][A-Za-z0-9]*$/.test(key)) {
        return null;
    }
    return key;
}
