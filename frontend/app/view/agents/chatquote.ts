// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Reply to a passage: text selected anywhere in Chat's conversation (Claude's reply, your own message, a tool's
// output) goes into the chat box as a markdown quote, the caret on a fresh line under it for your question. The agent
// reads the quote as the `> ` lines it is, and your bubble draws it as a blockquote, set apart from what you wrote.
// A passage selected in the File tab (a markdown Preview, or Source) goes in the same way, under a line naming the file
// and lines it came from (docs/superpowers/specs/2026-11-25-file-quote-design.md).

import { chatBoxText, hasChatBox, replaceChatBox } from "./chatinsert";
import { joinPastes, splitPastes } from "./chatpastes";

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

// where a quote from a file came from: the path the agent can open (agentrailtabs.ts quotePath) and its lines
export interface QuoteSource {
    path: string;
    startLine: number;
    endLine: number;
}

// the line a file's quote starts with: `path:N` for one line, `path:N-M` for a range
export function quoteLocation(from: QuoteSource): string {
    const end = Math.max(from.startLine, from.endLine);
    return end === from.startLine ? `${from.path}:${from.startLine}` : `${from.path}:${from.startLine}-${end}`;
}

// the quote block: its location line first when it came from a file; "" when the selection holds no text
export function quoteBlock(selected: string, from?: QuoteSource): string {
    const quote = quoteLines(selected);
    return quote === "" || from == null ? quote : quoteLocation(from) + "\n" + quote;
}

// the box's text with the quote added at its end, a blank line before your question (markdown would fold a line
// written straight under a quote into it); null when the selection holds no text. What is already in the box stays:
// a second Reply adds a second quote under the first, or under the question typed so far. `from`: the file and lines
// a quote from the File tab names on its first line.
export function withQuote(box: string, selected: string, from?: QuoteSource): string | null {
    const quote = quoteBlock(selected, from);
    if (quote === "") {
        return null;
    }
    const kept = box.replace(/\s+$/, "");
    return (kept === "" ? "" : kept + "\n\n") + quote + "\n\n";
}

// withQuote for Chat's box, whose folded pastes sit at the draft's end (chatpastes.ts): the quote goes after what is
// typed and before the pastes, so it lands in the text where the person is, and quote, text, quote, text reads in the
// order it was written; null when the selection holds no text
export function withChatQuote(full: string, selected: string, from?: QuoteSource): string | null {
    const { body, pastes } = splitPastes(full);
    const next = withQuote(body, selected, from);
    return next == null ? null : joinPastes(next, pastes);
}

// a passage from a file into the agent's chat box, the caret on the blank line under it (the box takes the focus);
// false when the agent has no chat box (its cell shows Terminal), the selection holds no text, or the box would not
// take it (a wake in flight)
export function quoteFileInChat(agentId: string, selected: string, from: QuoteSource): boolean {
    if (!hasChatBox(agentId)) {
        return false;
    }
    const next = withChatQuote(chatBoxText(agentId), selected, from);
    return next != null && replaceChatBox(agentId, next);
}
