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

// Chat's box draws the quotes that open the message as chips over the text, not as lines in it, so a quote does not
// take the box's rows. The message stays one string (the draft, the send, recall and take-back all keep it whole): a
// quote is a run of `>` lines at the start, or right after the quote before it, followed by a blank line and then
// something (`> a\n\n`, the box's text right after a Reply). A `>` line the person is still typing (`> a` or `> a\n`)
// stays text. The body keeps every character after the quotes' blank line, so joinQuotes(splitQuotes(t)) is t again
// and an edit in the body never moves into or out of a quote.
export function splitQuotes(text: string): { quotes: string[]; body: string } {
    const lines = text.split("\n");
    const quotes: string[] = [];
    let i = 0;
    for (;;) {
        let j = i;
        while (j < lines.length && lines[j].startsWith(">")) {
            j++;
        }
        if (j === i || j + 1 >= lines.length || lines[j] !== "") {
            break;
        }
        quotes.push(lines.slice(i, j).join("\n"));
        i = j + 1;
    }
    return { quotes, body: lines.slice(i).join("\n") };
}

export function joinQuotes(quotes: string[], body: string): string {
    return quotes.map((q) => q + "\n\n").join("") + body;
}

// withQuote for Chat's box: the new quote goes after the quotes already there and before what is typed, so it shows as
// one more chip; null when the selection holds no text
export function withLeadQuote(box: string, selected: string): string | null {
    const quote = quoteLines(selected);
    if (quote === "") {
        return null;
    }
    const { quotes, body } = splitQuotes(box);
    return joinQuotes([...quotes, quote], body);
}

// a quote's words without its `> ` marks, one line per line of the quote (blank lines dropped, so a list keeps its
// items apart without spending the chip's rows on gaps): the chip's label (drawn pre-line, clamped by CSS) and its
// tooltip
export function quoteWords(quote: string): string {
    return quote
        .split("\n")
        .map((l) => l.replace(/^>\s?/, "").trim())
        .filter((l) => l !== "")
        .join("\n");
}
