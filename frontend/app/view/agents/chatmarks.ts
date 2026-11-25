// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The paste the message box fences for you, and the quotes a sent message ends. A paste of several lines that reads as
// code or a log (a stack trace, a build's output) goes in wrapped in a ``` block, so it is sent as one. The box itself
// draws the text as typed, with no markdown.

import { fenceRanges } from "./chatfences";

// up to three spaces, then `>`
const QUOTE = /^ {0,3}>/;

/** Pure: the message with a blank line after each quote that a line of text follows at once, outside fenced blocks, so
 *  markdown ends the quote there: `>xx` then `sss` is a quote of `xx` and a line `sss`, where markdown alone would
 *  carry `sss` into the quote (a lazy continuation line). */
export function endQuotes(text: string): string {
    const lines = text.split("\n");
    const fenced = new Set<number>();
    for (const range of fenceRanges(lines)) {
        const last = range.close ?? lines.length - 1;
        for (let line = range.open; line <= last; line++) {
            fenced.add(line);
        }
    }
    const quote = (i: number) => !fenced.has(i) && QUOTE.test(lines[i]);
    const out: string[] = [];
    lines.forEach((line, i) => {
        out.push(line);
        const next = i + 1;
        if (quote(i) && next < lines.length && !quote(next) && !fenced.has(next) && lines[next].trim() !== "") {
            out.push("");
        }
    });
    return out.join("\n");
}

// ---- a paste that is code ----

// a line that is code or a log's, not prose
const CODE_LINE: RegExp[] = [
    // a stack frame: JS / Java `at f (file:1:2)`, Python's `File "x.py", line 3`, Go's `goroutine 1 [running]:`
    /^\s*at\s+\S/,
    /^\s*File ".*", line \d+/,
    /^Traceback \(most recent call last\)/,
    /^goroutine \d+ \[/,
    // indented
    /^(\t| {2,})\S/,
    // ends a statement or opens / closes a block
    /[;{}]\s*$/,
    /^\s*[}\])]/,
    // a source file and line: `react-dom.development.js:26962`, `main.go:12`
    /[\w.\-/\\]+\.[A-Za-z]{1,5}:\d+/,
    // a keyword that starts a line of code
    /^\s*(const|let|var|function|import|export|return|if|for|while|def|class|func|package|fn|pub|use|from|#include|SELECT|INSERT|UPDATE|DELETE|CREATE)\b/,
    // a comment
    /^\s*(\/\/|\/\*|\*\s|#!)/,
    // an operator prose has no use for
    /=>|===|!==|::|&&|\|\|/,
    // a log line: a timestamp, a level, an error's name
    /^\[?\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/,
    /^\s*\[?(INFO|WARN|WARNING|ERROR|DEBUG|TRACE|FATAL)\]?[\s:]/,
    /\b\w*(Error|Exception)\b:?/,
    /^panic:/,
    // a shell prompt
    /^\s*\$ \S/,
];

// a markdown list item, heading or quote: prose the bubble draws, however it is indented
const PROSE_LINE = /^\s*([-*+>]|\d+[.)]|#{1,6})\s/;

/** Pure: whether pasted text reads as code or a log: two lines or more, most of them (60%) a line of code. A paste that
 *  already holds a fence is markdown, and is left as it is. */
export function looksLikeCode(text: string): boolean {
    const norm = text.replace(/\r\n?/g, "\n");
    if (/^ {0,3}(```|~~~)/m.test(norm)) {
        return false;
    }
    const lines = norm.split("\n").filter((l) => l.trim() !== "");
    if (lines.length < 2) {
        return false;
    }
    const code = lines.filter((l) => !PROSE_LINE.test(l) && CODE_LINE.some((re) => re.test(l))).length;
    return code / lines.length >= 0.6;
}

export interface CodePaste {
    /** the pasted text as the editor takes it (line ends made `\n`) */
    raw: string;
    /** the same text in a ``` block, on lines of its own */
    fenced: string;
}

/** Pure: what a paste at [start, end) of the box's `text` puts in when it is code: the raw text and the fenced one (the
 *  box puts in the raw text first and then the fenced, so one undo brings the raw paste back). Null for a paste that is
 *  not code, or one inside a fenced block already. The fence goes on lines of its own: a newline before it when the line
 *  has text before the caret, one after it when text follows. */
export function codePaste(text: string, start: number, end: number, pasted: string): CodePaste | null {
    const lines = text.split("\n");
    const line = text.slice(0, start).split("\n").length - 1;
    const opened = afterOpenFence(text, lines, line, start, end, pasted);
    if (opened != null) {
        return opened;
    }
    if (!looksLikeCode(pasted)) {
        return null;
    }
    if (fenceRanges(lines).some((r) => line >= r.open && line <= (r.close ?? lines.length - 1))) {
        return null;
    }
    const raw = pasted.replace(/\r\n?/g, "\n");
    // blank lines and trailing space around the code are no part of it; the first line keeps its indent
    const body = raw.replace(/^(?:[ \t]*\n)+/, "").replace(/\s+$/, "");
    const lineStart = text.lastIndexOf("\n", start - 1) + 1;
    const nextBreak = text.indexOf("\n", end);
    const before = text.slice(lineStart, start);
    const after = text.slice(end, nextBreak < 0 ? text.length : nextBreak);
    const fenced = `${before !== "" ? "\n" : ""}\`\`\`\n${body}\n\`\`\`${after !== "" ? "\n" : ""}`;
    return { raw, fenced };
}

// a line that is only an opening fence, with or without its language
const BARE_OPENER = /^ {0,3}(`{3,}|~{3,})[^`\s]*$/;

/** A paste right after an opening fence the person typed (```, ```bash) that nothing closes yet: whatever it is, it goes
 *  on the lines under the fence and the fence is closed after it, so the block ends with the paste instead of running
 *  on to the end of the message. A single word stays where it is: it reads as the block's language. */
function afterOpenFence(
    text: string,
    lines: string[],
    line: number,
    start: number,
    end: number,
    pasted: string
): CodePaste | null {
    const lineStart = text.lastIndexOf("\n", start - 1) + 1;
    const lineEnd = text.indexOf("\n", start);
    if ((lineEnd < 0 ? text.length : lineEnd) !== end) {
        return null;
    }
    const opener = BARE_OPENER.exec(text.slice(lineStart, start));
    if (opener == null || !fenceRanges(lines).some((r) => r.open === line && r.close == null)) {
        return null;
    }
    const raw = pasted.replace(/\r\n?/g, "\n");
    const body = raw.replace(/^(?:[ \t]*\n)+/, "").replace(/\s+$/, "");
    if (!/\s/.test(body)) {
        return null;
    }
    return { raw, fenced: `\n${body}\n${opener[1]}` };
}
