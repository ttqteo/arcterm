// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The council's discussion as a group chat with threads (councilchat.tsx): what the channel, its thread panel, the seat
// chips and the step chip draw, derived from a `Council`. The channel holds the person's question, a divider for each
// round, every idea as a message (its evidence, the seats that agreed with it, the seats that picked it, a reply chip),
// every reply as a message naming the idea it is on, the drafts held for the person, the lines where an agent skipped a
// turn, a failure line with Retry, and a typing row for each seat at work; the seats take turns in it (`takeTurns`).
// Each idea's thread gathers its replies again, a held reply draft among them. An item that was dropped is left out
// everywhere, and one the person edited before sending says so. Pure, no React, no Wave runtime imports, so every
// rule here has a test (councilchatmodel.test.ts).
//
// The rounds come from councilmodel.ts (`roundsOf`, `synthesisRound`), so a council saved before rounds existed (no
// `rounds`, no drafts, no agents) reads as today's two rounds and a summary.

import {
    avatarTone,
    evidenceChip,
    expertDoing,
    failedWhile as failedWhileWords,
    isLit,
    listNames,
    postedAt,
    reactions,
    seatInitials,
    shortName,
} from "./councildiscussionmodel";
import {
    MIN_CHAT_KEY,
    answerers,
    askedParts,
    authorName,
    chatSeatTabs,
    draftsWaitWord,
    fileMentions,
    headerChip,
    heldDrafts,
    isAgentSeat,
    isMentionablePath,
    isReaction,
    mentionsChat,
    panel,
    pickCount,
    readableReplies,
    replyLabel,
    roundsOf,
    sentProposals,
    sentReplies,
    thumbOf,
    type CouncilThumb,
    type HeldDraft,
    type SeatableAgent,
} from "./councilmodel";
import { fileMentionMatches, insertFileMention } from "./launchermention";

export { insertFileMention };

const YOU = "you";

/** The colour an avatar is drawn in (`avatarTone`'s). */
export type Tone = ReturnType<typeof avatarTone>;

/** What the person sees of the seat behind a message: its id (or `you`), its name, its colour and whether it is a live
 *  agent or a role expert (the small tag beside the name; empty for the person and for a seat no longer in the council). */
export interface Who {
    author: string;
    name: string;
    initials: string; // the letters in its avatar (`ĐV`), which tell apart seats whose names start alike
    tone: Tone;
    tag: "agent" | "expert" | "";
}

function whoIs(c: Council, id: string): Who {
    const seat = c.experts.find((e) => e.id === id);
    return {
        author: id,
        name: authorName(c, id),
        initials: seatInitials(c, id),
        tone: avatarTone(c, id),
        tag: seat == null ? "" : isAgentSeat(seat) ? "agent" : "expert",
    };
}

// ---- the words ----

/** What a held draft waits for. */
export const DRAFT_WAIT = "Waiting for you";

/** The three things the person does with a held draft, in the order they are drawn; `action` is what
 *  `CouncilDraftCommand` takes (`edit` sends the draft with the person's text). */
export const DRAFT_ACTIONS = [
    { action: "send", label: "Send to the others" },
    { action: "edit", label: "Edit" },
    { action: "drop", label: "Drop" },
] as const;

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** A context size as the Agent tree shows it: 625k, 1.2M (a seat chip's, and a chat row in the @ picker's). */
export function contextLabel(n: number): string {
    return n >= 1_000_000 ? `${+(n / 1_000_000).toFixed(1)}M` : `${Math.round(n / 1000)}k`;
}

// what a seat's activity reads while its turn waits for the agent behind it (AgentCaller's OnTool line)
const WAITING_FOR_AGENT = /^Waiting for .+ to finish its task$/;

// where a failed call failed, as the words that follow the seat's name (`failed while replying`)
function failedWhile(c: Council, round: number): string {
    const words = failedWhileWords(c, round);
    return words.charAt(0).toLowerCase() + words.slice(1);
}

// ---- one message ----

function evidenceOf(list: CouncilEvidence[] | undefined): { evidence: string[]; weak: string } {
    const chips = (list ?? []).map(evidenceChip);
    return {
        evidence: chips.filter((chip) => !chip.weak && chip.text !== "").map((chip) => chip.text),
        weak: chips
            .filter((chip) => chip.weak)
            .map((chip) => chip.text)
            .join("; "),
    };
}

function proposalLabel(c: Council, p: CouncilProposal): string {
    if (c.mode !== "brainstorm") {
        return "proposes";
    }
    return p.wild ? "wild idea" : "idea";
}

/** The stance pill's colour: `accept` green (builds on it), `challenge` amber, `oppose` red, `neutral` a plain reply. */
export type PillTone = "accept" | "challenge" | "oppose" | "neutral";

// the word beside a reply's author: the person's `steers` (the whole council) or `replies`, a seat's `builds on it`,
// `has doubts`, `is against it`, else `replies`
function replyPill(r: CouncilReply): { label: string; pill: PillTone } {
    if (r.author === YOU) {
        return { label: r.proposalid || r.parentid ? "replies" : "steers", pill: "neutral" };
    }
    if (r.builds) {
        return { label: "builds on it", pill: "accept" };
    }
    switch (r.stance) {
        case "challenge":
            return { label: "has doubts", pill: "challenge" };
        case "oppose":
            return { label: "is against it", pill: "oppose" };
        default:
            return { label: "replies", pill: "neutral" };
    }
}

