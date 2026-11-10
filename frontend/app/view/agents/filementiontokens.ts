// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Which `@…` words in a message are file mentions, the one rule the chat box (its pills) and your sent bubble (the same
// pills, drawn back from the text) share. Pure. A mention is an `@` at the start of the text or after whitespace or an
// opening bracket, then a path: `@src/app.ts`, `@D:\x\y.pdf`, `@README.md`, or a quoted `@"C:/My Files/a b.md"`. It
// must look like a path (a separator, or a name ending in an extension), so `@alice` and an email are text; trailing
// punctuation (`,` `.` `)` …) is not part of it. The `@` file picker (launchermention.ts) writes `@<path>` and a space.

export interface MentionToken {
    /** where the `@` is */
    start: number;
    /** just past the path (past the closing quote of a quoted one) */
    end: number;
    path: string;
}

const LEADING = /[\s([{]/;
const PATH_LIKE = /[\\/]|\.[A-Za-z0-9]{1,8}$/;
const TRAILING_PUNCT = /[.,;:!?)\]}'"]+$/;

/** Pure: the file mentions in `text`, in order. With `caret`, a token the caret is in or at the end of (still being
 *  typed) is left out; one followed by a space the caret has passed is kept. */
export function mentionTokens(text: string, caret?: number): MentionToken[] {
    const out: MentionToken[] = [];
    for (let i = 0; i < text.length; i++) {
        if (text[i] !== "@" || (i > 0 && !LEADING.test(text[i - 1]))) {
            continue;
        }
        let path: string;
        let end: number;
        if (text[i + 1] === '"') {
            const close = text.indexOf('"', i + 2);
            if (close < 0) {
                continue;
            }
            path = text.slice(i + 2, close);
            end = close + 1;
        } else {
            const word = /^\S+/.exec(text.slice(i + 1))?.[0] ?? "";
            path = word.replace(TRAILING_PUNCT, "");
            end = i + 1 + path.length;
        }
        if (path === "" || path.includes("@") || !PATH_LIKE.test(path.replace(/[\\/]+$/, "") || path)) {
            continue;
        }
        if (caret != null && caret > i && caret <= end) {
            continue;
        }
        out.push({ start: i, end, path });
        i = end - 1;
    }
    return out;
}

/** Pure: the name a pill shows for a path, its last segment. */
export function mentionBaseName(path: string): string {
    return path.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || path;
}
