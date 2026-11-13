// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The one FNV-1a hash the Chat models share: chatskim.ts keys a reply's stored skim marks by it (and re-exports it), and
// chatinitiative.ts keys a handled initiative card by it. It sits in its own file because chatskim.ts imports from
// chatinitiative.ts, so chatinitiative.ts importing chatskim.ts would be an import cycle. Pure.

// FNV-1a over the text: eight hex digits of the hash, then the text's length in hex
export function hashText(text: string): string {
    let h = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) {
        h ^= text.charCodeAt(i);
        h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0).toString(16).padStart(8, "0") + text.length.toString(16);
}