// `For everyone` when the reply reaches the whole panel, else `For UX and RAM`; empty for a reply that names no one
function reachOf(c: Council, r: CouncilReply): string {
    const to = r.to ?? [];
    if (to.length === 0) {
        return "";
    }
    if (panel(c).every((e) => to.includes(e.id))) {
        return "For everyone";
    }
    return `For ${listNames(to.map((id) => authorName(c, id)))}`;
}

/** A reply as a message: a seat's, or the person's (`mine`, with who it reaches and, until it is answered, what it waits
 *  for). It sits in its idea's thread, or in the channel when it has no idea (the person's post to the whole council and
 *  the answers to it). */
export interface ReplyPost extends Who {
    kind: "reply";
    id: string;
    label: string; // `builds on it`, `has doubts`, `is against it`, `replies`, `steers`
    pill: PillTone;
    text: string;
    attachments: string[]; // the images the person attached (absolute paths, in the order sent); empty for none
    evidence: string[];
    weak: string; // a claim marked weak, as the chip reads (`Weak · no measurement`)
    mine: boolean;
    thumb: CouncilThumb | ""; // the person's like or dislike on a seat's reply; always "" on the person's own
    reaches: string; // the person's reply: `For everyone`, `For UX and RAM`
    agrees: string[]; // `RAM agrees`: the seats that answered the person's post with no words (answerAgrees)
    pending: string; // the person's reply: `Queued for the next step` until it is answered
    parentid: string;
    proposalid: string; // the idea it replies on; empty for a post to the whole council
    on: string; // that idea's title, the quote the channel shows above a run of replies on it; empty after the first
    revised: boolean;
    edited: boolean;
    at: string; // the time of day it was posted (`14:32`)
    when: string; // its tooltip: the day, and how far into the council (`Oct 31 14:32 · 2:12 into the council`)
    ts: number; // when it was posted (ms), which councilseen.ts counts the Sent and Seen from
    reachIsDefault: boolean; // the person's post reaches whom it would anyway: the line under it leaves `reaches` out
    asks: string[]; // a seat's answer: the replies it suggests the person send next (threadAsks); empty otherwise
}

function replyPost(c: Council, r: CouncilReply): ReplyPost {
    const mine = r.author === YOU;
    return {
        kind: "reply",
        id: r.id,
        ...whoIs(c, r.author),
        ...replyPill(r),
        text: r.text,
        attachments: r.attachments ?? [],
        ...evidenceOf(r.evidence),
        mine,
        thumb: mine ? "" : thumbOf(r),
        reaches: mine ? reachOf(c, r) : "",
        reachIsDefault: mine && reachIsDefault(c, r),
        asks: mine ? [] : (r.asks ?? []),
        agrees: answerAgrees(c, r),
        pending: mine ? replyLabel(c, r) : "",
        parentid: r.parentid ?? "",
        proposalid: r.proposalid,
        on: r.proposalid === "" ? "" : ((c.proposals ?? []).find((p) => p.id === r.proposalid)?.title ?? ""),
        revised: !!r.revised,
        edited: !!r.edited,
        ...postedAt(c, r.ts),
        ts: r.ts,
    };
}

// whether the person's post reaches whom it would by default: the whole council from the channel, the idea's seat in
// its thread
function reachIsDefault(c: Council, r: CouncilReply): boolean {
    const to = r.to ?? [];
    if (to.length === 0) {
        return true;
    }
    if (r.proposalid === "") {
        return panel(c).every((e) => to.includes(e.id));
    }
    const author = (c.proposals ?? []).find((p) => p.id === r.proposalid)?.author;
    return to.length === 1 && to[0] === author;
}

/** Pure: the replies a thread offers the person above its box: the ones its newest seat answer suggests, while that
 *  answer is the thread's last post (a reply of theirs since, or a held draft, takes them away). */
export function threadAsks(items: readonly ThreadItem[]): string[] {
    for (let i = items.length - 1; i >= 0; i--) {
        const item = items[i];
        if (item.kind === "typing") {
            continue;
        }
        return item.kind === "reply" && !item.mine ? item.asks : [];
    }
    return [];
}

/** Pure: the reactions a reply carries: the seats that answered a post of the person's with no words (they agree with
 *  the answer before theirs, and have nothing to add) sit under the first answer to it with words, as a group chat
 *  shows a +1 under the message it agrees with, or under the post itself while it has no such answer sent. */
function answerAgrees(c: Council, r: CouncilReply): string[] {
    const sent = sentReplies(c);
    const ask = r.author === YOU ? r : sent.find((x) => x.id === r.parentid && x.author === YOU);
    if (ask == null) {
        return [];
    }
    const answers = sent
        .map((x, i) => ({ x, i }))
        .filter(({ x }) => x.parentid === ask.id && x.author !== YOU)
        .sort((a, b) => a.x.ts - b.x.ts || a.i - b.i)
        .map(({ x }) => x);
    const first = answers.find((x) => !isReaction(x));
    if ((first ?? ask).id !== r.id) {
        return [];
    }
    return answers.filter(isReaction).map((x) => `${authorName(c, x.author)} agrees`);
}

/** An idea or a reply a seat wrote that waits for the person: `of` says which. An idea sits in the channel; a reply in
 *  its idea's thread (in the channel when it has none). */
export interface DraftPost extends Who {
    kind: "draft";
    of: "idea" | "reply";
    id: string;
    label: string;
    pill: PillTone;
    title: string; // an idea's title; empty for a reply
    on: string; // a reply's idea title, when the council has that idea
    text: string;
    evidence: string[];
    weak: string;
    revised: boolean; // a reply that revises its seat's own idea: its `text` is the change line, and Edit changes only that
    edited: boolean;
    at: string;
    when: string;
    actions: typeof DRAFT_ACTIONS;
}

