// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// How an opened command step in Chat (chatstepsview.tsx CommandDetail) colours its output. A command that prints
// source (`sed -n 40,80p x.ts`, `cat a.go`, `grep -n foo b.tsx`) runs with no terminal, so its output carries no
// colour of its own: it is drawn as code, each line's location (`12:`, `src/a.ts:12:`, `cat -n`'s `    12\t`) dim
// in front of the highlighted text. Any other output goes to OutputLines (its ANSI colours, or the tones its text
// calls for: a failure red, a pass mark green).

import { highlightLine, type CodeToken } from "./highlight";

// the programs that print a file's text (or lines of it)
const READER = /(?:^|[;&|(]\s*|\bxargs\s+)(?:cat|sed|head|tail|grep|egrep|rg|nl|awk|bat|less|git\s+show|git\s+grep)\b/;

// a source file named on the command line: a code extension at a word's end (`a.ts`, `"x/b.go"`, `c.tsx:12`)
const CODE_FILE =
    /\.(?:tsx?|jsx?|mjs|cjs|go|rs|py|java|kt|swift|c|h|cc|cpp|hpp|cs|rb|php|sh|bash|ps1|css|scss|json|jsonl|ya?ml|toml|sql|html|vue|svelte|astro|lua|zig)(?::\d+)?(?=$|[\s"'),;|*])/i;

/** Pure: whether the command prints source code, so its output is drawn as code. */
export function readsCode(command: string): boolean {
    return READER.test(command) && CODE_FILE.test(command);
}

// a line's location in front of its text: grep's `12:` / `12-` (with a path before it, a drive letter allowed), or
// `cat -n` / `nl`'s right-aligned number and tab
const LOCATION = /^(?:(?:[A-Za-z]:)?[^\s:]+[:-])?\d+[:-]|^\s*\d+\t/;

/** Pure: a line split into its location (empty when it has none) and the code after it. */
export function splitLocation(line: string): { loc: string; code: string } {
    const m = LOCATION.exec(line);
    return m == null ? { loc: "", code: line } : { loc: m[0], code: line.slice(m[0].length) };
}

/** Pure: one output line of a code-printing command as tokens, its location dim. */
export function codeOutputLine(line: string): CodeToken[] {
    const { loc, code } = splitLocation(line);
    const body = code === "" ? [] : highlightLine(code);
    return loc === "" ? highlightLine(line) : [{ t: loc, cls: "text-muted" }, ...body];
}
