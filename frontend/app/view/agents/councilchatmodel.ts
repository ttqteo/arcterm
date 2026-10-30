// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The council's discussion as a Slack-style channel with threads (councilchat.tsx): what the channel, its thread panel,
// the seat chips and the step chip draw, derived from a `Council`. The channel holds the person's question, a divider for
// each round, every idea as a message (its evidence, the seats that agreed with it, the seats that picked it, a reply
// chip), the ideas still held as drafts for the person, the lines where an agent skipped a turn, the person's own posts to
// the whole council, a failure line with Retry, and a typing row for each seat at work. Every reply to an idea, the
// person's included, lives in that idea's thread, with a held reply draft among them. An item that was dropped is left
// out everywhere, and one the person edited before sending says so. Pure, no React, no Wave runtime imports, so every
// rule here has a test (councilchatmodel.test.ts).
//
// The rounds come from councilmodel.ts (`roundsOf`, `synthesisRound`), so a council saved before rounds existed (no
// `rounds`, no drafts, no agents) reads as today's two rounds and a summary.

import {
    avatarTone,
    evidenceChip,
    expertDoing,
    isLit,
    listNames,
    reactions,
    sinceStart,
} from "./councildiscussionmodel";
import {
    answerers,
    authorName,
    draftsWaitWord,
    headerChip,
    heldDrafts,
    isAgentSeat,
    panel,
    pickCount,
    readableReplies,
    replyLabel,
    roundsOf,
    sentProposals,
    sentReplies,
    synthesisRound,
    type HeldDraft,
} from "./councilmodel";

const YOU = "you";

/** The colour an avatar is drawn in (`avatarTone`'s). */
export type Tone = ReturnType<typeof avatarTone>;

/** What the person sees of the seat behind a message: its id (or `you`), its name, its colour and whether it is a live
 *  agent or a role expert (the small tag beside the name; empty for the person and for a seat no longer in the council). */
export interface Who {
    author: string;
    name: string;
    tone: Tone;
    tag: "agent" | "expert" | "";
}

function whoIs(c: Council, id: string): Who {
    const seat = c.experts.find((e) => e.id === id);
    return {
        author: id,
        name: authorName(c, id),
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

// a context size as the Agent tree shows it: 625k, 1.2M
function contextLabel(n: number): string {
    return n >= 1_000_000 ? `${+(n / 1_000_000).toFixed(1)}M` : `${Math.round(n / 1000)}k`;
}

// what a seat's activity reads while its turn waits for the agent behind it (AgentCaller's OnTool line)
const WAITING_FOR_AGENT = /^Waiting for .+ to finish its task$/;

// where a failed call failed, as the words that follow the seat's name
function failedWhile(c: Council, round: number): string {
    if (round <= 1) {
        return "failed while proposing";
    }
    if (round <= roundsOf(c)) {
        return "failed while replying";
    }
    return round === synthesisRound(c) ? "failed while writing the summary" : "failed while answering";
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
    evidence: string[];
    weak: string; // a claim marked weak, as the chip reads (`Weak · no measurement`)
    mine: boolean;
    reaches: string; // the person's reply: `For everyone`, `For UX and RAM`
    pending: string; // the person's reply: `Queued for the next step` until it is answered
    parentid: string;
    revised: boolean;
    edited: boolean;
    at: string; // the council's clock when it was posted (`2:12`)
}

function replyPost(c: Council, r: CouncilReply): ReplyPost {
    const mine = r.author === YOU;
    return {
        kind: "reply",
        id: r.id,
        ...whoIs(c, r.author),
        ...replyPill(r),
        text: r.text,
        ...evidenceOf(r.evidence),
        mine,
        reaches: mine ? reachOf(c, r) : "",
        pending: mine ? replyLabel(c, r) : "",
        parentid: r.parentid ?? "",
        revised: !!r.revised,
        edited: !!r.edited,
        at: sinceStart(c, r.ts),
    };
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
            at: sinceStart(c, p.ts),
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
        at: sinceStart(c, r.ts),
        actions: DRAFT_ACTIONS,
    };
}

/** The reply chip under an idea: how many replies a person reads (a reaction is not one, a draft or a dropped reply not
 *  yet), who wrote them, when the last one came, and how many drafts wait in the thread. */
export interface IdeaThread {
    count: number;
    label: string; // `3 replies`, `1 reply`, `No replies yet`
    repliers: Who[]; // each author once, in the order they first replied
    last: string; // `Last reply 4:50`; empty with no replies
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
    picks: { count: number; label: string; title: string } | null; // `Picked by 2`; null when no seat picked it
    edited: boolean;
    at: string;
    thread: IdeaThread;
}

function ideaPost(c: Council, view: Council, p: CouncilProposal): IdeaPost {
    const replies = readableReplies(c)
        .filter((r) => r.proposalid === p.id)
        .sort((a, b) => a.ts - b.ts);
    const last = replies[replies.length - 1];
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
        picks:
            picked != null && picked > 0
                ? {
                      count: picked,
                      label: `Picked by ${picked}`,
                      title: `Picked by ${picked} of ${plural(panel(c).length, "expert", "experts")}`,
                  }
                : null,
        edited: !!p.edited,
        at: sinceStart(c, p.ts),
        thread: {
            count: replies.length,
            label: replies.length === 0 ? "No replies yet" : plural(replies.length, "reply", "replies"),
            repliers,
            last: last == null || sinceStart(c, last.ts) === "" ? "" : `Last reply ${sinceStart(c, last.ts)}`,
            drafts: heldDrafts(c).filter((d) => d.kind === "reply" && d.reply.proposalid === p.id).length,
        },
    };
}

