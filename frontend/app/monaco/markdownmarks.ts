// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Pure: the ==text== marks of a markdown source, for the Source view to draw as the Preview does (remark-mark.ts):
// the text highlighted, the marks faint. The same rule, one line at a time: a mark opens on == followed by a
// non-space and closes on a non-space followed by ==; fenced code and inline code hold none.

const FENCE = /^\s{0,3}(```|~~~)/;

// 1-based, as Monaco counts: `open` and `close` are the columns of each mark's first "="
export type MarkSpan = { line: number; open: number; close: number };

export function markSpans(text: string): MarkSpan[] {
    const spans: MarkSpan[] = [];
    let inFence = false;
    text.split("\n").forEach((line, i) => {
        if (FENCE.test(line)) {
            inFence = !inFence;
            return;
        }
        if (inFence || !line.includes("==")) {
            return;
        }
        let open = -1;
        let at = 0;
        while (at < line.length) {
            if (line[at] === "`") {
                const end = line.indexOf("`", at + 1);
                if (end > at) {
                    at = end + 1;
                    continue;
                }
            }
            if (line.startsWith("==", at)) {
                if (open < 0 && !/^$|\s|=/.test(line.charAt(at + 2))) {
                    open = at;
                    at += 2;
                    continue;
                }
                if (open >= 0 && !/\s/.test(line.charAt(at - 1))) {
                    spans.push({ line: i + 1, open: open + 1, close: at + 1 });
                    open = -1;
                    at += 2;
                    continue;
                }
            }
            at++;
        }
    });
    return spans;
}
