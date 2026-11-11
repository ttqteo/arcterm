// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Single source of truth for keyboard-modifier / key display glyphs. Platform-aware: macOS draws the
// modifier glyphs (⌘ ⌃ ⌥ ⇧) run together, "⌘⇧P"; Windows/Linux spell every key out in words, capitalized and
// joined by "+", "Ctrl+Shift+P", "Ctrl+Enter", "Esc", with no key symbols (DESIGN.md "Shortcut labels"). A bare
// letter and a leader chord's keys stay as typed ("r", "g p"): they name the key without Shift.
// Never call these at module-eval time — platform is set at boot (see platformutil).

import { isMacOS } from "./platformutil";

const ARROWS: Record<string, string> = {
    arrowup: "↑",
    arrowdown: "↓",
    arrowleft: "←",
    arrowright: "→",
};

// non-modifier keys with a display name, keyed lower case so "esc", "Escape" and "enter" all resolve; also keeps
// a named key from being upper-cased as a letter.
const NAMED_MAC: Record<string, string> = {
    ...ARROWS,
    enter: "⏎",
    return: "⏎",
    escape: "esc",
    esc: "esc",
    space: "Space",
    tab: "Tab",
    backspace: "⌫",
    delete: "Del",
    del: "Del",
    pageup: "PgUp",
    pagedown: "PgDn",
    home: "Home",
    end: "End",
};

const NAMED_WIN: Record<string, string> = {
    ...ARROWS,
    enter: "Enter",
    return: "Enter",
    escape: "Esc",
    esc: "Esc",
    space: "Space",
    tab: "Tab",
    backspace: "Backspace",
    delete: "Del",
    del: "Del",
    pageup: "PgUp",
    pagedown: "PgDn",
    home: "Home",
    end: "End",
};

function namedKey(token: string): string | undefined {
    return (isMacOS() ? NAMED_MAC : NAMED_WIN)[token.toLowerCase()];
}

// One chord token -> display glyph. Modifier tokens branch on platform; a letter is upper-case beside the
// Mac glyphs, and as typed alone on Windows (formatChord upper-cases it inside a modifier chord).
export function modSymbol(token: string): string {
    switch (token) {
        case "Cmd":
        case "Mod": // keyutil's primary modifier: Command on a Mac, Control elsewhere
            return isMacOS() ? "⌘" : "Ctrl";
        // keyutil matches "Ctrl" against the Control key on every platform, so a Mac must not show ⌘
        case "Ctrl":
            return isMacOS() ? "⌃" : "Ctrl";
        case "Shift":
            return isMacOS() ? "⇧" : "Shift";
        case "Alt":
        case "Option":
            return isMacOS() ? "⌥" : "Alt";
        case "Meta":
            return isMacOS() ? "⌘" : "Win";
    }
    const named = namedKey(token);
    if (named != null) {
        return named;
    }
    if (token.length === 1) {
        return isMacOS() ? token.toUpperCase() : token;
    }
    return token;
}

// Full chord -> per-part glyphs. Space-separated = a sequence (a leader chord, or several chords named
// together): a bare key is kept as typed, a modifier chord becomes one part; colon-separated = one
// modifier chord (each part through modSymbol, its letter upper-case: "Ctrl+P").
export function formatChord(keys: string): string[] {
    if (keys.includes(" ")) {
        return keys.split(" ").map((k) => (k.includes(":") ? formatChordString(k) : (namedKey(k) ?? k)));
    }
    const parts = keys.split(":");
    return parts.map((k) => (parts.length > 1 && k.length === 1 ? k.toUpperCase() : modSymbol(k)));
}

export function formatChordString(keys: string): string {
    if (keys.includes(" ")) {
        return formatChord(keys).join(" ");
    }
    return formatChord(keys).join(isMacOS() ? "" : "+");
}
