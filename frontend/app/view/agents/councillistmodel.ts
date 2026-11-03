// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The council's Discussion as a list of ideas (councilchat.tsx draws it; board Discussion-list.dc.html in
// .superpowers/design/council-ux): a Chat row on top for the replies tied to no idea (the person's own messages and the
// seats' answers to them), then one row per idea with its number, its author, its title, a New badge for an idea that
// came since the person last opened the council, the counts of Agrees / Has doubts / Is against it and the reply
// count; a row that holds a draft waiting for the person is flagged. The order is fixed, so rows never jump under the
// j / k cursor or the open thread: arrival until there is a summary, then the Report's (matrixRows), the ideas no
// direction cites or that came after the summary following in arrival order. With a seat chosen in the Seats chip,
// only the ideas it wrote or replied to show, and the Chat row counts its lines alone. Pure, no React, no Wave runtime
// imports (councillistmodel.test.ts).

import { avatarTone, seatInitials } from "./councildiscussionmodel";
import {
    authorName,
    heldDrafts,
    latestStances,
    matrixRows,
    readableReplies,
    sentProposals,
    sentReplies,
} from "./councilmodel";

const YOU = "you";

/** The thread the Chat row opens: the open-thread atom holds it in place of an idea's id. */
export const CHAT_THREAD = "chat";

/** The colour an avatar is drawn in (`avatarTone`'s). */
type Tone = ReturnType<typeof avatarTone>;

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** The Chat row: the replies tied to no idea. */
export interface ChatRow {
    count: number; // the messages a person reads (an agreement with nothing to add is none)
    label: string; // `4 messages`, `1 message`, `No messages yet`
    latest: string; // `Contrarian: Kết quả âm…`: the newest message's author and its text on one line; empty with none
    fresh: number; // the seats' messages since the person last opened the council
    freshLabel: string; // `2 new`; empty with none
    draft: boolean; // a seat's reply tied to no idea waits for the person
}

/** One idea's row. */
export interface IdeaRow {
    id: string;
    n: number; // its number: the order it arrived in among the council's ideas, the same in every view and filter
    author: string;
    name: string;
    initials: string;
    tone: Tone;
    title: string;
    label: string; // `proposes` (Review), `idea` or `wild idea` (Brainstorm)
    isNew: boolean; // it came after the person last opened the council
    agrees: number;
    doubts: number;
    against: number;
    replies: number; // the replies a person reads on it
    repliesLabel: string; // `no replies`, `1 reply`, `4 replies`
    draft: boolean; // the idea itself, or a reply on it, waits for the person
    held: boolean; // the idea itself is a draft: it has no thread yet, only its Send / Edit / Drop
}

export interface CouncilList {
    chat: ChatRow;
    ideas: IdeaRow[];
    label: string; // `24 ideas`, `1 idea`
}

// a message's text on one line, as the Chat row quotes it
function oneLine(text: string): string {
    return text.replace(/\s+/g, " ").trim();
}

function ideaLabel(c: Council, p: CouncilProposal): string {
    if (c.mode !== "brainstorm") {
        return "proposes";
    }
    return p.wild ? "wild idea" : "idea";
}

// the ideas a person can see, in the order they arrived (a tie: the order the record keeps them): the sent ones and
// the ones held for the person; a dropped idea is gone
function arrived(c: Council): CouncilProposal[] {
    const held = new Set(heldDrafts(c).flatMap((d) => (d.kind === "idea" ? [d.id] : [])));
    return (c.proposals ?? [])
        .map((p, i) => ({ p, i }))
        .filter(({ p }) => !p.draft || held.has(p.id))
        .sort((a, b) => a.p.ts - b.p.ts || a.i - b.i)
        .map(({ p }) => p);
}

/** Pure: the ideas in the list's order, their ids. Arrival until there is a summary; then the ones the summary's
 *  directions cite, in the Report's order (`matrixRows`), and after them, in arrival order, the ideas no direction
 *  cites, the ones that came after the summary, and the held ones. Never re-sorted on a stance. */
