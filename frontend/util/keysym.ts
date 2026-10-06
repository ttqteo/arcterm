// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Single source of truth for keyboard-modifier / key display glyphs. Platform-aware:
// the primary accelerator (Cmd/Ctrl) renders "^" on Windows/Linux and "⌘" on macOS.
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

// One chord token -> display glyph. Modifier tokens branch on platform; letters upper-case.
export function modSymbol(token: string): string {
    switch (token) {
        case "Cmd":
            return isMacOS() ? "⌘" : "^";
        // keyutil matches "Ctrl" against the Control key on every platform, so a Mac must not show ⌘
        case "Ctrl":
            return isMacOS() ? "⌃" : "^";
        case "Shift":
            return "⇧";
        case "Alt":
        case "Option":
            return isMacOS() ? "⌥" : "Alt";
        case "Meta":
            return isMacOS() ? "⌘" : "Win";
    }
    if (NAMED[token] != null) {
        return NAMED[token];
    }
    return token.length === 1 ? token.toUpperCase() : token;
}

// Full chord -> per-part glyphs. Space-separated = leader chord (keys kept as typed);
// colon-separated = modifier chord (each part through modSymbol).
export function formatChord(keys: string): string[] {
    if (keys.includes(" ")) {
        return keys.split(" ").map((k) => NAMED[k] ?? k);
    }
    return keys.split(":").map((k) => modSymbol(k));
}

export function formatChordString(keys: string): string {
    return formatChord(keys).join("");
}
