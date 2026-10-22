// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The running council as a group chat (councilfeed.tsx): the question the person asked, every idea and reply in the order
// it was posted, a line where one step hands over to the next, and a row for each expert that is writing right now. The
// words a message carries are the plain ones: Review `proposes`, Brainstorm `idea` and `wild idea`, a reply `builds on it`
// (Brainstorm), `has doubts`, `is against it` or `replies`, the person's `sets the goal`, `steers` (the whole council) and
// `replies`. Agreement with nothing to add is a reaction on the idea's message, never an item. Pure, no React, no Wave
// runtime imports, so every rule here has a test (councilfeedmodel.test.ts); councildiscussionmodel.ts keeps the rules of
// the thread this feed replaces while a council runs.

import { evidenceChip, reactions, sinceStart } from "./councildiscussionmodel";
import { authorName, readableReplies } from "./councilmodel";

const YOU = "you";

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export interface FeedItem {
    kind: "system" | "message" | "typing";
    id?: string; // the idea's or the reply's id; `typing:<expert>` for a typing row
    author?: string; // an expert id, or `you`
    label?: string; // the plain word beside the name
    title?: string; // an idea's title (its message headline); the text is its argument
    on?: string; // the title of the idea a reply is about
    proposalid?: string; // the idea a message is about (an idea's own message: its id); empty for the whole council
    text: string;
    evidence?: string[]; // the references the message cites
    weak?: string; // a claim marked weak, as the chip reads (`Weak · no measurement`)
    reactions?: string[]; // `New user agrees`, on an idea's message
    mine?: boolean; // a message of the person's
    at?: string; // the council's clock when it was posted (`2:12`)
}

/** Pure: whether a council is Brainstorm; an empty, missing or unknown mode reads as Review (councils saved before
 *  modes have none). */
export function isBrainstorm(c: Council): boolean {
    return c.mode === "brainstorm";
}

/** Pure: the mode in a word, for the Discussion's chip. */
export function modeWord(c: Council): "Review" | "Brainstorm" {
    return isBrainstorm(c) ? "Brainstorm" : "Review";
}

/** Pure: a council that waits for the one running council to end. */
export function isQueued(c: Council): boolean {
    return c.state === "queued";
}

/** Pure: whether the Discussion's body is the feed: while a council with ideas is running its argument or its answer.
 *  The experts' first step, the pause, a council that is over and a follow-up keep their own bodies. */
export function showsFeed(c: Council): boolean {
    return c.state === "running" && (c.round === 2 || c.round === 3) && (c.proposals ?? []).length > 0;
}

/** Pure: which of the three steps a council is in, and the three steps' names in its mode. A follow-up stays on the last
 *  one; a council that has not started is on the first. */
export function stepOf(c: Council): { step: 1 | 2 | 3; words: [string, string, string] } {
    const step = c.round >= 3 ? 3 : c.round === 2 ? 2 : 1;
    const words: [string, string, string] = isBrainstorm(c)
        ? ["Ideas", "Build on each other", "Pick the best"]
        : ["Read and propose", "Argue", "Write the answer"];
    return { step, words };
}

// ---- one message ----

function evidenceOf(list: CouncilEvidence[] | undefined): Pick<FeedItem, "evidence" | "weak"> {
    const chips = (list ?? []).map(evidenceChip);
    const refs = chips.filter((chip) => !chip.weak && chip.text !== "").map((chip) => chip.text);
    const weak = chips.filter((chip) => chip.weak).map((chip) => chip.text);
    const out: Pick<FeedItem, "evidence" | "weak"> = {};
    if (refs.length > 0) {
        out.evidence = refs;
    }
    if (weak.length > 0) {
        out.weak = weak.join("; ");
    }
    return out;
}

function proposalLabel(c: Council, p: CouncilProposal): string {
    if (isBrainstorm(c)) {
        return p.wild ? "wild idea" : "idea";
    }
    return "proposes";
}

function replyWord(c: Council, r: CouncilReply): string {
    if (r.author === YOU) {
        return r.proposalid ? "replies" : "steers";
    }
    if (r.builds && isBrainstorm(c)) {
        return "builds on it";
    }
    switch (r.stance) {
        case "challenge":
            return "has doubts";
        case "oppose":
            return "is against it";
        default:
            return "replies";
    }
}

// ---- the feed ----

// where an entry sits among the others: by time, then ideas before a step's line before replies, then as it arrived
interface Entry {
    ts: number;
    rank: number;
    index: number;
    item: FeedItem;
}

/** Pure: the feed of a council: its question as the first message, then the ideas, the replies and the lines between
 *  the steps in the order they were posted, then a typing row for each expert that is writing (last, as it is the
 *  newest thing). With `onProposal` only that idea's message, its replies and the typing on it. */
