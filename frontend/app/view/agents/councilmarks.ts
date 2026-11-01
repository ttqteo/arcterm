// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// ==…== in what a seat wrote: the sentence the person must read, which the council's prompts ask for (markRule in
// pkg/council/prompts.go) and the Discussion and the report draw highlighted. The rule is remark-mark.ts's: a mark opens
// on == followed by a non-space and closes on a non-space followed by ==, inside one paragraph, so `a == b` is no mark
// and an unclosed == stays as written. Pure, no React, so every rule here has a test (councilmarks.test.ts).

const MARK = /==(?=[^\s=])((?:(?!\n[ \t]*\n)[\s\S])*?[^\s=])==/g;

/** A run of a text: plain, or a marked sentence (its == dropped). */
export interface MarkSpan {
    text: string;
    mark: boolean;
}

/** Pure: a text as its plain runs and its marked ones, in order; one plain run when it has no mark. */
export function markSpans(text: string): MarkSpan[] {
    const out: MarkSpan[] = [];
    let at = 0;
    for (const m of text.matchAll(MARK)) {
        const start = m.index ?? 0;
        if (start > at) {
            out.push({ text: text.slice(at, start), mark: false });
        }
        out.push({ text: m[1], mark: true });
        at = start + m[0].length;
    }
    if (at < text.length || out.length === 0) {
        out.push({ text: text.slice(at), mark: false });
    }
    return out;
}

/** Pure: a text with its marks dropped and their sentences kept, for a place that cuts it short (a matrix cell's first
 *  sentence), where a mark could be cut in half. */
export function stripMarks(text: string): string {
    return text.replace(MARK, "$1");
}
