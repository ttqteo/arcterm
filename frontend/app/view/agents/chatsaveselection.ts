// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// What Chat's Save as idea, Save for later and Add note write from a selected passage (chatquotemenu.tsx): a title from
// its first sentence, and a body that quotes it under where it was said, the way a kept session idea's note reads
// (pkg/sessionideas KeepNote: `From session "…" (<id>), <day>`, then the quote). The agent's id is written as its
// `agent:<tabid>` address, so an agent can `wsh read` it after the session's tab is gone. Save for later's item, its
// toast line and its menu sublabel are here too.

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

/** The one item Save for later keeps from a passage: its label is the passage's title, its first note the saved body.
 *  With the conversation's id the body leaves the tab's address out, as Add note's does: the chunk's note records the
 *  conversation next to the `agent:<tabid>` session, and the conversation outlives the tab. */
export function laterItem(
    text: string,
    from: SavedFrom,
    conversation: string | undefined,
    now: Date
): { label: string; note: string } {
    return { label: selectionTitle(text), note: savedBody(text, from, now, !conversation) };
}

// the toast's second line keeps one line of the passage: long enough to tell it, short enough for a 320px toast
const TOAST_LINE_MAX = 90;

/** The passage's first line, spaces squashed, for the toast under "Saved for later in …": cut at `max` characters with
 *  an ellipsis, never half an emoji. Empty when the passage holds no words. */
export function passageFirstLine(text: string, max = TOAST_LINE_MAX): string {
    const line =
        text
            .split(/\r?\n/)
            .map(squash)
            .find((l) => l !== "") ?? "";
    if (line.length <= max) {
        return line;
    }
    let cut = line.slice(0, max - 1);
    if (/[\uD800-\uDBFF]$/.test(cut)) {
        cut = cut.slice(0, -1);
    }
    return cut.trimEnd() + "…";
}

// a title longer than this is cut in the sublabel, which the menu draws on one line beside the label (the board's is
// capped the same way)
export const LATER_SUBLABEL_TITLE_MAX = 30;

/** Save for later's sublabel on the menu: where the click goes. "to <title>" for an agent linked to an initiative (so the
 *  person sees it before clicking; a long title is cut with an ellipsis), "to its initiative" while that title has not
 *  loaded; absent for an agent that is not linked, whose click opens the picker. */
export function laterSublabel(linked: boolean, title: string | undefined): string | undefined {
    if (!linked) {
        return undefined;
    }
    const t = squash(title ?? "");
    if (t === "") {
        return "to its initiative";
    }
    return `to ${t.length <= LATER_SUBLABEL_TITLE_MAX ? t : cutAtWord(t, LATER_SUBLABEL_TITLE_MAX)}`;
}

// `text` cut to at most `max` characters ending in an ellipsis, at a word when one is near, never half an emoji
function cutAtWord(text: string, max: number): string {
    let cut = text.slice(0, max - 1);
    if (/[\uD800-\uDBFF]$/.test(cut)) {
        cut = cut.slice(0, -1);
    }
    const space = cut.lastIndexOf(" ");
    return (space > max / 2 ? cut.slice(0, space) : cut).replace(/[\s,;:.]+$/, "") + "…";
}
