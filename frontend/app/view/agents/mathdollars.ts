// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Readies a message for remark-math: remark-math takes any `$…$` as math, so "$5 and $10" or a stray `$HOME` would
// draw as a formula. This pass keeps the `$` pandoc reads as math and escapes the rest (`\$`, which markdown draws as
// a plain `$`): an opening `$` has a non-space after it, a closing `$` a non-space before it and no digit after it,
// and the pair sits on one line. `$$…$$` on one line pairs the same way, and a line holding only `$$…$$` becomes a
// display block. Code spans, fenced code and `$$` display blocks pass through untouched.

const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const MATH_FENCE = /^ {0,3}\$\$\s*$/;
const ONE_LINE_DISPLAY = /^( {0,3})\$\$(.*\S.*)\$\$\s*$/;
const WS = /\s/;

export function guardDollars(text: string): string {
    if (!text.includes("$")) {
        return text;
    }
    const out: string[] = [];
    let fence: string | null = null;
    let inMath = false;
    for (const line of text.split("\n")) {
        if (fence != null) {
            out.push(line);
            if (new RegExp(`^ {0,3}${fence[0] === "`" ? "`" : "~"}{${fence.length},}\\s*$`).test(line)) {
                fence = null;
            }
            continue;
        }
        if (inMath) {
            out.push(line);
            inMath = !MATH_FENCE.test(line);
            continue;
        }
        const opened = FENCE.exec(line);
        if (opened != null) {
            fence = opened[1];
            out.push(line);
            continue;
        }
        if (MATH_FENCE.test(line)) {
            inMath = true;
            out.push(line);
            continue;
        }
        const display = ONE_LINE_DISPLAY.exec(line);
        if (display != null && !display[2].includes("$$")) {
            out.push(`${display[1]}$$`, `${display[1]}${display[2].trim()}`, `${display[1]}$$`);
            continue;
        }
        out.push(guardLine(line));
    }
    return out.join("\n");
}

// the index of the `$` (or `$$` when `double`) that closes math opened before `from`, or -1
function closerOf(line: string, from: number, double: boolean): number {
    for (let j = from; j < line.length; j++) {
        const ch = line[j];
        if (ch === "\\") {
            j++;
            continue;
        }
        if (ch !== "$") {
            continue;
        }
        if (double) {
            if (line[j + 1] === "$" && !WS.test(line[j - 1])) {
                return j;
            }
            return -1;
        }
        if (line[j + 1] === "$") {
            return -1;
        }
        if (!WS.test(line[j - 1]) && !/\d/.test(line[j + 1] ?? "")) {
            return j;
        }
        // a `$` that cannot close cannot sit inside math either
        return -1;
    }
    return -1;
}

function guardLine(line: string): string {
    if (!line.includes("$")) {
        return line;
    }
    let out = "";
    let i = 0;
    while (i < line.length) {
        const ch = line[i];
        if (ch === "\\") {
            out += line.slice(i, i + 2);
            i += 2;
            continue;
        }
        if (ch === "`") {
            let n = 1;
            while (line[i + n] === "`") {
                n++;
            }
            const ticks = "`".repeat(n);
            let end = line.indexOf(ticks, i + n);
            while (end >= 0 && line[end + n] === "`") {
                end = line.indexOf(ticks, end + n + 1);
            }
            if (end < 0) {
                out += line.slice(i, i + n);
                i += n;
                continue;
            }
            out += line.slice(i, end + n);
            i = end + n;
            continue;
        }
        if (ch !== "$") {
            out += ch;
            i++;
            continue;
        }
        const double = line[i + 1] === "$";
        const start = i + (double ? 2 : 1);
        const close = start < line.length && !WS.test(line[start]) ? closerOf(line, start, double) : -1;
        if (close < 0) {
            out += double ? "\\$\\$" : "\\$";
            i = start;
            continue;
        }
        const end = close + (double ? 2 : 1);
        out += line.slice(i, end);
        i = end;
    }
    return out;
}