function draftPost(c: Council, d: HeldDraft): DraftPost {
    if (d.kind === "idea") {
        const p = d.proposal;
        return {
            kind: "draft",
            of: "idea",
            id: p.id,
            ...whoIs(c, p.author),
            label: proposalLabel(c, p),
            pill: "neutral",
            title: p.title,
            on: "",
            text: p.argument,
            ...evidenceOf(p.evidence),
            revised: false,
            edited: !!p.edited,
            ...postedAt(c, p.ts),
            actions: DRAFT_ACTIONS,
        };
    }
    const r = d.reply;
    return {
        kind: "draft",
        of: "reply",
        id: r.id,
        ...whoIs(c, r.author),
        ...replyPill(r),
        title: "",
        on: (c.proposals ?? []).find((p) => p.id === r.proposalid)?.title ?? "",
        text: r.text,
        ...evidenceOf(r.evidence),
        revised: !!r.revised,
        edited: !!r.edited,
        ...postedAt(c, r.ts),
        actions: DRAFT_ACTIONS,
    };
}

/** The reply chip under an idea: how many replies a person reads (a reaction is not one, a draft or a dropped reply not
 *  yet), who wrote them, when the last one came, and how many drafts wait in the thread. */
export interface IdeaThread {
    count: number;
    label: string; // `3 replies`, `1 reply`, `No replies yet`
    repliers: Who[]; // each author once, in the order they first replied
    last: string; // `Last reply 14:36`; empty with no replies
    lastWhen: string; // its tooltip, as a post's `when`
    drafts: number;
}

/** An idea as a channel message. */
export interface IdeaPost extends Who {
    kind: "idea";
    id: string;
    label: string; // `proposes` (Review), `idea` or `wild idea` (Brainstorm)
    wild: boolean; // a Brainstorm wild idea: it gets a pill
    title: string;
    text: string;
    evidence: string[];
    weak: string;
    agrees: string[]; // `Skeptic agrees`: the seats that agreed with nothing to add
    thumb: CouncilThumb | ""; // the person's like or dislike
    picks: { count: number; label: string; title: string } | null; // `Picked by 2`; null when no seat picked it
    edited: boolean;
    at: string;
    when: string;
    thread: IdeaThread;
}

function ideaPost(c: Council, view: Council, p: CouncilProposal): IdeaPost {
    const replies = readableReplies(c)
        .filter((r) => r.proposalid === p.id)
        .sort((a, b) => a.ts - b.ts);
    const last = replies[replies.length - 1];
    const lastAt = postedAt(c, last?.ts ?? 0);
    const repliers = [...new Set(replies.map((r) => r.author))].map((id) => whoIs(c, id));
    const picked = pickCount(c, p.id);
    return {
        kind: "idea",
        id: p.id,
        ...whoIs(c, p.author),
        label: proposalLabel(c, p),
        wild: c.mode === "brainstorm" && !!p.wild,
        title: p.title,
        text: p.argument,
        ...evidenceOf(p.evidence),
        agrees: reactions(view, p.id),
        thumb: thumbOf(p),
        picks:
            picked != null && picked > 0
                ? {
                      count: picked,
                      label: `Picked by ${picked}`,
                      title: `Picked by ${picked} of ${plural(panel(c).length, "expert", "experts")}`,
                  }
                : null,
        edited: !!p.edited,
        ...postedAt(c, p.ts),
        thread: {
            count: replies.length,
            label: replies.length === 0 ? "No replies yet" : plural(replies.length, "reply", "replies"),
            repliers,
            last: lastAt.at === "" ? "" : `Last reply ${lastAt.at}`,
            lastWhen: lastAt.when,
            drafts: heldDrafts(c).filter((d) => d.kind === "reply" && d.reply.proposalid === p.id).length,
        },
    };
}

// ---- the channel's other lines ----

export interface QuestionPost extends Who {
    kind: "question";
    id: "question";
    label: "asked";
    text: string; // the question, without the limits
    limits: string[]; // what it said to keep to (askedParts), each a chip under it
    at: string;
    when: string;
}

/** The line where a round starts. */
export interface DividerLine {
    kind: "divider";
    id: string;
    round: number;
    text: string; // `Round 1 · ideas`, `Round 2 · replies`
}

/** The line where an agent seat skipped its turn (it was busy, or gave no answer in time). `tab` is the agent's, for
 *  Open its terminal. */
export interface SkipLine extends Who {
    kind: "skip";
    id: string;
    tab: string;
    round: number;
    reason: string;
    text: string; // `Witness synthesis skipped round 2: still working on its own task after 10 min.`
    at: string;
    when: string;
}

/** A seat whose call failed and has not been retried: its line carries Retry (for `author`). */
export interface FailureLine extends Who {
    kind: "failure";
    id: string;
    round: number;
    error: string;
    text: string; // `UX failed while replying`
}

/** A seat at work right now. */
export interface TypingRow extends Who {
    kind: "typing";
    id: string;
    text: string; // `UX is writing…`, or what the seat waits on (`Waiting for Witness synthesis to finish its task`)
    waiting: boolean;
    on: string; // the idea it is replying on, when it names one
    proposalid: string;
}

export type ChannelItem =
    | QuestionPost
    | DividerLine
    | IdeaPost
    | DraftPost
    | ReplyPost
    | SkipLine
    | FailureLine
    | TypingRow;

