// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// What the council's Memory tab draws (councilmemory.tsx; boards C-merged, C-add and C-empty in
// .superpowers/design/council-memory), derived from `Council.memory`: the one card that waits, the entries newest first,
// the tab's label and dot, which entries are new, an entry's details, the empty state, the chosen direction's line (who
// set it, when, from what), the earlier directions, and the text Chốt pins from an idea or a message. Pure, no React, no
// Wave runtime imports (councilmemorymodel.test.ts). The memory's shape is pkg/council/types.go's CouncilMemory; how a
// direction changes is pkg/council/memory.go's.

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

/** Pure: the line over a card: `Suggested direction` for the round check's suggestion,
 *  `Suggested · every seat agreed` for an all green one, `Held · this may clash with what the seats agreed` for a held
 *  direction. */
export function cardKicker(card: CouncilMemoryCard): string {
    if (card.kind === KIND_HELD) {
        return "Held · this may clash with what the seats agreed";
    }
    if (card.source === SOURCE_GREEN) {
        return "Suggested · every seat agreed";
    }
    if (card.source === SOURCE_CHECK) {
        return "Suggested direction";
    }
    return "Suggested";
}

/** Pure: the ids a card's reason links to: the messages the suggestion rests on, else the idea it came from (an all
 *  green suggestion), else none. */
export function cardLinks(card: CouncilMemoryCard): string[] {
    if (card.messages != null && card.messages.length > 0) {
        return [...card.messages];
    }
    return card.from != null && card.from !== "" ? [card.from] : [];
}

/** The four kinds a Memory row can be: the direction pinned on top, then the entries (CouncilMemoryEntry.kind). */
export type MemoryKind = "direction" | "agreed" | "ruledout" | "open";

/** The badge word of each kind. */
export const KIND_LABEL: Record<MemoryKind, string> = {
    direction: "Direction",
    agreed: "Agreed",
    ruledout: "Ruled out",
    open: "Open",
};

/** The badge's tooltip, and the empty state's legend. */
export const KIND_MEANING: Record<MemoryKind, string> = {
    direction: "What the council will do. The seats follow it over the Report.",
    agreed: "Settled as true. The seats do not argue it again.",
    ruledout: "Dropped. The seats do not bring it back without something new.",
    open: "Still to settle. The seats work on it next.",
};

/** The kinds the Add form offers, in the order it draws them. */
export const ADD_KINDS: readonly MemoryKind[] = ["direction", "agreed", "ruledout", "open"];

/** Pure: whether the Add form (and an entry's editor) asks for a why: only a Ruled out entry carries one. */
export function kindTakesWhy(kind: MemoryKind): boolean {
    return kind === "ruledout";
}

/** Pure: the tab's label: `Memory · 8` (the entries plus the direction), plain `Memory` when there is nothing. */
export function memoryTabLabel(c: Council): string {
    const n = memoryCount(c);
    return n > 0 ? `Memory · ${n}` : "Memory";
}

const ENTRY_KINDS = new Set(["agreed", "ruledout", "open"]);
const BY_AUTO = "auto";

// the number in an entry id (`m12` is 12); 0 for one that holds none
function entryNumber(id: string): number {
    const n = parseInt(id.replace(/^\D+/, ""), 10);
    return Number.isFinite(n) ? n : 0;
}

/** Pure: the entries the list shows, newest first (by when each came in; a tie by the later id). One of a kind this
 *  does not know is left out. A council saved before entries existed has none. */
export function memoryEntries(c: Council): CouncilMemoryEntry[] {
    return (c.memory?.entries ?? [])
        .filter((e) => ENTRY_KINDS.has(e.kind))
        .sort((a, b) => b.at - a.at || entryNumber(b.id) - entryNumber(a.id));
}

/** Pure: the number after `Memory ·` on the tab: the entries plus one for a chosen direction. */
export function memoryCount(c: Council): number {
    return memoryEntries(c).length + (c.memory?.chosen != null ? 1 : 0);
}

/** Pure: the ids of the entries that came in after `seenAt`, when the person last had the tab open (none seen yet reads
 *  as 0, so every entry is new). */
export function newEntryIds(c: Council, seenAt: number | undefined): Set<string> {
    const since = seenAt ?? 0;
    return new Set(
        memoryEntries(c)
            .filter((e) => e.at > since)
            .map((e) => e.id)
    );
}

/** Pure: when the newest entry came in (0 with none). It moves with every arrival, also when one round drops an entry
 *  and adds one, which leaves the count as it was: the open tab keys its seen time on this. */
export function latestEntryAt(c: Council): number {
    return memoryEntries(c).reduce((at, e) => Math.max(at, e.at), 0);
}

/** Pure: whether the tab's dot is on: a card waits for the person, or an entry came in since `seenAt`. */
export function memoryDotOn(c: Council, seenAt: number | undefined): boolean {
    return shownCard(c) != null || newEntryIds(c, seenAt).size > 0;
}

/** What an entry's details popover says. */
export interface EntryDetails {
    who: string | null; // `Auto · round 3`; null for the person's own, which the view writes `You · <time>`
    messages: string[]; // the message ids the entry rests on
    time: string; // `22:31`
}

/** Pure: the details of an entry: who made it (`Auto · round 3`, or `Auto` with no round; null for the person), the
 *  messages it rests on and when. */
export function entryDetails(e: CouncilMemoryEntry): EntryDetails {
    let who: string | null = null;
    if (e.by === BY_AUTO) {
        who = e.round != null && e.round > 0 ? `Auto · round ${e.round}` : "Auto";
    }
    return { who, messages: e.messages ?? [], time: clockTime(e.at) };
}

/** Pure: whether the tab is empty: no chosen direction, no entry and no card waiting (earlier directions do not count). */
export function memoryIsEmpty(c: Council): boolean {
    return memoryEntries(c).length === 0 && c.memory?.chosen == null && shownCard(c) == null;
}

/** Pure: who set a direction, in words: `Pinned by you`, `Written by you`, `Accepted · auto after round 2`,
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
                return d.round != null && d.round > 0 ? `Accepted · auto after round ${d.round}` : "Accepted · auto";
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

/** Pure: the item `id` names (an idea or a message id), as the tab links it, or null when it is no idea or message a
 *  person can reach (a written direction names none; a dropped idea or reply is gone). */
export function directionSource(c: Council, id: string | undefined): DirectionSource | null {
    if (id == null || id === "") {
        return null;
    }
    const idea = councilList(c, 0).ideas.find((r) => r.id === id);
    if (idea != null) {
        return { kind: "idea", id: idea.id, thread: idea.id, label: `Idea ${idea.n}` };
    }
    const message = readableReplies(c).find((r) => r.id === id);
    if (message != null) {
        const label = message.author === YOU ? "Your message" : `${authorName(c, message.author)}'s message`;
        return { kind: "message", id: message.id, thread: message.proposalid || CHAT_THREAD, label };
    }
    return null;
}

/** The chosen direction's line: how it was set, when, and the item it came from. */
export interface ChosenLine {
    how: string; // `Pinned by you`, `Accepted · auto after round 2`
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
    line: string; // `replaced 09:40`, `edited 09:40`, `unpinned 09:40`: how it ended and when (the how stays in `how`)
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
            return { text: d.text, how, ended, time, line: `${ended} ${time}` };
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
