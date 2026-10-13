// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Single source of truth for keyboard-modifier / key display glyphs. Platform-aware: macOS draws the
// modifier glyphs (⌘ ⌃ ⌥ ⇧) run together, "⌘⇧P"; Windows/Linux spell the keys out in lower case joined by
// "+", "ctrl+shift+p", the same case as "esc" and the leader chords ("g p").
// Never call these at module-eval time — platform is set at boot (see platformutil).

import { isMacOS } from "./platformutil";

// non-modifier keys with a canonical glyph; also used to avoid upper-casing named keys.
const NAMED: Record<string, string> = {
    Enter: "⏎",
    Return: "⏎",
    Escape: "esc",
    Esc: "esc",
    ArrowUp: "↑",
    ArrowDown: "↓",
    ArrowLeft: "←",
    ArrowRight: "→",
    Space: "Space",
    Tab: "Tab",
    Backspace: "⌫",
    Delete: "Del",
    PageUp: "PgUp",
    PageDown: "PgDn",
    Home: "Home",
    End: "End",
};

// One chord token -> display glyph. Modifier tokens branch on platform; a letter is upper-case beside the
// Mac glyphs and lower-case beside the spelled-out Windows names.
export function modSymbol(token: string): string {
    switch (token) {
        case "Cmd":
        case "Mod": // keyutil's primary modifier: Command on a Mac, Control elsewhere
            return isMacOS() ? "⌘" : "ctrl";
        // keyutil matches "Ctrl" against the Control key on every platform, so a Mac must not show ⌘
        case "Ctrl":
            return isMacOS() ? "⌃" : "ctrl";
        case "Shift":
            return isMacOS() ? "⇧" : "shift";
        case "Alt":
        case "Option":
            return isMacOS() ? "⌥" : "alt";
        case "Meta":
            return isMacOS() ? "⌘" : "win";
    }
    const named = NAMED[token];
    if (named != null) {
        return isMacOS() ? named : named.toLowerCase();
    }
    if (token.length === 1) {
        return isMacOS() ? token.toUpperCase() : token.toLowerCase();
    }
    return token;
}

// Full chord -> per-part glyphs. Space-separated = a sequence (a leader chord, or several chords named
// together): a bare key is kept as typed, a modifier chord becomes one part; colon-separated = one
// modifier chord (each part through modSymbol).
export function formatChord(keys: string): string[] {
    if (keys.includes(" ")) {
        return keys.split(" ").map((k) => (k.includes(":") ? formatChordString(k) : (NAMED[k] ?? k)));
    }
    return keys.split(":").map((k) => modSymbol(k));
}

export function formatChordString(keys: string): string {
    if (keys.includes(" ")) {
        return formatChord(keys).join(" ");
    }
    return formatChord(keys).join(isMacOS() ? "" : "+");
}
