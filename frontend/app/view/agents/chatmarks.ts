// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The markdown the message box draws while you type it (chateditormarks.tsx), and the paste it fences for you. A ```
// block is a code box (chatfences.ts finds it); outside one, a line that starts with `>` is a quote and a `code` span is
// inline code, drawn as the bubble draws them once the message is sent. The text never changes for them: they are
// formats on the editor's text nodes. A paste of several lines that reads as code or a log (a stack trace, a build's
// output) goes in wrapped in a ``` block, so it is sent as one.

import { fenceRanges } from "./chatfences";

/** How one line of the message is drawn: a line of a fenced block, a quote line, and the inline code spans on it (as
 *  [start, end) offsets in the line, backticks included). A fenced line is neither a quote nor holds inline spans. */
export interface LineMark {
    fenced: boolean;
    quote: boolean;
    /** a quote line's `>` and the one space after it, the characters the bar stands for (as the bubble draws a quote,
     *  without them): their length from the line's start, 0 on any other line */
    marker: number;
    spans: [number, number][];
}

/** How a run of characters is drawn */
export interface Mark {
    /** the mono face: a fenced line, or an inline span */
    code: boolean;
    /** an inline span (its own chip), not a fenced line */
    inline: boolean;
    quote: boolean;
    /** a quote's `>` and its space: kept in the text, drawn as nothing */
    marker: boolean;
}

export interface MarkRun {
    start: number;
    end: number;
    mark: Mark;
}

// up to three spaces, then `>`; and that with the one space after it, the marker the bubble does not draw
const QUOTE = /^ {0,3}>/;
const QUOTE_MARKER = /^ {0,3}> ?/;

/** Pure: the inline code spans on a line, as markdown reads them: a run of backticks opens one and the next run of the
 *  same length closes it; a run with no partner is plain text. */
export function inlineCodeSpans(line: string): [number, number][] {
    const out: [number, number][] = [];
    let i = 0;
    while (i < line.length) {
        if (line[i] !== "`") {
            i++;
            continue;
        }
        let n = 0;
        while (line[i + n] === "`") {
            n++;
        }
        let close = -1;
        for (let j = i + n; j < line.length; ) {
            if (line[j] !== "`") {
                j++;
                continue;
            }
            let m = 0;
            while (line[j + m] === "`") {
                m++;
            }
            if (m === n) {
                close = j;
                break;
            }
            j += m;
        }
        if (close < 0) {
            i += n;
            continue;
        }
        out.push([i, close + n]);
        i = close + n;
    }
    return out;
}

/** Pure: how each of a message's lines is drawn. `inline: false` draws only the fenced blocks (a bash command, whose
 *  text a mirror under the editor draws: a format that changes the glyphs' widths would part the two). */
export function lineMarks(lines: string[], opts: { inline?: boolean } = {}): LineMark[] {
    const inline = opts.inline ?? true;
    const fenced = new Set<number>();
    for (const range of fenceRanges(lines)) {
        const last = range.close ?? lines.length - 1;
        for (let line = range.open; line <= last; line++) {
            fenced.add(line);
        }
    }
    return lines.map((line, i) => {
        if (fenced.has(i)) {
            return { fenced: true, quote: false, marker: 0, spans: [] };
        }
        if (!inline) {
            return { fenced: false, quote: false, marker: 0, spans: [] };
        }
        const marker = QUOTE_MARKER.exec(line)?.[0].length ?? 0;
        return { fenced: false, quote: marker > 0, marker, spans: inlineCodeSpans(line) };
    });
}

function sameMark(a: Mark, b: Mark): boolean {
    return a.code === b.code && a.inline === b.inline && a.quote === b.quote && a.marker === b.marker;
}

/** Pure: how the characters [from, to) of a line are drawn, as runs of one mark each (one run when it is all one). */
export function markRuns(mark: LineMark, from: number, to: number): MarkRun[] {
    const cuts = new Set<number>([from, to]);
    if (mark.marker > from && mark.marker < to) {
        cuts.add(mark.marker);
    }
    for (const [a, b] of mark.spans) {
        for (const at of [a, b]) {
            if (at > from && at < to) {
                cuts.add(at);
            }
        }
    }
    const points = [...cuts].sort((a, b) => a - b);
    if (points.length === 1) {
        // an empty range: one empty run, drawn as what starts there
        points.push(from);
    }
    const out: MarkRun[] = [];
    for (let k = 0; k + 1 < points.length; k++) {
        const start = points[k];
        const end = points[k + 1];
        const inSpan = mark.spans.some(([a, b]) => start >= a && start < b);
        const m: Mark = {
            code: mark.fenced || inSpan,
            inline: !mark.fenced && inSpan,
            quote: mark.quote,
            marker: start < mark.marker,
        };
        const last = out[out.length - 1];
        if (last != null && sameMark(last.mark, m)) {
            last.end = end;
        } else {
            out.push({ start, end, mark: m });
        }
    }
    return out;
}

/** Pure: the quotes as [first, last] line pairs, a run of quote lines being one quote */
export function quoteBlocks(marks: LineMark[]): [number, number][] {
    const out: [number, number][] = [];
    marks.forEach((m, i) => {
        if (!m.quote) {
            return;
        }
        const last = out[out.length - 1];
        if (last != null && last[1] === i - 1) {
            last[1] = i;
        } else {
            out.push([i, i]);
        }
    });
    return out;
}

/** Pure: the message with a blank line after each quote that a line of text follows at once, outside fenced blocks, so
 *  markdown ends the quote there as the box drew it: `>xx` then `sss` is a quote of `xx` and a line `sss`, where markdown
 *  alone would carry `sss` into the quote (a lazy continuation line). */
export function endQuotes(text: string): string {
    const lines = text.split("\n");
    const marks = lineMarks(lines);
    const out: string[] = [];
    lines.forEach((line, i) => {
        out.push(line);
        const next = marks[i + 1];
        if (marks[i].quote && next != null && !next.quote && !next.fenced && lines[i + 1].trim() !== "") {
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
