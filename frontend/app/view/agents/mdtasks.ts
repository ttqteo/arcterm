// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Ticking a markdown task box (`- [ ]` / `- [x]`) from the File tab's Preview: the one source line the box came from
// flips, and nothing else in the file moves.

// a list item's marker, inside any blockquotes, then its box
const TASK = /^((?:[ \t]*>)*[ \t]*(?:[-*+]|\d+[.)])[ \t]+)\[([ xX])\]/;

// The file with the box on 1-based `line` flipped, or null when that line holds no box, or, given `shown` (the line
// as the view rendered it), when the line has changed since: a click on a stale view never ticks the wrong item.
export function toggleTaskLine(text: string, line: number, shown?: string): string | null {
    const lines = text.split("\n");
    const at = line - 1;
    if (at < 0 || at >= lines.length) {
        return null;
    }
    const cur = lines[at];
    if (shown != null && cur.replace(/\r$/, "") !== shown) {
        return null;
    }
    const m = TASK.exec(cur);
    if (m == null) {
        return null;
    }
    lines[at] = m[1] + (m[2] === " " ? "[x]" : "[ ]") + cur.slice(m[0].length);
    return lines.join("\n");
}