function typingRow(c: Council, e: CouncilExpert, act: CouncilActivity): TypingRow {
    const waiting = WAITING_FOR_AGENT.test(act.text);
    const on = act.proposalid ? ((c.proposals ?? []).find((p) => p.id === act.proposalid)?.title ?? "") : "";
    return {
        kind: "typing",
        id: `typing:${e.id}`,
        ...whoIs(c, e.id),
        text: waiting ? act.text : `${e.name} is writing…`,
        waiting,
        on,
        proposalid: act.proposalid ?? "",
    };
}

// where an item sits among the others: by time, a divider before the items of its round, then as it arrived; a seat's
// idea or reply also has its place in the seats' turns
interface Entry {
    ts: number;
    rank: number;
    index: number;
    item: ChannelItem;
    turn?: Turn;
}

// what a seat's message is to the turn order: an idea (round 1), or a reply in a round on the idea it is on
type Turn = { round: number; author: string; on: string };

const FIRST = Number.MIN_SAFE_INTEGER; // round 1 starts before anything is posted
const NOT_YET = Number.MAX_SAFE_INTEGER; // a round with nothing posted yet is the newest thing

// the time a round after the first began: the first thing posted or skipped in it, else it is the newest thing
function roundStart(c: Council, round: number): number | null {
    const times = [
        ...(c.replies ?? []).filter((r) => r.round === round).map((r) => r.ts),
        ...(c.skips ?? []).filter((s) => s.round === round).map((s) => s.ts),
    ];
    if (times.length > 0) {
        return Math.min(...times);
    }
    return c.round >= round ? NOT_YET : null;
}

function dividers(c: Council): { ts: number; line: DividerLine }[] {
    const out: { ts: number; line: DividerLine }[] = [];
    for (let round = 1; round <= roundsOf(c); round++) {
        const ts = round === 1 ? (c.round >= 1 || (c.proposals ?? []).length > 0 ? FIRST : null) : roundStart(c, round);
        if (ts == null) {
            break;
        }
        out.push({
            ts,
            line: {
                kind: "divider",
                id: `round:${round}`,
                round,
                text: round === 1 ? "Round 1 · ideas" : `Round ${round} · replies`,
            },
        });
    }
    return out;
}

// `c` with only what was sent: what the shared helpers (`reactions`, `expertDoing`) count
function sentView(c: Council): Council {
    return { ...c, proposals: sentProposals(c), replies: sentReplies(c) };
}

// a round whose messages are all in: every round before the one at work, and every round once nothing runs
function settled(c: Council, round: number): boolean {
    return c.state !== "running" || round < c.round;
}

/** Pure: the seats' messages of each settled round in the order a group chat has them. A seat sends all its ideas or
 *  replies of a round in one call, so by time a round reads as one seat's block after another. Here the ideas take
 *  turns (each seat's first, then each one's second…, the seats in the order they first posted), and the replies follow
 *  the ideas they are on, in the ideas' order, the seats as they came. A round still at work keeps the order its
 *  messages came in, so nothing moves above what the person is reading while it runs. Only the seats' messages swap
 *  places among themselves: the person's posts, drafts, skips and dividers stay where time put them. */
function takeTurns(c: Council, entries: Entry[]): Entry[] {
    const ideas = entries.filter((e) => e.turn != null && e.turn.on === "");
    const seats: string[] = [];
    const bySeat = new Map<string, Entry[]>();
    for (const e of ideas) {
        if (!bySeat.has(e.turn.author)) {
            seats.push(e.turn.author);
            bySeat.set(e.turn.author, []);
        }
        bySeat.get(e.turn.author).push(e);
    }
    const ideaPlace = new Map<string, number>();
    for (let k = 0; ideaPlace.size < ideas.length; k++) {
        for (const seat of seats) {
            const e = bySeat.get(seat)[k];
            if (e != null) {
                ideaPlace.set(e.item.id, ideaPlace.size);
            }
        }
    }
    const placeOf = (e: Entry) =>
        e.turn.on === "" ? ideaPlace.get(e.item.id) : (ideaPlace.get(e.turn.on) ?? Number.MAX_SAFE_INTEGER);
    const out = entries.slice();
    const rounds = new Set(entries.filter((e) => e.turn != null).map((e) => e.turn.round));
    for (const round of rounds) {
        if (!settled(c, round)) {
            continue;
        }
        const slots = out.flatMap((e, i) => (e.turn?.round === round ? [i] : []));
        const moved = slots
            .map((i, order) => ({ e: out[i], order }))
            .sort((a, b) => placeOf(a.e) - placeOf(b.e) || a.order - b.order)
            .map((x) => x.e);
        slots.forEach((slot, i) => (out[slot] = moved[i]));
    }
    return out;
}

// a run of replies on one idea names it once, on the first: the channel reads as a group chat's quoted reply
function quoteOnce(items: ChannelItem[]): ChannelItem[] {
    let on = "";
    return items.map((item) => {
        if (item.kind !== "reply" || item.proposalid === "") {
            on = "";
            return item;
        }
        const repeat = item.proposalid === on;
        on = item.proposalid;
        return repeat ? { ...item, on: "" } : item;
    });
}

/** Pure: the channel of a council: the person's question, a divider for each round reached, every idea (sent, or held
 *  as a draft), every reply (each on an idea names it, `on`, the first of a run on one idea only), the lines where an
 *  agent skipped a turn, and the person's posts with the answers to them; then a failure line for each seat whose call
 *  failed, and last a typing row for each seat at work. It is in time order, but for the seats taking turns in each
 *  settled round (`takeTurns`). A reply on an idea is in that idea's thread too (`councilThread`). A dropped item is
 *  left out.
 *
 *  With `only`, an expert's id, it is that seat's messages alone (the Summary's "show their messages"): the question,
 *  its ideas, and every reply it wrote, with its own lines; a round with nothing of its own leaves its divider out. An
 *  agreement with nothing to add is no message. */