export function listOrder(c: Council): string[] {
    const ideas = arrived(c).map((p) => p.id);
    const summary = c.summary;
    if (summary == null) {
        return ideas;
    }
    const cited = new Set(summary.directions.flatMap((d) => d.from));
    const sent = new Map(sentProposals(c).map((p) => [p.id, p]));
    const first = matrixRows(c)
        .map((r) => r.proposal)
        .filter((p) => cited.has(p.id) && p.ts <= summary.at && sent.has(p.id))
        .map((p) => p.id);
    const placed = new Set(first);
    return [...first, ...ideas.filter((id) => !placed.has(id))];
}

// whether the seat `only` wrote the idea or replied to it (a sent reply, an agreement included, or one it holds)
function touches(c: Council, p: CouncilProposal, only: string): boolean {
    if (p.author === only) {
        return true;
    }
    return (
        sentReplies(c).some((r) => r.proposalid === p.id && r.author === only) ||
        heldDrafts(c).some((d) => d.kind === "reply" && d.reply.proposalid === p.id && d.reply.author === only)
    );
}

/** Pure: the Chat row of a council, counting only the seat `only`'s lines when one is chosen. `openedAt` is when the
 *  person last opened it (councilopened.ts). */
export function chatRow(c: Council, openedAt: number, only?: string): ChatRow {
    const theirs = (author: string) => only == null || author === only;
    const lines = readableReplies(c)
        .map((r, i) => ({ r, i }))
        .filter(({ r }) => r.proposalid === "" && theirs(r.author))
        .sort((a, b) => a.r.ts - b.r.ts || a.i - b.i)
        .map(({ r }) => r);
    const last = lines[lines.length - 1];
    const fresh = lines.filter((r) => r.author !== YOU && r.ts > openedAt).length;
    return {
        count: lines.length,
        label: lines.length === 0 ? "No messages yet" : plural(lines.length, "message", "messages"),
        latest: last == null ? "" : `${authorName(c, last.author)}: ${oneLine(last.text)}`,
        fresh,
        freshLabel: fresh === 0 ? "" : `${fresh} new`,
        draft: heldDrafts(c).some((d) => d.kind === "reply" && d.reply.proposalid === "" && theirs(d.reply.author)),
    };
}

/** Pure: the Discussion's list: the Chat row, then a row per idea in `listOrder`, only the ideas the seat `only` wrote
 *  or replied to when one is chosen. `openedAt` is when the person last opened the council: an idea that came after it
 *  is New. */
export function councilList(c: Council, openedAt: number, only?: string): CouncilList {
    const all = arrived(c);
    const number = new Map(all.map((p, i) => [p.id, i + 1]));
    const byId = new Map(all.map((p) => [p.id, p]));
    const stances = latestStances(c);
    const readable = readableReplies(c);
    const held = heldDrafts(c);
    const ideas = listOrder(c)
        .map((id) => byId.get(id))
        .filter((p) => only == null || touches(c, p, only))
        .map((p): IdeaRow => {
            const of = Object.values(stances[p.id] ?? {});
            const replies = readable.filter((r) => r.proposalid === p.id).length;
            const isHeld = held.some((d) => d.kind === "idea" && d.id === p.id);
            return {
                id: p.id,
                n: number.get(p.id),
                author: p.author,
                name: authorName(c, p.author),
                initials: seatInitials(c, p.author),
                tone: avatarTone(c, p.author),
                title: p.title,
                label: ideaLabel(c, p),
                isNew: p.ts > openedAt,
                agrees: of.filter((s) => s === "accept").length,
                doubts: of.filter((s) => s === "challenge").length,
                against: of.filter((s) => s === "oppose").length,
                replies,
                repliesLabel: replies === 0 ? "no replies" : plural(replies, "reply", "replies"),
                draft: isHeld || held.some((d) => d.kind === "reply" && d.reply.proposalid === p.id),
                held: isHeld,
            };
        });
    return { chat: chatRow(c, openedAt, only), ideas, label: plural(ideas.length, "idea", "ideas") };
}

/** Pure: the rows j and k move over, in the order the list draws them: the Chat row, then the ideas. */
export function listNavOrder(list: CouncilList): string[] {
    return [CHAT_THREAD, ...list.ideas.map((r) => r.id)];
}
