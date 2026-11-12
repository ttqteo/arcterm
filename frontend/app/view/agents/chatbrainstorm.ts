// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The pure half of the brainstorm question card in Chat (docs/superpowers/specs/2026-11-11-chat-redesign-design.md,
// section 6): which transcript message is the answer to which question, and what the card has to draw for the
// question the brainstorm asks now. The send record lives in chatbrainstormstore.ts, the card in
// chatbrainstormcard.tsx, and the conversation draws both (chatconversation.tsx).

import {
    brainstormPhase,
    decisionParts,
    judgeWait,
    judgeWork,
    optionLetter,
    partGist,
    partTitle,
    plural,
    type AnswerOption,
    type BrainstormFile,
    type BrainstormQuestion,
    type BuilderCheckView,
} from "./brainstormmodel";
import type { RunInfo } from "./runlineage";
import { runStage, type RunStageView } from "./runstage";

/** What a line Arc sent to the agent's brainstorm was, so the conversation can draw the message that carries it: an
 *  `answer` to a talk question or a `builder-answer` to the builder's become ✓ rows, `design` (check), `builder`
 *  (approved or keep talking) and `run` are the steps' rows, and an `action` (confirm, edit, keep, guess…) is hidden. */
export type RecordKind = "answer" | "builder-answer" | "design" | "builder" | "run" | "action";

export type BuilderOutcome = "approved" | "keep-talking";

/** A line Arc sent to an agent's brainstorm, kept so the transcript's user message that carries it can be drawn as the
 *  question's (or the step's) ✓ row, or hidden. `seen` is how many of the agent's user messages already held exactly
 *  `text` when it was sent (the rule chatpending.ts's PendingMessage.seen uses): the transcript projection keeps no
 *  timestamp on a user entry, so the line is the (`seen` + 1)-th message with that text, never an earlier one. `part`
 *  is the title the card's header shows, not the part's id. `kind` is what the line was (a record without one is an
 *  answer: the store held only answers once). A record other than an answer or a builder answer stores `n` 0 and `part`
 *  "", and carries the counts its ✓ row shows, captured when it was sent. */
export interface SentAnswer {
    topic: string;
    n: number;
    part: string;
    text: string;
    sentAt: number;
    seen: number;
    kind?: RecordKind;
    /** design: the decisions the design held when it was confirmed */
    decisions?: number;
    /** builder: the questions the builder left for the user */
    questions?: number;
    /** builder: the decisions the agent made itself */
    calls?: number;
    outcome?: BuilderOutcome;
    /** run: the run the brainstorm started */
    runId?: string;
}

export function recordKind(r: Pick<SentAnswer, "kind">): RecordKind {
    return r.kind ?? "answer";
}

const BUILDER_ANSWER_PREFIX = "brainstorm: builder answer:";

/** The answer a builder-answer record's line carries: a record's text is the whole line Arc sent (pairing matches the
 *  transcript), so the ✓ row strips its prefix. A text without the prefix comes back trimmed as it is. */
