// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Reply to a passage: text selected anywhere in Chat's conversation (Claude's reply, your own message, a tool's
// output) goes into the chat box as a markdown quote, the caret on a fresh line under it for your question. The agent
// reads the quote as the `> ` lines it is, and your bubble draws it as a blockquote, set apart from what you wrote.

// the selection as quote lines: its blank edges trimmed, runs of blank lines kept to one (a bare `>`), each line `> `;
// "" when the selection holds no text
export function quoteLines(selected: string): string {
    const lines = selected
        .replace(/\r\n?/g, "\n")
        .replace(/\u00a0/g, " ")
        .split("\n")
        .map((l) => l.replace(/\s+$/, ""));
    while (lines.length > 0 && lines[0].trim() === "") {
        lines.shift();
    }
    while (lines.length > 0 && lines[lines.length - 1].trim() === "") {
        lines.pop();
    }
    const out: string[] = [];
    for (const l of lines) {
        if (l.trim() === "") {
            if (out[out.length - 1] !== ">") {
                out.push(">");
            }
            continue;
        }
        out.push("> " + l);
    }
    return out.join("\n");
}

// the box's text with the quote added at its end, a blank line before your question (markdown would fold a line
// written straight under a quote into it); null when the selection holds no text. What is already in the box stays:
// a second Reply adds a second quote under the first, or under the question typed so far.
export function withQuote(box: string, selected: string): string | null {
    const quote = quoteLines(selected);
    if (quote === "") {
        return null;
    }
    const kept = box.replace(/\s+$/, "");
    return (kept === "" ? "" : kept + "\n\n") + quote + "\n\n";
}
