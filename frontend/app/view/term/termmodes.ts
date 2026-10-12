// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Mouse report encodings (DECSET 1005 UTF-8, 1006 SGR, 1015 urxvt, 1016 SGR pixels). The serialize addon saves the
// tracking mode (1000/1002/1003) but not the encoding, so a pane restored from its cache sent X10 wheel reports to a
// TUI that asked for SGR, and Claude Code's fullscreen renderer never scrolled
const MouseEncodingModes = new Set([1005, 1006, 1015, 1016]);

// the encoding in force after a `CSI ? Pm h` (set) or `CSI ? Pm l` (reset); null is the default X10 encoding
export function nextMouseEncoding(current: number | null, params: (number | number[])[], set: boolean): number | null {
    let encoding = current;
    for (const p of params) {
        const mode = Array.isArray(p) ? p[0] : p;
        if (!MouseEncodingModes.has(mode)) {
            continue;
        }
        if (set) {
            encoding = mode;
        } else if (mode === encoding) {
            encoding = null;
        }
    }
    return encoding;
}

// the serialized screen with the encoding put back, after the modes the addon writes at its end
export function withMouseEncoding(serialized: string, encoding: number | null): string {
    return encoding == null ? serialized : `${serialized}\x1b[?${encoding}h`;
}