export function councilFeed(c: Council, onProposal?: string): FeedItem[] {
    const filter = onProposal != null && onProposal !== "";
    const proposals = c.proposals ?? [];
    const titleOf = (id: string | undefined) => proposals.find((p) => p.id === id)?.title;
    const entries: Entry[] = [];
    const push = (ts: number, rank: number, item: FeedItem) => entries.push({ ts, rank, index: entries.length, item });

    for (const p of proposals) {
        if (filter && p.id !== onProposal) {
            continue;
        }
        const agrees = reactions(c, p.id);
        push(p.ts, 0, {
            kind: "message",
            id: p.id,
            author: p.author,
            label: proposalLabel(c, p),
            title: p.title,
            proposalid: p.id,
            text: p.argument,
            ...evidenceOf(p.evidence),
            ...(agrees.length > 0 ? { reactions: agrees } : {}),
            at: sinceStart(c, p.ts),
        });
    }

    for (const r of readableReplies(c)) {
        if (filter && r.proposalid !== onProposal) {
            continue;
        }
        const on = titleOf(r.proposalid);
        const mine = r.author === YOU;
        push(r.ts, 2, {
            kind: "message",
            id: r.id,
            author: r.author,
            label: replyWord(c, r),
            ...(on != null ? { on } : {}),
            proposalid: r.proposalid,
            text: r.text,
            ...evidenceOf(r.evidence),
            ...(mine ? { mine: true } : {}),
            at: sinceStart(c, r.ts),
        });
    }

    if (!filter) {
        for (const line of stepLines(c)) {
            push(line.ts, 1, line.item);
        }
    }

    const items = entries.sort((a, b) => a.ts - b.ts || a.rank - b.rank || a.index - b.index).map((e) => e.item);

    const question = (c.question ?? "").trim();
    if (!filter && question !== "") {
        const at = c.started ? sinceStart(c, c.started) : "";
        items.unshift({
            kind: "message",
            author: YOU,
            label: "sets the goal",
            text: question,
            mine: true,
            ...(at !== "" ? { at } : {}),
        });
    }

    if (c.state === "running") {
        for (const e of c.experts) {
            const act = c.activity?.[e.id];
            if (act == null || (filter && act.proposalid !== onProposal)) {
                continue;
            }
            const on = titleOf(act.proposalid);
            items.push({
                kind: "typing",
                id: `typing:${e.id}`,
                author: e.id,
                text: `${authorName(c, e.id)} is writing…`,
                ...(on != null ? { on, proposalid: act.proposalid } : {}),
            });
        }
    }
    return items;
}

// the lines where a step hands over to the next, each with the council's time it happened at. The start of the argument
// is the last idea that came before the first reply of the argument; the start of the answer the last reply before it.
function stepLines(c: Council): { ts: number; item: FeedItem }[] {
    const out: { ts: number; item: FeedItem }[] = [];
    const proposals = c.proposals ?? [];
    const replies = c.replies ?? [];
    if (c.round < 2 || proposals.length === 0) {
        return out;
    }
    const brainstorm = isBrainstorm(c);
    const line = (ts: number, ...parts: string[]): { ts: number; item: FeedItem } => {
        const at = sinceStart(c, ts);
        return {
            ts,
            item: {
                kind: "system",
                text: [at, ...parts].filter((p) => p !== "").join(" · "),
                ...(at !== "" ? { at } : {}),
            },
        };
    };

    const argueFrom = replies.filter((r) => r.round >= 2).map((r) => r.ts);
    const firstArgument = argueFrom.length > 0 ? Math.min(...argueFrom) : Infinity;
    const leading = proposals.filter((p) => p.ts <= firstArgument);
    const early = leading.length > 0 ? leading : proposals;
    const argueAt = Math.max(...early.map((p) => p.ts));
    const authors = new Set(early.map((p) => p.author));
    out.push(
        line(
            argueAt,
            `${plural(early.length, "idea", "ideas")} from ${plural(authors.size, "expert", "experts")}`,
            brainstorm ? "now they build on each other" : "now they argue"
        )
    );

    if (c.round >= 3) {
        const answered = replies.filter((r) => r.round <= 2).map((r) => r.ts);
        const answerAt = Math.max(argueAt, ...answered);
        const count = readableReplies(c).filter((r) => r.round <= 2 && r.ts <= answerAt).length;
        out.push(
            line(
                answerAt,
                plural(count, "reply", "replies"),
                brainstorm ? "now the coordinator picks the best" : "now the coordinator writes the answer"
            )
        );
    }
    return out;
}