export function builderAnswerText(line: string): string {
    const text = line.trim();
    return text.startsWith(BUILDER_ANSWER_PREFIX) ? text.slice(BUILDER_ANSWER_PREFIX.length).trim() : text;
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

/** What a paired message draws: the record's kind and the fields its row shows. */
export interface PairedAnswer extends Pick<
    SentAnswer,
    "n" | "part" | "text" | "decisions" | "questions" | "calls" | "outcome" | "runId"
> {
    kind: RecordKind;
}

// the fields a record carries, with a field it does not carry left off rather than set to undefined
function pairedOf(r: SentAnswer): PairedAnswer {
    const p: PairedAnswer = { n: r.n, part: r.part, text: r.text, kind: recordKind(r) };
    if (r.decisions !== undefined) {
        p.decisions = r.decisions;
    }
    if (r.questions !== undefined) {
        p.questions = r.questions;
    }
    if (r.calls !== undefined) {
        p.calls = r.calls;
    }
    if (r.outcome !== undefined) {
        p.outcome = r.outcome;
    }
    if (r.runId !== undefined) {
        p.runId = r.runId;
    }
    return p;
}

/** The user messages that are lines Arc sent (answers to a brainstorm question, and the step lines), by message key. A
 *  record of `topic` takes the (`seen` + 1)-th message whose text equals its own (edge whitespace aside), so a message
 *  that matches an option label by chance before the send is never taken. Records go oldest first, and a message an
 *  earlier record took is skipped: two answers with the same text sent before the first reached the transcript (both
 *  `seen` 0) take one message each.
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
            paired.set(m.key, pairedOf(r));
            break;
        }
    }
    return paired;
}

/** What the card draws for a question the brainstorm asks now. `waiting` is the user's turn; `weighing` is the judge at
 *  work on an approach question (no options yet); `static` is an agent that has exited (the card stays, without the
 *  amber dot, and still opens in Brainstorm). */
export interface QuestionCard {
    kind: "question";
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
    /** the decisions that are yours so far, in the design's order: the card's `Decided N ›` fold */
    decided: Gist[];
}

/** One decision as a line of a fold: its title and the one line the design reads it as (`partGist`). */
export type Gist = { id: string; title: string; gist: string };

/** One decision that needs the user, as the Confirm card (and the check's review) draws a row: a guess, or a decision the
 *  agent changed since the user confirmed it (`was`, `why`). `isNew` is a decision the user has not seen yet. */
export type DecisionRowModel = {
    id: string;
    title: string;
    gist: string;
    view: "guess" | "changed";
    was?: string;
    why?: string;
    isNew: boolean;
};

/** The design awaits review: the line and the one action `reviewHead` offers, a row per decision that needs the user,
 *  and the ones already yours (folded into `N yours ›`). `working` is the agent writing up a click (its buttons off). */
export type ConfirmCard = {
    kind: "confirm";
    state: "waiting" | "working" | "static";
    line: string;
    action: "confirm-all" | "check" | null;
    guesses: number;
    rows: DecisionRowModel[];
    yours: Gist[];
};

/** The builder question the card asks now: the first one the builder left unanswered, `n` of `total`. */
export type BuilderQuestionCard = {
    n: number;
    total: number;
    part: string;
    question: string;
    why: string | null;
    options: AnswerOption[];
    pick: number | null;
};

/** The builder check: a builder reading, the agent taking its questions in, a failed check, a question for the user, or
 *  the review once nothing is open (`rows` still need the user; `approveBlocker` says why Approve is off). */
export type CheckCard = {
    kind: "check";
    state: "waiting" | "working" | "static";
    stage: "reading" | "taking-in" | "failed" | "asking" | "review";
    pending: Extract<BuilderCheckView, { kind: "pending" }> | null;
    reason: string | null;
    question: BuilderQuestionCard | null;
    calls: string[];
    spec: string[];
    rows: DecisionRowModel[];
    approveBlocker: string | null;
};

/** A run the brainstorm started; the run itself is read from the run store when the card draws. */
export type RunCard = { kind: "run"; state: "waiting" | "static"; runId: string };

export type ChatCard = QuestionCard | ConfirmCard | CheckCard | RunCard;

/** What a run card (and its ✓ row) says of the run: its name, which kind of run it is, its stage (null while Arc does not
 *  know the run), and whether it is over: landed, complete or cancelled. */
export type RunCardView = {
    name: string;
    kind: "Orchestrator run" | "Quick run";
    stage: RunStageView | null;
    done: boolean;
};

const RUN_DONE_STAGES: ReadonlySet<string> = new Set(["landed", "complete", "cancelled"]);

export function runCardView(info: RunInfo | undefined): RunCardView {
    if (info == null) {
        return { name: "", kind: "Orchestrator run", stage: null, done: false };
    }
    const stage = runStage(info);
    return {
        name: info.title,
        kind: info.mode === "quick" ? "Quick run" : "Orchestrator run",
        stage,
        done: RUN_DONE_STAGES.has(stage.key),
    };
}

/** The decisions that are yours, in the design's order (notes left out), each as its one line. */
export function yoursGists(file: BrainstormFile): Gist[] {
    return decisionParts(file)
        .filter((p) => p.state === "yours")
        .map((p) => ({ id: p.id, title: p.title, gist: partGist(file, p) }));
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
    if (file.working != null && !judgeWait(file, false)) {
        return null;
    }
    return questionCard(file, q, exited);
}

/** The card for the question `q` of `file`, whatever else the file is doing: the caller decides whether it shows. */
export function questionCard(file: BrainstormFile, q: BrainstormQuestion, exited: boolean): QuestionCard {
    const judging = judgeWait(file, false);
    const options = q.options ?? [];
    const weighing = judging ? (q.approaches?.length ?? 0) : null;
    const pick = options.findIndex((o) => o.pick === true);
    const part = q.part !== "" ? partTitle(file, q.part) : "";
    const asked = file.parts.find((p) => p.id === q.part);
    return {
        kind: "question",
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
        decided: yoursGists(file),
    };
}

/** "Question 2 · Motion", or "Question 2" when the question names no part: the card's header and the ✓ row's start. */
export function questionHead(n: number, part: string): string {
    return part !== "" ? `Question ${n} · ${part}` : `Question ${n}`;
}

/** "Builder question 2 · Motion", or "Builder question 2" when the question names no part: the builder question card's
 *  header and its ✓ row's start. */
export function builderQuestionHead(n: number, part: string): string {
    return part !== "" ? `Builder question ${n} · ${part}` : `Builder question ${n}`;
}

/** The ✓ row of a confirmed design: "Design confirmed · 9 decisions". */
export function designDoneLine(decisions: number): string {
    return `Design confirmed · ${plural(decisions, "decision", "decisions")}`;
}

/** The ✓ row of a finished builder check: "Builder check · 2 questions, 3 calls", with " · kept talking" when the
 *  person went back to talking instead of approving. */
export function builderDoneLine(questions: number, calls: number, outcome?: BuilderOutcome): string {
    const counts = `${plural(questions, "question", "questions")}, ${plural(calls, "call", "calls")}`;
    return `Builder check · ${counts}${outcome === "keep-talking" ? " · kept talking" : ""}`;
}

/** The ✓ row of a run that is over: "Run · <name> · <stage label>", leaving out a part the view does not have. */
export function runDoneLine(v: RunCardView): string {
    return ["Run", v.name, v.stage?.label ?? ""].filter((s) => s !== "").join(" · ");
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
