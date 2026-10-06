// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// The text model of the app's hover tooltip (titletiphost.tsx). Titles across the app end with their
// shortcut in parentheses — `Show the review (${formatChordString("r")})`, "Hide the review (Esc)" — and
// the tooltip shows that shortcut apart from the label, muted. Only a parenthesis that reads as keys is
// split off; "Remove (keeps files)" stays one label.

export interface TipText {
    label: string;
    keys?: string;
}

// a chord as formatChordString draws it (^P, ⇧^O, AltT, ⏎, esc) or as titles spell it by hand (Esc,
// Ctrl+K, F2)
const NAMED_KEY = /^(esc|escape|enter|return|tab|space|del|delete|backspace|home|end|pgup|pgdn|f\d{1,2})$/i;
const MOD_PLUS = /^(ctrl|cmd|alt|option|shift|meta|win)\+\S+$/i;
const GLYPH_CHORD = /^[\^⌘⌥⇧]\S{0,6}$|^Alt\S{1,3}$/;
const CONNECTOR = /^(and|or|then|twice|,|\/)$/i;

function isKeyToken(t: string): boolean {
    return t.length <= 2 || NAMED_KEY.test(t) || MOD_PLUS.test(t) || GLYPH_CHORD.test(t);
}

export function looksLikeKeys(s: string): boolean {
    const tokens = s.trim().split(/\s+/).filter(Boolean);
    const keys = tokens.filter((t) => !CONNECTOR.test(t));
    return keys.length > 0 && keys.length <= 4 && keys.every(isKeyToken);
}

export function splitTitle(title: string): TipText {
    const text = title.trim();
    const m = /^([\s\S]*\S)\s*\(([^()]+)\)$/.exec(text);
    if (m && looksLikeKeys(m[2])) {
        return { label: m[1], keys: m[2].trim() };
    }
    return { label: text };
}
