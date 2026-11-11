// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The rules of Chat's bash mode (a message box whose text starts with `!`), as Claude Code's TUI has them: the grey
// ghost text from its `!` history, and what a Tab completes (compgen -c, -v, -f) for the word under the caret.
// Pure: no React, no Wave runtime imports. The history read is `chatbashstore.ts`, the Tab list `bashcomplete.tsx`.

/** What the word under the caret completes to; the three of Claude Code's bash mode (compgen -c, -v, -f). */
export type BashWordKind = "command" | "variable" | "file";

export interface BashWord {
    start: number; // in the box's text; for a variable, after its `$`
    end: number;
    kind: BashWordKind;
    word: string;
}

/** Pure: the rest of the newest history command that starts with what was typed after the `!`, as Claude Code's
 *  ghost text: only with the caret at the end, 2 characters typed or more, and never for an exact match. */
export function bashGhost(history: string[], text: string, caret: number): string {
    if (!text.startsWith("!") || caret !== text.length) {
        return "";
    }
    const typed = text.slice(1);
    if (typed.length < 2 || typed.trim() === "") {
        return "";
    }
    const hit = history.find((h) => h.startsWith(typed) && h !== typed);
    return hit == null ? "" : hit.slice(typed.length);
}

/** Pure: the word that ends at the caret, and what it completes to: the command's first word is a command (unless it
 *  holds a `/` or starts with `.` or `~`), a `$word` a variable, any other a file. Null out of bash mode. */
export function bashWordAt(text: string, caret: number): BashWord | null {
    if (!text.startsWith("!") || caret < 1) {
        return null;
    }
    let start = caret;
    while (start > 1 && !/\s/.test(text[start - 1])) {
        start--;
    }
    const word = text.slice(start, caret);
    if (word.startsWith("$")) {
        return { start: start + 1, end: caret, kind: "variable", word: word.slice(1) };
    }
    const first = text.slice(1, start).trim() === "";
    const pathLike = word.includes("/") || word.startsWith(".") || word.startsWith("~");
    return { start, end: caret, kind: first && !pathLike ? "command" : "file", word };
}

/** Pure: the text with `pick` in place of the word, and the caret after it; a space follows unless the pick is a
 *  folder (it ends in `/`), so the next Tab goes on into it. */
export function applyCompletion(text: string, w: BashWord, pick: string): { text: string; caret: number } {
    const insert = pick.endsWith("/") ? pick : `${pick} `;
    return { text: text.slice(0, w.start) + insert + text.slice(w.end), caret: w.start + insert.length };
}

/** Pure: the history with a command just run in front, as Claude Code moves it. */
export function ranFirst(history: string[], cmd: string): string[] {
    return [cmd, ...history.filter((h) => h !== cmd)];
}
