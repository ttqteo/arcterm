// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The colour of a line of a command's output that came with none. The engine runs Verify, Check and Final with no
// terminal, so vitest and `go test` print plain text: a line is read for what a terminal would have coloured, a test
// that passed (its ✓ or `ok` green), one that failed (red, the whole line), a warning or a skip, a heading (the command,
// a task's `task: [x]` line), and the time a test took at the end (dimmed). A line the program did colour keeps its own
// colours (ansitext.ts); this is only for the rest. finalstageviews.tsx FinalOutput draws it.

export type OutputTone = "pass" | "fail" | "warn" | "skip" | "head" | "plain";

export interface TonedLine {
    tone: OutputTone;
    /** the line's leading status mark (`✓`, `FAIL`, `ok`, `--- PASS:`), with the space before it; "" with none */
    mark: string;
    body: string;
    /** the duration that ends the line (` 12ms`, ` (0.31s)`), with the space before it; "" with none */
    time: string;
}

// a status at the start of a line: vitest's and node's marks, go test's words, and their tone
const MARKS: [RegExp, OutputTone][] = [
    [/^\s*(?:✓|✔|√|PASS\b|ok\b|--- PASS:)/, "pass"],
    [/^\s*(?:×|✗|✘|✖|FAIL\b|--- FAIL:)/, "fail"],
    [/^\s*(?:↓|--- SKIP:|\?\s)/, "skip"],
    [/^\s*(?:⚠|WARN(?:ING)?\b)/, "warn"],
];

const HEAD = /^(?:\$ |task: \[|=== RUN\b|\s*RUN\s+v\d|#{1,3} |==+ )/;
const FAIL_LINE = /^(?:panic:|\s*(?:\w*Error|\w*Exception)\b:?|\s*error(?:\[|:))|\b[1-9]\d* failed\b/i;
const WARN_LINE = /^\s*warn(?:ing)?\b/i;
const PASS_LINE = /\b\d+ passed\b/;
const TIME = /\s\(?\d+(?:\.\d+)?\s?(?:ms|s)\)?$/;

/** Pure: a line of output read for its tone, split into its status mark, its text and its closing time. */
export function toneLine(line: string): TonedLine {
    let tone: OutputTone = "plain";
    let mark = "";
    let body = line;
    if (line.trim() === "") {
        return { tone, mark, body, time: "" };
    }
    const found = MARKS.find(([re]) => re.test(line));
    if (found != null) {
        tone = found[1];
        mark = found[0].exec(line)?.[0] ?? "";
        body = line.slice(mark.length);
    } else if (HEAD.test(line)) {
        tone = "head";
    } else if (FAIL_LINE.test(line)) {
        tone = "fail";
    } else if (WARN_LINE.test(line)) {
        tone = "warn";
    } else if (PASS_LINE.test(line)) {
        tone = "pass";
    }
    // a heading keeps its whole text: `$ go test -timeout 30s` ends in a duration that is no test's time
    const time = tone === "head" ? null : TIME.exec(body);
    if (time == null) {
        return { tone, mark, body, time: "" };
    }
    return { tone, mark, body: body.slice(0, time.index), time: time[0] };
}
