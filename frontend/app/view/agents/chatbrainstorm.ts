// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The pure half of the brainstorm question card in Chat (docs/superpowers/specs/2026-11-11-chat-redesign-design.md,
// section 6): which transcript message is the answer to which question, and what the card has to draw for the
// question the brainstorm asks now. The send record lives in chatbrainstormstore.ts, the card in
// chatbrainstormcard.tsx, and the conversation draws both (chatconversation.tsx).

import {
    brainstormPhase,
    judgeWait,
    judgeWork,
    optionLetter,
    partTitle,
    plural,
    type AnswerOption,
    type BrainstormFile,
} from "./brainstormmodel";

/** An answer Arc sent to an agent's brainstorm question, kept so the transcript's user message that carries it can be
 *  drawn as the question's ✓ row. `seen` is how many of the agent's user messages already held exactly `text` when it
 *  was sent (the rule chatpending.ts's PendingMessage.seen uses): the transcript projection keeps no timestamp on a
 *  user entry, so the answer is the (`seen` + 1)-th message with that text, never an earlier one. `part` is the title
 *  the card's header shows, not the part's id. */
export interface SentAnswer {
    topic: string;
    n: number;
    part: string;
    text: string;
    sentAt: number;
    seen: number;
}

export const MAX_ANSWERS_PER_AGENT = 50;
export const MAX_ANSWER_AGENTS = 40;

/** The agent's records with `record` last (newest last), at most MAX_ANSWERS_PER_AGENT: the oldest are dropped. */
export function addAnswer(list: readonly SentAnswer[], record: SentAnswer): SentAnswer[] {
    return [...list, record].slice(-MAX_ANSWERS_PER_AGENT);
}

/** agent id -> its records, oldest first */
export type SentByAgent = Record<string, SentAnswer[]>;

/** Keeps the agents whose newest record is newest: a closed agent's id would otherwise stay in storage for good. */
export function pruneAnswerAgents(map: SentByAgent, max = MAX_ANSWER_AGENTS): SentByAgent {
    const ids = Object.keys(map);
    if (ids.length <= max) {
        return map;
    }
    const newest = (id: string) => map[id][map[id].length - 1]?.sentAt ?? 0;
    const keep = ids.sort((a, b) => newest(b) - newest(a)).slice(0, max);
    return Object.fromEntries(keep.map((id) => [id, map[id]]));
}

function isSentAnswer(v: unknown): v is SentAnswer {
    if (v == null || typeof v !== "object") {
        return false;
    }
    const r = v as Record<string, unknown>;
    return (
        typeof r.topic === "string" &&
        typeof r.n === "number" &&
        Number.isFinite(r.n) &&
        typeof r.part === "string" &&
        typeof r.text === "string" &&
        r.text !== "" &&
        typeof r.sentAt === "number" &&
        Number.isFinite(r.sentAt) &&
        typeof r.seen === "number" &&
        Number.isInteger(r.seen) &&
        r.seen >= 0
    );
}

/** The stored map, with whatever a hand-edited or older value could hold dropped: only the six record fields are kept. */
export function parseSentStore(raw: string | null | undefined): SentByAgent {
    if (!raw) {
        return {};
    }
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch {
        return {};
    }
    if (parsed == null || typeof parsed !== "object" || Array.isArray(parsed)) {
        return {};
    }
    const out: SentByAgent = {};
    for (const [id, list] of Object.entries(parsed as Record<string, unknown>)) {
        // assigning out["__proto__"] would swap the map's prototype instead of adding an agent
        if (id === "__proto__" || !Array.isArray(list)) {
            continue;
        }
        const records = list.filter(isSentAnswer).map((r) => ({
            topic: r.topic,
            n: r.n,
            part: r.part,
            text: r.text,
            sentAt: r.sentAt,
            seen: r.seen,
        }));
        if (records.length > 0) {
            out[id] = records.slice(-MAX_ANSWERS_PER_AGENT);
        }
    }
    return pruneAnswerAgents(out);
}

export interface PairedAnswer {
    n: number;
    part: string;
    text: string;
}

/** The user messages that are answers to a brainstorm question, by message key. A record of `topic` takes the
 *  (`seen` + 1)-th message whose text equals its own (edge whitespace aside), so a message that matches an option label
 *  by chance before the send is never taken. Records go oldest first, and a message an earlier record took is skipped:
 *  two answers with the same text sent before the first reached the transcript (both `seen` 0) take one message each.
 *  `userMessages` are the agent's user messages in transcript order. */
export function pairAnswers(
    records: readonly SentAnswer[],
    userMessages: readonly { key: string; text: string }[],
    topic: string
): Map<string, PairedAnswer> {
    const paired = new Map<string, PairedAnswer>();
    const mine = records.filter((r) => r.topic === topic).sort((a, b) => a.sentAt - b.sentAt);
    for (const r of mine) {
        const want = r.text.trim();
        let skip = r.seen;
        for (const m of userMessages) {
            if (m.text.trim() !== want) {
                continue;
            }
            if (skip > 0) {
                skip--;
                continue;
            }
            if (paired.has(m.key)) {
                continue;
            }
            paired.set(m.key, { n: r.n, part: r.part, text: r.text });
            break;
        }
    }
    return paired;
}

