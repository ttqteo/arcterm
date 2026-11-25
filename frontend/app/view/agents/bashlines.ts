// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// A command a reply asks the person to type (`! task install`) belongs in a code span or a fenced block, and Chat draws
// one as a command row with Run and Copy (codeblock.tsx, coderun.ts isPromptedCommand). An agent sometimes writes it as
// a bare line instead, and Markdown then reads it as prose: the `**` or `_` inside a quoted string draw as bold or italic
// and drop out, so the command on screen is no longer the one written. This pass fences such lines before the Markdown
// is read: a line that starts at its first column with `! ` and a non-space, outside a fenced block, together with the
// `! ` lines right under it, becomes one fenced block with no language, the command as written. A `!` with no space after
// it (`!important`), an indented one, or one in a list or a quote stays prose.

const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const BANG = /^! \S/;

function fenceFor(lines: string[]): string {
    let longest = 0;
    for (const line of lines) {
        for (const run of line.match(/`+/g) ?? []) {
            longest = Math.max(longest, run.length);
        }
    }
    return "`".repeat(Math.max(3, longest + 1));
}

export function fenceBangLines(text: string): string {
    if (!text.includes("! ")) {
        return text;
    }
    const lines = text.split("\n");
    const out: string[] = [];
    let fence: string | null = null;
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (fence != null) {
            out.push(line);
            if (new RegExp(`^ {0,3}${fence[0] === "`" ? "`" : "~"}{${fence.length},}\\s*$`).test(line)) {
                fence = null;
            }
            continue;
        }
        const opened = FENCE.exec(line);
        if (opened != null) {
            fence = opened[1];
            out.push(line);
            continue;
        }
        if (!BANG.test(line)) {
            out.push(line);
            continue;
        }
        const run: string[] = [];
        while (i < lines.length && BANG.test(lines[i])) {
            run.push(lines[i].replace(/\s+$/, ""));
            i++;
        }
        i--;
        const f = fenceFor(run);
        out.push(f, ...run, f);
    }
    return out.join("\n");
}