export function councilChannel(c: Council, only?: string): ChannelItem[] {
    const view = sentView(c);
    const entries: Entry[] = [];
    const push = (ts: number, rank: number, item: ChannelItem, turn?: Turn) =>
        entries.push({ ts, rank, index: entries.length, item, turn });
    const theirs = (author: string) => only == null || author === only;

    for (const p of sentProposals(c)) {
        if (theirs(p.author)) {
            push(p.ts, 1, ideaPost(c, view, p), { round: 1, author: p.author, on: "" });
        }
    }
    for (const d of heldDrafts(c)) {
        if (theirs(d.kind === "idea" ? d.proposal.author : d.reply.author)) {
            push(d.ts, 1, draftPost(c, d));
        }
    }
    for (const r of readableReplies(c)) {
        if (theirs(r.author)) {
            // a seat's reply on an idea takes its turn; the person's posts, and the answers to a post, stay in time
            const turn =
                r.author !== YOU && r.proposalid !== ""
                    ? { round: r.round, author: r.author, on: r.proposalid }
                    : undefined;
            push(r.ts, 1, replyPost(c, r), turn);
        }
    }
    for (const s of c.skips ?? []) {
        if (!theirs(s.expert)) {
            continue;
        }
        const seat = c.experts.find((e) => e.id === s.expert);
        push(s.ts, 1, {
            kind: "skip",
            id: `skip:${s.expert}:${s.round}:${s.ts}`,
            ...whoIs(c, s.expert),
            tab: seat?.agent ?? "",
            round: s.round,
            reason: s.reason,
            text: `${authorName(c, s.expert)} skipped round ${s.round}: ${s.reason}.`,
            ...postedAt(c, s.ts),
        });
    }
    for (const { ts, line } of dividers(c)) {
        push(ts, 0, line);
    }

    const items = quoteOnce(
        takeTurns(
            c,
            entries.sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : a.rank - b.rank || a.index - b.index))
        ).map((e) => e.item)
    );

    const asked = askedParts(c.question);
    if (asked.question !== "") {
        items.unshift({
            kind: "question",
            id: "question",
            ...whoIs(c, YOU),
            label: "asked",
            text: asked.question,
            limits: asked.limits,
            ...postedAt(c, c.started ?? 0),
        });
    }

    for (const e of c.experts) {
        const failure = c.failed?.[e.id];
        if (failure != null && theirs(e.id)) {
            items.push({
                kind: "failure",
                id: `failed:${e.id}`,
                ...whoIs(c, e.id),
                round: failure.round,
                error: failure.error,
                text: `${e.name} ${failedWhile(c, failure.round)}`,
            });
        }
    }
    for (const e of c.experts) {
        const act = c.activity?.[e.id];
        if (isLit(c, e.id) && act != null && theirs(e.id)) {
            items.push(typingRow(c, e, act));
        }
    }
    return only == null
        ? items
        : items.filter(
              (item, i) => item.kind !== "divider" || (i + 1 < items.length && items[i + 1].kind !== "divider")
          );
}

// ---- a thread ----

export type ThreadItem = ReplyPost | DraftPost | TypingRow;

/** One idea's thread: the idea on top, then its replies in the order they were posted (a held reply among them as a
 *  draft), then a typing row for each seat replying on it. */
export interface ChatThread {
    idea: IdeaPost;
    items: ThreadItem[];
}

/** Pure: the thread of an idea; null for an id that is not a sent idea of the council (a held draft has none yet, a
 *  dropped idea none at all). */
export function councilThread(c: Council, proposalId: string): ChatThread | null {
    const p = sentProposals(c).find((x) => x.id === proposalId);
    if (p == null) {
        return null;
    }
    const dated: { ts: number; item: ThreadItem }[] = [];
    for (const r of readableReplies(c)) {
        if (r.proposalid === p.id) {
            dated.push({ ts: r.ts, item: replyPost(c, r) });
        }
    }
    for (const d of heldDrafts(c)) {
        if (d.kind === "reply" && d.reply.proposalid === p.id) {
            dated.push({ ts: d.ts, item: draftPost(c, d) });
        }
    }
    const items = dated.sort((a, b) => a.ts - b.ts).map((x) => x.item);
    for (const e of c.experts) {
        const act = c.activity?.[e.id];
        if (isLit(c, e.id) && act?.proposalid === p.id) {
            items.push(typingRow(c, e, act));
        }
    }
    return { idea: ideaPost(c, sentView(c), p), items };
}

/** Pure: the ideas j and k move over, in the order the channel draws them (`items`, the whole channel or one seat's):
 *  the sent ones (a held draft has no thread to open). */
export function ideaOrder(items: readonly ChannelItem[]): string[] {
    return items.filter((i): i is IdeaPost => i.kind === "idea").map((i) => i.id);
}

/** Pure: the idea j (`1`) or k (`-1`) moves to from `from`: the first (or, going up, the last) when none is focused or
 *  the focused one is gone, and it stops at either end. Null when the channel has no idea. */
export function moveIdea(order: readonly string[], from: string | null, dir: 1 | -1): string | null {
    if (order.length === 0) {
        return null;
    }
    const at = from == null ? -1 : order.indexOf(from);
    if (at < 0) {
        return dir === 1 ? order[0] : order[order.length - 1];
    }
    return order[Math.min(order.length - 1, Math.max(0, at + dir))];
}