/** What the card draws for a question the brainstorm asks now. `waiting` is the user's turn; `weighing` is the judge at
 *  work on an approach question (no options yet); `static` is an agent that has exited (the card stays, without the
 *  amber dot, and still opens in Brainstorm). */
export interface QuestionCard {
    state: "waiting" | "weighing" | "static";
    n: number;
    /** the part's title as the file defines it (its id when the file defines none); empty when the question names none */
    part: string;
    question: string;
    why: string | null;
    options: AnswerOption[];
    /** the index of the option the agent (or the judge, on a weighed question) recommends */
    pick: number | null;
    pickLabel: "Agent's pick" | "Judge's pick";
    read: string | null;
    multi: boolean;
    /** neither options nor a judge at work: the answer is typed in the box */
    openText: boolean;
    /** how many approaches the judge is weighing, while it weighs */
    weighing: number | null;
    /** the asked part's boards, which stay in the Brainstorm tab */
    boards: number;
    /** some option carries pros and cons, which also stay there */
    reasons: boolean;
}

/** The brainstorm is past its questions: the builder check or the run stays in the Brainstorm tab, and the card is one
 *  line pointing there. */
export interface PointerCard {
    state: "pointer";
    phase: "check" | "run";
    line: string;
}

export type OpenQuestion = QuestionCard | PointerCard;

const POINTER_LINE = {
    check: "The builder check runs in the Brainstorm tab.",
    run: "This brainstorm has started a run. Follow it in the Brainstorm tab.",
};

/** The question to draw at the end of the conversation, or null: no brainstorm attached, no question open (the design
 *  is being reviewed, or the agent is writing), or the question already answered by a record of `topic`. Pass the file
 *  as Arc shows it (`shownBrainstormFile`), whose question is already gone once an answer was sent. With no question
 *  open, a brainstorm in its builder check or its run is a pointer. */
export function openQuestion(
    file: BrainstormFile | null,
    records: readonly SentAnswer[],
    exited: boolean,
    topic: string
): OpenQuestion | null {
    if (file == null) {
        return null;
    }
    const q = file.question;
    if (q == null) {
        const phase = brainstormPhase(file);
        return phase === "talk" ? null : { state: "pointer", phase, line: POINTER_LINE[phase] };
    }
    if (records.some((r) => r.topic === topic && r.n === q.n)) {
        return null;
    }
    // the agent writing with a question still in the file is taking a change in: nothing to answer until it asks again
    const judging = judgeWait(file, false);
    if (file.working != null && !judging) {
        return null;
    }
    const options = q.options ?? [];
    const weighing = judging ? (q.approaches?.length ?? 0) : null;
    const pick = options.findIndex((o) => o.pick === true);
    const part = q.part !== "" ? partTitle(file, q.part) : "";
    const asked = file.parts.find((p) => p.id === q.part);
    return {
        state: exited ? "static" : judging ? "weighing" : "waiting",
        n: q.n,
        part,
        question: q.text,
        why: q.why ?? null,
        options,
        pick: pick >= 0 ? pick : null,
        pickLabel: judgeWork(q)?.judged ? "Judge's pick" : "Agent's pick",
        read: q.read ?? null,
        multi: q.multi === true,
        openText: options.length === 0 && !judging,
        weighing,
        boards: file.canvas != null ? (asked?.boards?.length ?? 0) : 0,
        reasons: options.some((o) => o.pros != null || o.cons != null),
    };
}

/** "Question 2 · Motion", or "Question 2" when the question names no part: the card's header and the ✓ row's start. */
export function questionHead(n: number, part: string): string {
    return part !== "" ? `Question ${n} · ${part}` : `Question ${n}`;
}

/** The line the card shows while the judge weighs a question. */
export function weighingLine(approaches: number): string {
    return `The judge is weighing ${plural(approaches, "approach", "approaches")}.`;
}

/** "Compare 2 boards in Brainstorm": the card's footer link, which opens the Brainstorm tab. */
export function compareLine(boards: number): string {
    return `Compare ${plural(boards, "board", "boards")} in Brainstorm`;
}

/** The message box's placeholder while the question waits, or null when no question waits (a pointer). A question with
 *  options says they can be picked above (`A–C`); one with none, or one the judge is still weighing, is answered in
 *  words only. */
export function questionPlaceholder(q: OpenQuestion): string | null {
    if (q.state === "pointer") {
        return null;
    }
    const own = `Answer question ${q.n} in your own words`;
    if (q.options.length === 0) {
        return own;
    }
    const last = optionLetter(q.options.length - 1);
    return q.options.length === 1 ? `${own}, or pick A above` : `${own}, or pick A–${last} above`;
}
