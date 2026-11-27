// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// What Chat's Save as idea and Add note write from a selected passage (chatquotemenu.tsx): a title from its first
// sentence, and a body that quotes it under where it was said, the way a kept session idea's note reads
// (pkg/sessionideas KeepNote: `From session "…" (<id>), <day>`, then the quote). The agent's id is written as its
// `agent:<tabid>` address, so an agent can `wsh read` it after the session's tab is gone.

// both stores cap a title at 200 bytes (EffortCreateCommand, notestore.maxTitleLen). A UTF-16 unit is at most 3 bytes
// of UTF-8 (Vietnamese "ữ" is 3), so 64 units stay under the cap in any script, and a title is a line to scan anyway
export const SAVED_TITLE_MAX = 64;

export interface SavedFrom {
    agentId: string;
    name: string;
}

function squash(text: string): string {
    return text.replace(/\s+/g, " ").trim();
}

/** The title a saved passage gets: its first line's first sentence, cut at a word under SAVED_TITLE_MAX with an
 *  ellipsis. Empty when the passage holds no words. */
export function selectionTitle(text: string): string {
    const line =
        text
            .split(/\r?\n/)
            .map(squash)
            .find((l) => l !== "") ?? "";
    // a sentence ends at . ! ? followed by a space; "v1.2" or "pkg/x.go" do not end one
    const sentence = /^(.+?[.!?])\s/.exec(line + " ")?.[1] ?? line;
    if (sentence.length <= SAVED_TITLE_MAX) {
        return sentence;
    }
    let cut = sentence.slice(0, SAVED_TITLE_MAX - 1);
    // never half an emoji: a cut after a high surrogate drops it
    if (/[\uD800-\uDBFF]$/.test(cut)) {
        cut = cut.slice(0, -1);
    }
    const space = cut.lastIndexOf(" ");
    return (space > SAVED_TITLE_MAX / 2 ? cut.slice(0, space) : cut).replace(/[\s,;:.]+$/, "") + "…";
}

/** The passage as a block quote: each line's spaces squashed, runs of blank lines kept as one quoted blank line. */
export function selectionQuoteBlock(text: string): string {
    const out: string[] = [];
    for (const raw of text.split(/\r?\n/)) {
        const line = squash(raw);
        if (line === "" && (out.length === 0 || out[out.length - 1] === ">")) {
            continue;
        }
        out.push(line === "" ? ">" : "> " + line);
    }
    while (out.length > 0 && out[out.length - 1] === ">") {
        out.pop();
    }
    return out.join("\n");
}

function localDay(now: Date): string {
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** The body a saved passage carries, as an idea's first note or a note's text: where it was said, then the quote.
 *  `withAddress` false leaves the `agent:<tabid>` address out: a note keeps the conversation's id in its frontmatter,
 *  which outlives the tab (the address only opens while the tab is up). */
export function savedBody(text: string, from: SavedFrom, now: Date, withAddress = true): string {
    const name = squash(from.name);
    const where = [name !== "" ? `"${name}"` : "", withAddress ? `(agent:${from.agentId})` : ""].filter(Boolean);
    const source = `From agent${where.length > 0 ? " " + where.join(" ") : ""}, ${localDay(now)}`;
    return `${source}\n\n${selectionQuoteBlock(text)}`;
}