// ---- the seats ----

export type SeatDot = "working" | "waiting" | "failed" | "idle";

/** A seat's chip under the header: its name, `agent · 625k` or `expert · sonnet`, a state dot and what it is doing. A
 *  click on an agent's (`tab`) opens its terminal; a failed seat's carries Retry (`retry`). */
export interface SeatChip {
    id: string; // the seat's id
    name: string;
    short: string; // the name without the words every seat shares (`Định vị`), as the filter row shows it
    initials: string;
    ideas: number; // its sent ideas and the replies a person reads: the filter's count, and the line under it
    replies: number;
    tone: Tone;
    agent: boolean;
    tab: string; // the agent's tab id; empty for a role expert
    kind: string;
    dot: SeatDot;
    doing: string;
    retry: boolean;
    title: string;
}

function seatKind(e: CouncilExpert): string {
    if (isAgentSeat(e)) {
        return e.context ? `agent · ${contextLabel(e.context)}` : "agent";
    }
    return e.model ? `expert · ${e.model}` : "expert";
}

function seatTitle(e: CouncilExpert): string {
    if (isAgentSeat(e)) {
        return `${e.name} (live agent). Click to open its terminal.`;
    }
    return e.coordinator ? "Writes the summary at the end." : "Role expert, a fresh session that sees only this chat.";
}

// what a seat is doing: at work, failed, holding drafts for the person, skipped this round, else where it stands
function seatState(c: Council, view: Council, e: CouncilExpert): { dot: SeatDot; doing: string } {
    const act = c.activity?.[e.id];
    if (isLit(c, e.id) && act != null) {
        return { dot: WAITING_FOR_AGENT.test(act.text) ? "waiting" : "working", doing: act.text };
    }
    const failure = c.failed?.[e.id];
    if (failure != null) {
        return { dot: "failed", doing: capitalize(failedWhile(c, failure.round)) };
    }
    const held = heldDrafts(c).filter((d) => (d.kind === "idea" ? d.proposal.author : d.reply.author) === e.id).length;
    if (held > 0) {
        return { dot: "waiting", doing: draftsWaitWord(held) };
    }
    if ((c.skips ?? []).some((s) => s.expert === e.id && s.round === c.round)) {
        return { dot: "idle", doing: `Skipped round ${c.round}` };
    }
    return { dot: "idle", doing: expertDoing(view, e) };
}

/** Pure: a chip for each seat, in the council's order (agents first). */
export function seatChips(c: Council): SeatChip[] {
    const view = sentView(c);
    return c.experts.map((e) => ({
        id: e.id,
        name: e.name,
        short: shortName(c, e.id),
        initials: seatInitials(c, e.id),
        ideas: sentProposals(c).filter((p) => p.author === e.id).length,
        replies: readableReplies(c).filter((r) => r.author === e.id).length,
        tone: avatarTone(c, e.id),
        agent: isAgentSeat(e),
        tab: e.agent ?? "",
        kind: seatKind(e),
        ...seatState(c, view, e),
        retry: c.failed?.[e.id] != null,
        title: seatTitle(e),
    }));
}

/** Pure: the line beside the seat filters while one is on: `Only Định vị: 7 ideas and 12 replies`. */
export function onlyLine(chip: Pick<SeatChip, "short" | "ideas" | "replies">): string {
    const ideas = `${chip.ideas} ${chip.ideas === 1 ? "idea" : "ideas"}`;
    const replies = `${chip.replies} ${chip.replies === 1 ? "reply" : "replies"}`;
    return `Only ${chip.short}: ${ideas} and ${replies}`;
}

/** The chip in the header: the step (`Round 2 of 2 · 1 draft waits for you`) and the dot beside it, amber while the
 *  council waits on the person, green while it runs, red when it failed. */
export interface StepChip {
    text: string;
    dot: SeatDot;
}

/** Pure: the step chip of a council. */
export function stepChip(c: Council): StepChip {
    const waits = c.state === "awaiting-you" || heldDrafts(c).length > 0;
    const dot: SeatDot =
        c.state === "failed" ? "failed" : waits ? "waiting" : c.state === "running" ? "working" : "idle";
    return { text: headerChip(c), dot };
}

// ---- who a message reaches ----

/** Pure: who answers a message of the person's, for the line under a composer: the seats it @-mentions (a chat seat by
 *  its name or its mention key) and the live chats it adds (`joining`, the ones `pickedChats` found), else (in a thread)
 *  the idea's author and the seats on the path to the reply it answers, else (in the channel) everyone. An empty
 *  `proposalId` is the channel's composer. A message that adds a chat always names who answers: it is not everyone. */
export function replyReach(
    c: Council,
    proposalId: string,
    parentId: string,
    text: string,
    joining: readonly SeatableAgent[] = []
): { names: string[]; label: string } {
    const names = answerers(c, proposalId, parentId, text, joining).map((e) => e.name);
    if (names.length === 0) {
        return { names, label: "Name a seat with @ to choose who answers" };
    }
    if (joining.length === 0 && proposalId === "" && parentId === "" && names.length === panel(c).length) {
        return { names, label: "Everyone answers" };
    }
    return { names, label: `Answered by: ${names.join(", ")}` };
}

// ---- the @ picker ----

// an @ that does not sit inside a word, and what has been typed after it up to the caret: a seat's name, or a path (the
// New dialog's `@` list reads one as far as 200 characters)
const MENTION = /(^|[^\p{L}\p{N}_])@([^@\n]{0,200})$/u;

