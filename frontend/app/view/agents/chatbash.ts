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

// What a shell gives a meaning to outside quotes, so a file's name holding one must be escaped with a backslash, as
// bash's readline does when it completes: space and tab, then ' " \ $ ` ! & ; | < > ( ) [ ] { } * ? # ~ and =. A `/` is
// none of them: it ends a folder, and the next Tab goes on into it.
const SHELL_SPECIAL = /[ \t'"\\$`!&;|<>()[\]{}*?#~=]/g;

/** Pure: whether the character at `i` is escaped, that is, an odd number of backslashes stands right before it. */
function escapedAt(text: string, i: number): boolean {
    let slashes = 0;
    while (i - 1 - slashes >= 0 && text[i - 1 - slashes] === "\\") {
        slashes++;
    }
    return slashes % 2 === 1;
}

/** Pure: a word as the shell reads it, with each backslash taken away and the character after it kept as it is. A lone
 *  backslash at the end (an escape still being typed) is dropped. */
function unescapeWord(word: string): string {
    return word.replace(/\\([\s\S]?)/g, "$1");
}

/** Pure: the word that ends at the caret, and what it completes to: the command's first word is a command (unless it
 *  holds a `/` or starts with `.` or `~`), a `$word` a variable, any other a file. A space a backslash escapes (`my\ fi`)
 *  is part of the word. `word` is the word unescaped (`my fi`, what compgen takes), while `start` and `end` span the text as
 *  it stands in the box, the backslashes included. Null out of bash mode. */
export function bashWordAt(text: string, caret: number): BashWord | null {
    if (!text.startsWith("!") || caret < 1) {
        return null;
    }
    let start = caret;
    while (start > 1 && !(/\s/.test(text[start - 1]) && !escapedAt(text, start - 1))) {
        start--;
    }
    const raw = text.slice(start, caret);
    if (raw.startsWith("$")) {
        return { start: start + 1, end: caret, kind: "variable", word: unescapeWord(raw.slice(1)) };
    }
    const word = unescapeWord(raw);
    const first = text.slice(1, start).trim() === "";
    const pathLike = word.includes("/") || word.startsWith(".") || word.startsWith("~");
    return { start, end: caret, kind: first && !pathLike ? "command" : "file", word };
}

/** Pure: a file's name as the shell takes it from the command line: a backslash in front of each space and shell
 *  metacharacter. A `~` that starts the name stays bare when the word typed started with one too: the shell expands that
 *  tilde to a home folder (compgen answers `~/src/` for `~/sr`), and a `\~` would make it a folder named `~`. */
function escapeFile(pick: string, typed: string): string {
    const keep = typed.startsWith("~") && pick.startsWith("~") ? 1 : 0;
    return pick.slice(0, keep) + pick.slice(keep).replace(SHELL_SPECIAL, "\\$&");
}

/** Pure: the text with `pick` in place of the word, and the caret after it; a space follows unless the pick is a
 *  folder (it ends in `/`), so the next Tab goes on into it. A file's pick is escaped (`my file.txt` is written
 *  `my\ file.txt`); a command's or a variable's holds none of the characters that need it, and goes in as it is. */
export function applyCompletion(text: string, w: BashWord, pick: string): { text: string; caret: number } {
    const name = w.kind === "file" ? escapeFile(pick, w.word) : pick;
    const insert = name.endsWith("/") ? name : `${name} `;
    return { text: text.slice(0, w.start) + insert + text.slice(w.end), caret: w.start + insert.length };
}

/** Pure: the history with a command just run in front, as Claude Code moves it. */
export function ranFirst(history: string[], cmd: string): string[] {
    return [cmd, ...history.filter((h) => h !== cmd)];
}