// ---- the channel's other lines ----

export interface QuestionPost extends Who {
    kind: "question";
    id: "question";
    label: "sets the goal";
    text: string;
    at: string;
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

// where an item sits among the others: by time, a divider before the items of its round, then as it arrived
interface Entry {
    ts: number;
    rank: number;
    index: number;
    item: ChannelItem;
}

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

// the ideas that have a message, and so a thread, in the channel
function threadIds(c: Council): Set<string> {
    return new Set(sentProposals(c).map((p) => p.id));
}

/** Pure: the channel of a council, in time order: the person's question, a divider for each round reached, every idea
 *  (sent, or held as a draft), the lines where an agent skipped a turn, and the person's posts to the whole council with
 *  the answers to them (a reply with no idea of its own, held ones as drafts); then a failure line for each seat whose
 *  call failed, and last a typing row for each seat at work. Replies to an idea are not here: they are the idea's thread
 *  (`councilThread`). A dropped item is left out. */
export function councilChannel(c: Council): ChannelItem[] {
    const view = sentView(c);
    const threads = threadIds(c);
    const entries: Entry[] = [];
    const push = (ts: number, rank: number, item: ChannelItem) =>
        entries.push({ ts, rank, index: entries.length, item });

    for (const p of sentProposals(c)) {
        push(p.ts, 1, ideaPost(c, view, p));
    }
    for (const d of heldDrafts(c)) {
        if (d.kind === "idea" || !threads.has(d.reply.proposalid)) {
            push(d.ts, 1, draftPost(c, d));
        }
    }
    for (const r of readableReplies(c)) {
        if (!threads.has(r.proposalid)) {
            push(r.ts, 1, replyPost(c, r));
        }
    }
    for (const s of c.skips ?? []) {
        const seat = c.experts.find((e) => e.id === s.expert);
        push(s.ts, 1, {
            kind: "skip",
            id: `skip:${s.expert}:${s.round}:${s.ts}`,
            ...whoIs(c, s.expert),
            tab: seat?.agent ?? "",
            round: s.round,
            reason: s.reason,
            text: `${authorName(c, s.expert)} skipped round ${s.round}: ${s.reason}.`,
            at: sinceStart(c, s.ts),
        });
    }
    for (const { ts, line } of dividers(c)) {
        push(ts, 0, line);
    }

    const items = entries
        .sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : a.rank - b.rank || a.index - b.index))
        .map((e) => e.item);

    const question = (c.question ?? "").trim();
    if (question !== "") {
        items.unshift({
            kind: "question",
            id: "question",
            ...whoIs(c, YOU),
            label: "sets the goal",
            text: question,
            at: c.started ? sinceStart(c, c.started) : "",
        });
    }

    for (const e of c.experts) {
        const failure = c.failed?.[e.id];
        if (failure != null) {
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
        if (isLit(c, e.id) && act != null) {
            items.push(typingRow(c, e, act));
        }
    }
    return items;
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

/** Pure: the ideas j and k move over, in the order the channel draws them: the sent ones (a held draft has no thread to
 *  open). */
export function ideaOrder(c: Council): string[] {
    return councilChannel(c)
        .filter((i): i is IdeaPost => i.kind === "idea")
        .map((i) => i.id);
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
        tone: avatarTone(c, e.id),
        agent: isAgentSeat(e),
        tab: e.agent ?? "",
        kind: seatKind(e),
        ...seatState(c, view, e),
        retry: c.failed?.[e.id] != null,
        title: seatTitle(e),
    }));
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

/** Pure: who answers a message of the person's, for the line under a composer: the seats it @-mentions, else (in a
 *  thread) the idea's author and the seats on the path to the reply it answers, else (in the channel) everyone. An empty
 *  `proposalId` is the channel's composer. */
export function replyReach(
    c: Council,
    proposalId: string,
    parentId: string,
    text: string
): { names: string[]; label: string } {
    const names = answerers(c, proposalId, parentId, text).map((e) => e.name);
    if (names.length === 0) {
        return { names, label: "Name a seat with @ to choose who answers" };
    }
    if (proposalId === "" && parentId === "" && names.length === panel(c).length) {
        return { names, label: "Everyone answers" };
    }
    return { names, label: `Answered by: ${names.join(", ")}` };
}

// ---- the @ picker ----

// an @ that does not sit inside a word, and what has been typed after it up to the caret
const MENTION = /(^|[^\p{L}\p{N}_])@([^@\n]{0,40})$/u;

/** Pure: the seats the `@` picker lists while the person types, for the text before `caret`: the seats whose name or id
 *  holds what follows the `@`, and `start`, where that `@` sits (it is replaced by the seat's name, `insertMention`).
 *  Null when the caret is not right after an `@`, when no seat matches, and once a whole name and a space follow it, so
 *  the picker closes after a pick. */
export function mentionPicker(
    c: Council,
    text: string,
    caret: number
): { start: number; seats: CouncilExpert[] } | null {
    const found = MENTION.exec(text.slice(0, caret));
    if (found == null) {
        return null;
    }
    const query = found[2].toLowerCase();
    const seats = panel(c);
    if (seats.some((e) => [e.name, e.id].some((word) => word !== "" && query === `${word.toLowerCase()} `))) {
        return null;
    }
    const matching = seats.filter(
        (e) => query === "" || e.name.toLowerCase().includes(query) || e.id.toLowerCase().includes(query)
    );
    return matching.length > 0 ? { start: caret - found[2].length - 1, seats: matching } : null;
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