/** Pure: each chat's mention key, by tab id: the shortest start of the tab id, {@link MIN_CHAT_KEY} characters or more,
 *  that no other chat in `tabIds` shares (any case). `@82faafca` for a lone chat; for two whose ids start alike the key
 *  runs on past the `-` of a UUID (`3e19c0d2-a`, `3e19c0d2-b`). A tab id shorter than a key, or one that starts another
 *  chat's, keeps its whole id (a mention cannot reach it: `mentionsChat`). `tabIds` is the chat seats' plus the chats
 *  the picker lists, so a key it inserts is one of its own seat's the moment the chat is seated. */
export function chatMentionKeys(tabIds: readonly string[]): Map<string, string> {
    const ids = [...new Set(tabIds)];
    const lower = ids.map((id) => id.toLowerCase());
    const keys = new Map<string, string>();
    ids.forEach((id, i) => {
        let n = Math.min(MIN_CHAT_KEY, id.length);
        while (n < id.length && lower.some((other, j) => j !== i && other.startsWith(lower[i].slice(0, n)))) {
            n++;
        }
        keys.set(id, id.slice(0, n));
    });
    return keys;
}

/** Pure: the live chats the person can still add: the ones no seat holds (`agent`). */
export function joinableChats(c: Council, chats: readonly SeatableAgent[]): SeatableAgent[] {
    const seated = new Set(chatSeatTabs(c));
    return chats.filter((a) => !seated.has(a.id));
}

/** A live chat the `@` picker lists under the seats, with the key `insertChatMention` puts in the message. */
export interface ChatPick {
    chat: SeatableAgent;
    key: string;
}

/** What the `@` picker lists: the seats, the project's files and the live chats that match, and where the `@` sits. */
export interface MentionPicker {
    start: number;
    seats: CouncilExpert[];
    files: string[]; // project paths, relative to the project, best match first
    chats: ChatPick[];
}

/** Pure: what the `@` picker lists while the person types, for the text before `caret`: the seats whose name, id or
 *  (for a chat) mention key holds what follows the `@`; the project's files from `files` that match it (the New dialog's
 *  ranking and cap, `fileMentionMatches`; none for a bare `@`, and only the ones an `@` can name whole,
 *  `isMentionablePath`); then the live chats from `chats` that no seat holds, whose key, name or project holds it, each
 *  with its key; and `start`, where that `@` sits (it is replaced by the seat's name, `insertMention`, the file's path,
 *  `insertFileMention`, or the chat's key, `insertChatMention`). A query that holds a `/` or a `.` is a path, and lists
 *  files alone. Null when the caret is not right after an `@`, when no list has a match, and once a whole seat name, seat
 *  key or chat key, or a path, and a space follow it, so the picker closes after a pick. */
export function mentionPicker(
    c: Council,
    text: string,
    caret: number,
    chats: readonly SeatableAgent[] = [],
    files: readonly string[] = []
): MentionPicker | null {
    const found = MENTION.exec(text.slice(0, caret));
    if (found == null) {
        return null;
    }
    const query = found[2].toLowerCase();
    const seats = panel(c);
    const joinable = joinableChats(c, chats);
    const keys = chatMentionKeys([...chatSeatTabs(c), ...joinable.map((a) => a.id)]);
    // a key too short to be mentioned is no word of a seat's
    const keyOf = (tab: string | undefined) => {
        const key = tab ? (keys.get(tab) ?? "") : "";
        return key.length >= MIN_CHAT_KEY ? key : "";
    };
    const wordsOf = (e: CouncilExpert) => [e.name, e.id, keyOf(e.agent)];
    const whole = (word: string) => word !== "" && query === `${word.toLowerCase()} `;
    if (seats.some((e) => wordsOf(e).some(whole)) || joinable.some((a) => whole(keyOf(a.id)))) {
        return null;
    }
    const holds = (word: string) => word.toLowerCase().includes(query);
    const isPath = /[/.]/.test(query);
    const matching = isPath ? [] : seats.filter((e) => query === "" || wordsOf(e).some(holds));
    // a path ends at whitespace: once a space follows it the `@` is done
    const named = query === "" || /\s/.test(query) ? [] : fileMentionMatches(found[2], files.filter(isMentionablePath));
    const listed = isPath
        ? []
        : joinable
              .filter((a) => query === "" || [keys.get(a.id) ?? "", a.name, a.project].some(holds))
              .map((a) => ({ chat: a, key: keys.get(a.id) ?? "" }));
    return matching.length > 0 || named.length > 0 || listed.length > 0
        ? { start: caret - found[2].length - 1, seats: matching, files: named, chats: listed }
        : null;
}

/** One row of the `@` list: a seat, a file or a live chat to add. */
export type PickerRow =
    | { kind: "seat"; seat: CouncilExpert }
    | { kind: "file"; path: string }
    | { kind: "chat"; chat: ChatPick };

/** Pure: the one list the arrow keys walk, in the order the list draws it: the Seats, then the Files, then Add a live
 *  chat. The cursor starts on the first row: a seat when any matches. */
export function pickerRows(picker: Pick<MentionPicker, "seats" | "files" | "chats">): PickerRow[] {
    return [
        ...picker.seats.map((seat): PickerRow => ({ kind: "seat", seat })),
        ...picker.files.map((path): PickerRow => ({ kind: "file", path })),
        ...picker.chats.map((chat): PickerRow => ({ kind: "chat", chat })),
    ];
}

/** Pure: `text` with the `@…` typed between `start` and `caret` replaced by `@<seat's name>` and a space (the one that
 *  already follows the caret, if there is one), and where the caret goes: after that space. */
