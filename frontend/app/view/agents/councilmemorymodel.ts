// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// What the council's Memory tab draws (councilmemory.tsx; boards Memory-tab and Memory-held in
// .superpowers/design/council-ideas-memory), derived from `Council.memory`: the one card that waits, whether the tab's
// dot is on, the empty state, the chosen direction's line (who set it, when, from what), the Replaced rows, and the text
// Chốt pins from an idea or a message. Pure, no React, no Wave runtime imports (councilmemorymodel.test.ts). The memory's
// shape is pkg/council/types.go's CouncilMemory; how a direction changes is pkg/council/memory.go's.

import { CHAT_THREAD, councilList } from "./councillistmodel";
import { authorName, readableReplies } from "./councilmodel";
import { clockTime } from "./councilsummarymodel";

// how a direction was set (CouncilMemoryDirection.how, CouncilMemoryCard.how) and where a suggestion came from (source)
const HOW_PIN = "pin";
const HOW_WRITTEN = "written";
const HOW_SUGGESTED = "suggested";
const SOURCE_CHECK = "check";
const SOURCE_GREEN = "green";
const KIND_HELD = "held";

const YOU = "you";

// the longest a Chốt text runs: a message cut to one line stops here (the person can Edit what is pinned after)
const CHOT_MAX = 200;

/** Pure: the card the tab shows: the held direction first (the person's own text, never pushed out by a suggestion),
 *  else the suggestion, else none. A suggestion that came while a card was held shows once the held one is settled. */
export function shownCard(c: Council): CouncilMemoryCard | undefined {
    return c.memory?.held ?? c.memory?.suggestion;
}

/** Pure: whether the tab's dot is on: a suggestion or a held direction waits for the person. */
export function memoryDot(c: Council): boolean {
    return shownCard(c) != null;
}

/** Pure: whether the tab shows its empty state (the input and `Pin a message with Chốt…`): no chosen direction and no
 *  card waiting. The directions it replaced, if any, still show under it. */
export function memoryEmpty(c: Council): boolean {
    return c.memory?.chosen == null && shownCard(c) == null;
}

/** Pure: the line over a card: `Suggested after round 2 · the chat may have moved` for the round check's suggestion,
 *  `Suggested · every seat agreed` for an all green one, `Held · this may clash with what the seats agreed` for a held
 *  direction. A check suggestion with no round leaves `after round N` out. */
export function cardKicker(card: CouncilMemoryCard): string {
    if (card.kind === KIND_HELD) {
        return "Held · this may clash with what the seats agreed";
    }
    if (card.source === SOURCE_GREEN) {
        return "Suggested · every seat agreed";
    }
    if (card.source === SOURCE_CHECK) {
        const after = card.round != null && card.round > 0 ? ` after round ${card.round}` : "";
        return `Suggested${after} · the chat may have moved`;
    }
    return "Suggested";
}

/** Pure: who set a direction, in words: `Pinned by you`, `Written by you`, `Accepted from the check after round 2`,
 *  `Accepted: every seat agreed`. A direction of a way this does not know is still named. */
export function directionHow(d: Pick<CouncilMemoryDirection, "how" | "source" | "round">): string {
    switch (d.how) {
        case HOW_PIN:
            return "Pinned by you";
        case HOW_WRITTEN:
            return "Written by you";
        case HOW_SUGGESTED:
            if (d.source === SOURCE_GREEN) {
                return "Accepted: every seat agreed";
            }
            if (d.source === SOURCE_CHECK) {
                return d.round != null && d.round > 0
                    ? `Accepted from the check after round ${d.round}`
                    : "Accepted from the check";
            }
            return "Accepted";
        default:
            return "Set by you";
    }
}

/** The idea or message a direction came from, as the tab links it: `thread` is what the open-thread atom takes (the
 *  idea's id, or the Chat's for a message tied to no idea). */
export interface DirectionSource {
    kind: "idea" | "message";
    id: string;
    thread: string;
    label: string; // `Idea 3`, `RAM's message`, `Your message`
}

// the item `from` names, or null when it is no idea or message a person can reach (a written direction names none; a
// dropped idea or reply is gone)
function directionSource(c: Council, from: string | undefined): DirectionSource | null {
    if (from == null || from === "") {
        return null;
    }
    const idea = councilList(c, 0).ideas.find((r) => r.id === from);
    if (idea != null) {
        return { kind: "idea", id: idea.id, thread: idea.id, label: `Idea ${idea.n}` };
    }
    const message = readableReplies(c).find((r) => r.id === from);
    if (message != null) {
        const label = message.author === YOU ? "Your message" : `${authorName(c, message.author)}'s message`;
        return { kind: "message", id: message.id, thread: message.proposalid || CHAT_THREAD, label };
    }
    return null;
}

/** The chosen direction's line: how it was set, when, and the item it came from. */
export interface ChosenLine {
    how: string; // `Pinned by you`, `Accepted from the check after round 2`
    time: string; // `10:05`
    source: DirectionSource | null;
}

/** Pure: the line under the chosen direction `d` of council `c`: `Pinned by you`, its time and the source item the tab
 *  links (none for one the person wrote, nor when the item is gone). */
export function chosenLine(c: Council, d: CouncilMemoryDirection): ChosenLine {
    return { how: directionHow(d), time: clockTime(d.at), source: directionSource(c, d.from) };
}

/** One Replaced row: a direction that left the chosen slot. */
export interface ReplacedRow {
    text: string;
    how: string; // how it was set
    ended: string; // `replaced`, `edited` or `unpinned`
    time: string; // when it left
    line: string; // `Pinned by you · replaced 09:40`
}

/** Pure: the directions the council replaced, newest first (by when each left; a tie keeps the record's order), each
 *  with how it was set and `replaced` / `edited` / `unpinned` and when. One that left with no recorded end reads
 *  `replaced`. */
export function replacedRows(c: Council): ReplacedRow[] {
    return (c.memory?.replaced ?? [])
        .map((d, i) => ({ d, i }))
        .sort((a, b) => (b.d.replaced ?? 0) - (a.d.replaced ?? 0) || a.i - b.i)
        .map(({ d }) => {
            const how = directionHow(d);
            const ended = d.ended != null && d.ended !== "" ? d.ended : "replaced";
            const time = clockTime(d.replaced ?? 0);
            return { text: d.text, how, ended, time, line: `${how} · ${ended} ${time}` };
        });
}

/** Pure: the text Chốt pins from `item`: an idea's title, or a message's text on one line (cut with an ellipsis past
 *  200 characters). Empty for a message with no text. */
export function chotText(item: CouncilProposal | CouncilReply): string {
    const line = (("title" in item ? item.title : item.text) ?? "").replace(/\s+/g, " ").trim();
    if ("title" in item || line.length <= CHOT_MAX) {
        return line;
    }
    return `${line.slice(0, CHOT_MAX - 1).trimEnd()}…`;
}

/** Pure: what Chốt pins from an item the channel already drew (an `IdeaPost` or a `ReplyPost`, which hold the title or
 *  the text, not the record): that text on one line, cut as `chotText` cuts a message (an idea's title is one line
 *  already). Empty for an item with no text, which Chốt does not offer. */
export function chotLine(text: string): string {
    return chotText({ text } as CouncilReply);
}