export function insertMention(
    text: string,
    start: number,
    caret: number,
    seat: Pick<CouncilExpert, "name">
): { text: string; caret: number } {
    const mention = `@${seat.name}`;
    const rest = text.slice(caret);
    return {
        text: text.slice(0, start) + (rest.startsWith(" ") ? mention : `${mention} `) + rest,
        caret: start + mention.length + 1,
    };
}

/** Pure: `text` with the `@…` typed between `start` and `caret` replaced by `@<chat's key>` and a space (the one that
 *  already follows the caret, if there is one), and where the caret goes: after that space. */
export function insertChatMention(
    text: string,
    start: number,
    caret: number,
    key: string
): { text: string; caret: number } {
    return insertMention(text, start, caret, { name: key });
}

/** Pure: the live chats a message adds: the ones from `chats` that no seat holds whose mention key is in `text` (the
 *  same reading of an @ a seat is reached by, `mentionsChat`, told apart from the chat seats and the other chats in
 *  `chats`). Send passes their ids as `agents`; deleting the mention before Send drops the pick. In the order of `chats`. */
export function pickedChats(c: Council, text: string, chats: readonly SeatableAgent[]): SeatableAgent[] {
    const joinable = joinableChats(c, chats);
    const tabs = [...chatSeatTabs(c), ...joinable.map((a) => a.id)];
    return joinable.filter((a) => mentionsChat(text, a.id, tabs));
}

// ---- what to ask next ----

/** One question the report suggests the person ask next, as a chip above the channel's composer and a row in the
 *  Summary: `text` as the coordinator wrote it, `to` the seat it is for ("" the whole panel), and `fill`, what a click
 *  puts in the composer (`@<seat's name> ` before the text when it is for one seat). */
export interface AskChip {
    text: string;
    to: string;
    fill: string;
}

/** Pure: the report's questions to ask next that the person has not asked yet (no reply of theirs holds the text), each
 *  for a seat on the panel or for everyone. Empty with no report. */
export function askChips(c: Council): AskChip[] {
    const asked = (c.replies ?? []).filter((r) => r.author === YOU).map((r) => r.text);
    const seats = panel(c);
    const out: AskChip[] = [];
    for (const a of c.summary?.asks ?? []) {
        const text = a.text.trim();
        if (text === "" || asked.some((t) => t.includes(text))) {
            continue;
        }
        const seat = seats.find((e) => e.id === a.to);
        out.push({ text, to: seat?.id ?? "", fill: seat != null ? `@${seat.name} ${text}` : text });
    }
    return out;
}

// ---- whether a follow-up reads files ----

// a file by a name with an extension a project holds as text, a path with two slashes or more (one slash is a pair,
// "pass/fail"), one that starts ./ ../ ~/ or /, or a code span holding a dot or a slash
const FILE_EXT =
    "json|jsonl|md|mdx|txt|csv|tsv|ya?ml|toml|ini|go|ts|tsx|js|jsx|mjs|cjs|py|ipynb|rs|java|kt|swift|c|h|cpp|rb|php|sh|sql|html|css|scss|tex|bib|log";
const NAMED_FILE = new RegExp(`(?:^|[\\s(\`"'])([\\w~./-]*[\\w-]\\.(?:${FILE_EXT}))(?=$|[\\s),.:;!?\`"'])`, "iu");
const NAMED_PATH = /(?:^|[\s(`"'])((?:\.{1,2}\/|~\/|\/)[\w.-]+(?:\/[\w.-]+)*|[\w.-]+(?:\/[\w.-]+){2,})/u;
const NAMED_SPAN = /`([^`\s]*[./][^`\s]*)`/u;

/** Pure: the first file or path a question names, "" when it names none. */
export function namedFile(text: string): string {
    for (const re of [NAMED_FILE, NAMED_PATH, NAMED_SPAN]) {
        const m = re.exec(text);
        if (m != null) {
            return m[1];
        }
    }
    return "";
}

/** Pure: whether a message lets the seats read files, `why` and `locked` with it. It is on, and `locked` (the person
 *  cannot turn it off), when `attached` images go with it or its text has an `@file` (the first one is `why`, else
 *  "an image"): the seats cannot read what they cannot open. Otherwise it is the person's own choice when they flipped
 *  Let them read files (`choice`), else on exactly when the question names a file or a path, `why` naming it. */
export function readsFiles(
    choice: boolean | null,
    text: string,
    attached = 0
): { on: boolean; why: string; locked: boolean } {
    const mention = fileMentions(text)[0];
    if (attached > 0 || mention != null) {
        return { on: true, why: mention?.path ?? "an image", locked: true };
    }
    if (choice != null) {
        return { on: choice, why: "", locked: false };
    }
    const file = namedFile(text);
    return { on: file !== "", why: file, locked: false };
}

/** A piece of a sent message: plain text, or the file an `@path` named (drawn as a chip in place of the `@path`). */
export type MessageSegment = { kind: "text"; text: string } | { kind: "file"; path: string };

/** Pure: a message's text cut at its file mentions, in order, with no empty text between or around them; the text
 *  of the segments, with `@path` for each file, is the message again. An `@` that names a seat stays in the text. */
export function messageSegments(text: string): MessageSegment[] {
    const out: MessageSegment[] = [];
    let from = 0;
    for (const m of fileMentions(text)) {
        if (m.start > from) {
            out.push({ kind: "text", text: text.slice(from, m.start) });
        }
        out.push({ kind: "file", path: m.path });
        from = m.end;
    }
    if (from < text.length) {
        out.push({ kind: "text", text: text.slice(from) });
    }
    return out;
}
