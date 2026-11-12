// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
    approveBlocker,
    brainstormLine,
    reviewHead,
    seenMark,
    shownFile,
    type BrainstormAction,
    type BrainstormFile,
    type BrainstormPart,
    type BrainstormQuestion,
    type BuilderCheck,
    type BuilderCheckView,
} from "./brainstormmodel";
import {
    addAnswer,
    brainstormCard,
    builderAnswerText,
    builderDoneLine,
    builderQuestionHead,
    compareLine,
    designDoneLine,
    MAX_ANSWERS_PER_AGENT,
    openQuestion,
    pairAnswers,
    parseSentStore,
    pruneAnswerAgents,
    questionHead,
    questionPlaceholder,
    recordKind,
    runCardView,
    runDoneLine,
    sendRecord,
    weighingLine,
    type CardInput,
    type ChatCard,
    type OpenQuestion,
    type QuestionCard,
    type SentAnswer,
} from "./chatbrainstorm";
import type { RunInfo } from "./runlineage";

const TOPIC = "chat-redesign";

function rec(over: Partial<SentAnswer> = {}): SentAnswer {
    return { topic: TOPIC, n: 1, part: "Scope", text: "A", sentAt: 1000, seen: 0, ...over };
}

const msgs = (...texts: string[]) => texts.map((text, i) => ({ key: `u${i}`, text }));

describe("pairAnswers", () => {
    it("pairs the message after the `seen` ones", () => {
        const paired = pairAnswers([rec({ text: "Fade", seen: 0 })], msgs("hello", "Fade", "later"), TOPIC);
        expect([...paired.keys()]).toEqual(["u1"]);
        expect(paired.get("u1")).toEqual({ n: 1, part: "Scope", text: "Fade", kind: "answer" });
    });

    it("carries a record's kind and its counts through to the message it takes", () => {
        const records = [
            rec({ n: 0, part: "", text: "brainstorm: check", kind: "design", decisions: 9, sentAt: 1000 }),
            rec({
                n: 0,
                part: "",
                text: "brainstorm: keep talking",
                kind: "builder",
                questions: 2,
                calls: 3,
                outcome: "keep-talking",
                sentAt: 2000,
            }),
            rec({ n: 0, part: "", text: "brainstorm: run r-1", kind: "run", runId: "r-1", sentAt: 3000 }),
            rec({
                n: 2,
                part: "Motion",
                text: "brainstorm: builder answer: Fade",
                kind: "builder-answer",
                sentAt: 4000,
            }),
        ];
        const paired = pairAnswers(
            records,
            msgs(
                "brainstorm: check",
                "brainstorm: keep talking",
                "brainstorm: run r-1",
                "brainstorm: builder answer: Fade"
            ),
            TOPIC
        );
        expect(paired.get("u0")).toEqual({
            n: 0,
            part: "",
            text: "brainstorm: check",
            kind: "design",
            decisions: 9,
        });
        expect(paired.get("u1")).toEqual({
            n: 0,
            part: "",
            text: "brainstorm: keep talking",
            kind: "builder",
            questions: 2,
            calls: 3,
            outcome: "keep-talking",
        });
        expect(paired.get("u2")).toMatchObject({ kind: "run", runId: "r-1" });
        expect(paired.get("u3")).toMatchObject({ kind: "builder-answer", n: 2, part: "Motion" });
        // a field the record does not carry is absent, not undefined
        expect(Object.keys(paired.get("u2")!).sort()).toEqual(["kind", "n", "part", "runId", "text"]);
    });

    it("never takes a same-text message that was already there when the answer was sent", () => {
        // the user typed "Fade" before the question was asked: seen 1 skips it
        const messages = msgs("Fade", "go on", "Fade");
        const paired = pairAnswers([rec({ text: "Fade", seen: 1 })], messages, TOPIC);
        expect([...paired.keys()]).toEqual(["u2"]);
    });

    it("pairs nothing while the answer has not reached the transcript", () => {
        expect(pairAnswers([rec({ text: "Fade", seen: 1 })], msgs("Fade"), TOPIC).size).toBe(0);
    });

    it("pairs every answered question, not only the latest", () => {
        const records = [
            rec({ n: 1, part: "Scope", text: "A", sentAt: 1000 }),
            rec({ n: 2, part: "Motion", text: "Fade + scale", sentAt: 2000 }),
        ];
        const paired = pairAnswers(records, msgs("hi", "A", "ok", "Fade + scale"), TOPIC);
        expect(paired.get("u1")).toMatchObject({ n: 1, part: "Scope" });
        expect(paired.get("u3")).toMatchObject({ n: 2, part: "Motion" });
        expect(paired.size).toBe(2);
    });

    it("gives two answers with the same text one message each, even when neither had landed at the second send", () => {
        const records = [
            rec({ n: 1, text: "A", sentAt: 1000, seen: 0 }),
            rec({ n: 2, text: "A", sentAt: 2000, seen: 0 }),
        ];
        const paired = pairAnswers(records, msgs("A", "x", "A"), TOPIC);
        expect(paired.get("u0")?.n).toBe(1);
        expect(paired.get("u2")?.n).toBe(2);
    });

    it("counts a landed first answer in the second's `seen`", () => {
        const records = [
            rec({ n: 1, text: "A", sentAt: 1000, seen: 0 }),
            rec({ n: 2, text: "A", sentAt: 2000, seen: 1 }),
        ];
        const paired = pairAnswers(records, msgs("A", "A"), TOPIC);
        expect(paired.get("u0")?.n).toBe(1);
        expect(paired.get("u1")?.n).toBe(2);
    });

    it("ignores a record of another topic", () => {
        const paired = pairAnswers([rec({ topic: "other", text: "A" })], msgs("A"), TOPIC);
        expect(paired.size).toBe(0);
    });

    it("compares the text with its edge whitespace trimmed", () => {
        const paired = pairAnswers([rec({ text: "Fade" })], msgs("  Fade\n"), TOPIC);
        expect([...paired.keys()]).toEqual(["u0"]);
    });
});

describe("the send record", () => {
    it("keeps at most 50 records per agent, dropping the oldest", () => {
        let list: SentAnswer[] = [];
        for (let i = 0; i < MAX_ANSWERS_PER_AGENT + 3; i++) {
            list = addAnswer(list, rec({ n: i, sentAt: i }));
        }
        expect(list).toHaveLength(MAX_ANSWERS_PER_AGENT);
        expect(list[0].n).toBe(3);
        expect(list[list.length - 1].n).toBe(MAX_ANSWERS_PER_AGENT + 2);
    });

    it("reads back what was stored and drops what is malformed", () => {
        const good = rec({ n: 2 });
        const stored = {
            a1: [good, { topic: "t", n: "x", part: "", text: "A", sentAt: 1, seen: 0 }, { ...good, text: "" }, null],
            a2: "nope",
        };
        // JSON.stringify drops a literal __proto__, so the key is written into the text by hand
        const raw = JSON.stringify(stored).replace(/\}$/, `,"__proto__":${JSON.stringify([good])}}`);
        const read = parseSentStore(raw);
        expect(read).toEqual({ a1: [good] });
        expect(Object.getPrototypeOf(read)).toBe(Object.prototype);
    });

    it("keeps up to 200 records per agent, since every action line leaves one", () => {
        expect(MAX_ANSWERS_PER_AGENT).toBe(200);
        const many = Array.from({ length: 205 }, (_, i) => rec({ n: i, sentAt: i }));
        const read = parseSentStore(JSON.stringify({ a1: many }));
        expect(read.a1).toHaveLength(200);
        expect(read.a1[0].n).toBe(5);
    });

    it("reads an old record, written with no kind, as it was: an answer", () => {
        const old = { topic: TOPIC, n: 2, part: "Motion", text: "Fade", sentAt: 5, seen: 1 };
        const read = parseSentStore(JSON.stringify({ a1: [old] }));
        expect(read).toEqual({ a1: [old] });
        expect("kind" in read.a1[0]).toBe(false);
        expect(recordKind(read.a1[0])).toBe("answer");
    });

    it("keeps a record's kind and the counts its row shows when they are well-typed", () => {
        const stored: SentAnswer[] = [
            rec({ n: 0, part: "", text: "brainstorm: check", kind: "design", decisions: 9 }),
            rec({
                n: 0,
                part: "",
                text: "brainstorm: approved",
                kind: "builder",
                questions: 2,
                calls: 3,
                outcome: "approved",
            }),
            rec({ n: 0, part: "", text: "brainstorm: run r-1", kind: "run", runId: "r-1" }),
            rec({ n: 1, part: "Motion", text: "brainstorm: builder answer: Fade", kind: "builder-answer" }),
            rec({ n: 0, part: "", text: "brainstorm: guess", kind: "action" }),
        ];
        expect(parseSentStore(JSON.stringify({ a1: stored }))).toEqual({ a1: stored });
    });

    it("drops each field that is not well-typed and keeps the record", () => {
        const base = { topic: TOPIC, n: 0, part: "", sentAt: 5, seen: 0 };
        const bad = [
            { ...base, text: "a", kind: "design", decisions: "9" },
            { ...base, text: "b", kind: "mystery" },
            { ...base, text: "c", kind: 7 },
            { ...base, text: "d", kind: "builder", questions: -1, calls: 1.5, outcome: "gave-up" },
            { ...base, text: "e", kind: "run", runId: "" },
            { ...base, text: "f", kind: "run", runId: 12 },
            { ...base, text: "g", kind: "design", decisions: null },
        ];
        const read = parseSentStore(JSON.stringify({ a1: bad })).a1;
        expect(read).toEqual([
            { ...base, text: "a", kind: "design" },
            { ...base, text: "b" },
            { ...base, text: "c" },
            { ...base, text: "d", kind: "builder" },
            { ...base, text: "e", kind: "run" },
            { ...base, text: "f", kind: "run" },
            { ...base, text: "g", kind: "design" },
        ]);
    });

    it.each([null, undefined, "", "{", "[]", "3"])("reads %j as no records", (raw) => {
        expect(parseSentStore(raw as string | null | undefined)).toEqual({});
    });

    it("keeps the agents with the newest records when there are too many", () => {
        const map = { a: [rec({ sentAt: 1 })], b: [rec({ sentAt: 3 })], c: [rec({ sentAt: 2 })] };
        expect(Object.keys(pruneAnswerAgents(map, 2)).sort()).toEqual(["b", "c"]);
    });
});

const QUESTION: BrainstormQuestion = {
    n: 2,
    text: "Which motion?",
    part: "motion",
    why: "DESIGN.md allows one entrance.",
    read: "A keeps DESIGN.md.",
    options: [
        { label: "Fade + scale", detail: "tokens exist", pick: true },
        { label: "Slide up", detail: "needs an exception" },
        { label: "Box only", detail: "" },
    ],
};

function file(over: Partial<BrainstormFile> = {}): BrainstormFile {
    return {
        v: 1,
        title: "Chat redesign",
        spec: "docs/spec.md",
        canvas: "chat-redesign",
        question: QUESTION,
        working: null,
        parts: [
            { id: "motion", title: "Motion", state: "asked", body: "", boards: ["a.dc.html", "b.dc.html"] },
            { id: "scope", title: "Scope", state: "yours", body: "" },
        ],
        history: [],
        done: false,
        check: null,
        run: null,
        ...over,
    };
}

function card(q: OpenQuestion | null): QuestionCard {
    if (q == null || q.state === "pointer") {
        throw new Error("expected a question card");
    }
    return q;
}

describe("openQuestion", () => {
    it("draws a waiting card from the open question", () => {
        const q = card(openQuestion(file(), [], false, TOPIC));
        expect(q).toMatchObject({
            state: "waiting",
            n: 2,
            part: "Motion",
            question: "Which motion?",
            why: "DESIGN.md allows one entrance.",
            read: "A keeps DESIGN.md.",
            pick: 0,
            pickLabel: "Agent's pick",
            multi: false,
            openText: false,
            weighing: null,
            boards: 2,
            reasons: false,
        });
        expect(q.options).toHaveLength(3);
    });

    it("is a question card, and lists the decisions that are yours as it was asked", () => {
        const q = card(
            openQuestion(
                file({
                    parts: [
                        { id: "builder", title: "Builder", state: "yours", gist: "Sonnet builds it", body: "" },
                        { id: "motion", title: "Motion", state: "asked", body: "" },
                        { id: "scope", title: "Scope", state: "yours", gist: "Chat only", body: "" },
                        { id: "why", title: "Why", state: "yours", kind: "note", gist: "background", body: "" },
                        { id: "tone", title: "Tone", state: "guess", gist: "Quiet", body: "" },
                        { id: "icons", title: "Icons", state: "yours", gist: "", body: "Lucide. Kept small.\nMore." },
                    ],
                }),
                [],
                false,
                TOPIC
            )
        );
        expect(q.kind).toBe("question");
        // design order (the builder part last), notes, guesses and the asked part left out, the gist as the design reads it
        expect(q.decided).toEqual([
            { id: "scope", title: "Scope", gist: "Chat only" },
            { id: "icons", title: "Icons", gist: "Lucide." },
            { id: "builder", title: "Builder", gist: "Sonnet builds it" },
        ]);
    });

    it("has no decided entries while nothing is yours yet", () => {
        const q = card(
            openQuestion(
                file({ parts: [{ id: "motion", title: "Motion", state: "asked", body: "" }] }),
                [],
                false,
                TOPIC
            )
        );
        expect(q.decided).toEqual([]);
    });

    it("is null with no brainstorm attached, or with no question open in the talk", () => {
        expect(openQuestion(null, [], false, TOPIC)).toBeNull();
        expect(openQuestion(file({ question: null }), [], false, TOPIC)).toBeNull();
    });

    it("is null once a record of this topic answered the question, but not for another topic's", () => {
        expect(openQuestion(file(), [rec({ n: 2 })], false, TOPIC)).toBeNull();
        expect(openQuestion(file(), [rec({ n: 2, topic: "other" })], false, TOPIC)?.state).toBe("waiting");
        expect(openQuestion(file(), [rec({ n: 1 })], false, TOPIC)?.state).toBe("waiting");
    });

    it("is not hidden by a builder answer or an action line that shares its number", () => {
        expect(openQuestion(file(), [rec({ n: 2, kind: "builder-answer" })], false, TOPIC)?.state).toBe("waiting");
        expect(openQuestion(file(), [rec({ n: 2, kind: "answer" })], false, TOPIC)).toBeNull();
    });

    it("is weighing while the judge works on an approach question that has no options yet", () => {
        const weighed: BrainstormQuestion = {
            n: 3,
            text: "How should it arrive?",
            part: "motion",
            approaches: [
                { name: "Spring", description: "", facts: [] },
                { name: "Tween", description: "", facts: [] },
            ],
        };
        const q = card(
            openQuestion(file({ question: weighed, working: "The judge is weighing 2 approaches." }), [], false, TOPIC)
        );
        expect(q).toMatchObject({ state: "weighing", weighing: 2, openText: false, pick: null });
        expect(q.options).toEqual([]);
        expect(weighingLine(2)).toBe("The judge is weighing 2 approaches.");
        expect(weighingLine(1)).toBe("The judge is weighing 1 approach.");
    });

    it("is null while the agent writes with a question still in the file", () => {
        expect(openQuestion(file({ working: "Taking in your change." }), [], false, TOPIC)).toBeNull();
    });

    it("is static once the agent has exited, and still carries the question and its options", () => {
        const q = card(openQuestion(file(), [], true, TOPIC));
        expect(q.state).toBe("static");
        expect(q.options).toHaveLength(3);
        expect(q.question).toBe("Which motion?");
    });

    it("is open text when the question offers no options", () => {
        const q = card(openQuestion(file({ question: { ...QUESTION, options: undefined } }), [], false, TOPIC));
        expect(q).toMatchObject({ state: "waiting", openText: true, pick: null });
    });

    it("carries a multi-answer question's flag, a judged pick and the reasons", () => {
        const judged: BrainstormQuestion = {
            ...QUESTION,
            multi: true,
            judge: { kind: "weighed", added: [], dropped: [] },
            options: [
                { label: "A1", detail: "", pick: true, pros: ["fast"] },
                { label: "B1", detail: "" },
            ],
        };
        const q = card(openQuestion(file({ question: judged }), [], false, TOPIC));
        expect(q).toMatchObject({ multi: true, pickLabel: "Judge's pick", pick: 0, reasons: true });
    });

    it("counts boards only once the brainstorm names its canvas, and shows the part id for an undefined part", () => {
        expect(card(openQuestion(file({ canvas: undefined }), [], false, TOPIC)).boards).toBe(0);
        const stray = card(openQuestion(file({ question: { ...QUESTION, part: "ghost" } }), [], false, TOPIC));
        expect(stray).toMatchObject({ part: "ghost", boards: 0 });
        expect(card(openQuestion(file({ question: { ...QUESTION, part: "" } }), [], false, TOPIC)).part).toBe("");
    });

    it("is a pointer once the brainstorm reached the builder check or a run", () => {
        const check = { yours: [], calls: [], answered: [] };
        const atCheck = openQuestion(file({ question: null, done: true, check }), [], false, TOPIC);
        expect(atCheck).toMatchObject({ state: "pointer", phase: "check" });
        const atRun = openQuestion(file({ question: null, done: true, check, run: "run-1" }), [], true, TOPIC);
        expect(atRun).toMatchObject({ state: "pointer", phase: "run" });
        expect(atRun?.state === "pointer" && atRun.line).toContain("Brainstorm tab");
    });

    it("keeps a talk question open in the check a card", () => {
        const check = { yours: [], calls: [], answered: [] };
        expect(openQuestion(file({ done: true, check }), [], false, TOPIC)?.state).toBe("waiting");
    });
});

describe("questionPlaceholder", () => {
    it("tells how many options can be picked above", () => {
        const q = openQuestion(file(), [], false, TOPIC)!;
        expect(questionPlaceholder(q)).toBe("Answer question 2 in your own words, or pick A–C above");
    });

    it("says only the words for an open-text question, and for one the judge still weighs", () => {
        const open = openQuestion(file({ question: { ...QUESTION, options: undefined } }), [], false, TOPIC)!;
        expect(questionPlaceholder(open)).toBe("Answer question 2 in your own words");
        const judging = openQuestion(
            file({
                question: { n: 4, text: "q", part: "motion", approaches: [{ name: "x", description: "", facts: [] }] },
                working: "w",
            }),
            [],
            false,
            TOPIC
        )!;
        expect(questionPlaceholder(judging)).toBe("Answer question 4 in your own words");
    });

    it("names a single option, and has none for a pointer", () => {
        const one = openQuestion(
            file({ question: { ...QUESTION, options: [{ label: "Only", detail: "" }] } }),
            [],
            false,
            TOPIC
        )!;
        expect(questionPlaceholder(one)).toBe("Answer question 2 in your own words, or pick A above");
        expect(questionPlaceholder({ state: "pointer", phase: "check", line: "" })).toBeNull();
    });
});

describe("the card's lines", () => {
    it("heads a question with its part, or alone when it names none", () => {
        expect(questionHead(2, "Motion")).toBe("Question 2 · Motion");
        expect(questionHead(2, "")).toBe("Question 2");
    });

    it("counts the boards to compare", () => {
        expect(compareLine(2)).toBe("Compare 2 boards in Brainstorm");
        expect(compareLine(1)).toBe("Compare 1 board in Brainstorm");
    });

    it("says the design is confirmed with its decisions counted", () => {
        expect(designDoneLine(9)).toBe("Design confirmed · 9 decisions");
        expect(designDoneLine(1)).toBe("Design confirmed · 1 decision");
        expect(designDoneLine(0)).toBe("Design confirmed · 0 decisions");
    });

    it("says the builder check is done with its questions and calls counted", () => {
        expect(builderDoneLine(2, 3)).toBe("Builder check · 2 questions, 3 calls");
        expect(builderDoneLine(1, 1)).toBe("Builder check · 1 question, 1 call");
        expect(builderDoneLine(0, 0, "approved")).toBe("Builder check · 0 questions, 0 calls");
        expect(builderDoneLine(2, 3, "keep-talking")).toBe("Builder check · 2 questions, 3 calls · kept talking");
        expect(builderDoneLine(1, 1, "keep-talking")).toBe("Builder check · 1 question, 1 call · kept talking");
    });

    it("heads a builder question with its part, or alone when it names none", () => {
        expect(builderQuestionHead(2, "Motion")).toBe("Builder question 2 · Motion");
        expect(builderQuestionHead(2, "")).toBe("Builder question 2");
    });
});

describe("recordKind", () => {
    it("reads a record without a kind as an answer", () => {
        expect(recordKind(rec())).toBe("answer");
        expect(recordKind({})).toBe("answer");
    });

    it("reads the kind a record carries", () => {
        for (const kind of ["answer", "builder-answer", "design", "builder", "run", "action"] as const) {
            expect(recordKind(rec({ kind }))).toBe(kind);
        }
    });
});

describe("builderAnswerText", () => {
    it("strips the line's prefix, leaving the answer", () => {
        expect(builderAnswerText("brainstorm: builder answer: Fade + scale")).toBe("Fade + scale");
    });

    it("trims what is left, and keeps a colon inside the answer", () => {
        expect(builderAnswerText("brainstorm: builder answer:   Both: fade and scale \n")).toBe("Both: fade and scale");
    });

    it("gives a text without the prefix back trimmed", () => {
        expect(builderAnswerText("  Fade  ")).toBe("Fade");
        expect(builderAnswerText("brainstorm: check")).toBe("brainstorm: check");
        expect(builderAnswerText("")).toBe("");
    });
});

const dag = (status: string): TaskGroup => ({ status, tasks: [] }) as unknown as TaskGroup;

function run(over: Partial<RunInfo> = {}): RunInfo {
    return { runId: "r-1", channelId: "c-1", title: "Chat review cards", project: "arcterm", ...over };
}

describe("runCardView", () => {
    it("names an orchestrator run at work, with its stage", () => {
        const v = runCardView(run({ status: "executing", dag: dag("running") }));
        expect(v).toMatchObject({ name: "Chat review cards", kind: "Orchestrator run", done: false });
        expect(v.stage).toMatchObject({ key: "working", label: "Working" });
    });

    it("calls a run whose mode is quick a quick run", () => {
        const v = runCardView(run({ mode: "quick", status: "executing" }));
        expect(v).toMatchObject({ kind: "Quick run", done: false });
        expect(v.stage?.key).toBe("working");
    });

    it("is done once the run landed, or finished with nothing to land", () => {
        const landed = runCardView(run({ status: "done", land: { state: "landed" }, dag: dag("done") }));
        expect(landed.done).toBe(true);
        expect(landed.stage?.label).toBe("Landed");
        const complete = runCardView(run({ status: "done", dag: dag("done") }));
        expect(complete.done).toBe(true);
        expect(complete.stage?.label).toBe("Complete");
    });

    it("is done once the run was cancelled", () => {
        const v = runCardView(run({ status: "cancelled" }));
        expect(v.done).toBe(true);
        expect(v.stage?.label).toBe("Cancelled");
    });

    it("is not done while a landing waits or is held", () => {
        expect(runCardView(run({ status: "done", land: { state: "queued" }, dag: dag("done") })).done).toBe(false);
        expect(runCardView(run({ status: "done", land: { state: "held" }, dag: dag("done") })).done).toBe(false);
    });

    it("has no name, no stage and is not done for a run Arc does not know", () => {
        expect(runCardView(undefined)).toEqual({ name: "", kind: "Orchestrator run", stage: null, done: false });
    });
});

describe("runDoneLine", () => {
    it("names the run and the stage it ended in", () => {
        const v = runCardView(run({ status: "done", land: { state: "landed" }, dag: dag("done") }));
        expect(runDoneLine(v)).toBe("Run · Chat review cards · Landed");
        const cancelled = runCardView(run({ mode: "quick", status: "cancelled" }));
        expect(runDoneLine(cancelled)).toBe("Run · Chat review cards · Cancelled");
    });

    it("leaves out a part it does not have", () => {
        expect(runDoneLine(runCardView(undefined))).toBe("Run");
        expect(runDoneLine({ name: "Review cards", kind: "Quick run", stage: null, done: false })).toBe(
            "Run · Review cards"
        );
    });
});

// ---- brainstormCard: which card the conversation ends with, in each phase ----

const NO_CHECK: BuilderCheckView = { kind: "none" };
const READING: BuilderCheckView = { kind: "pending", stage: "reading", text: "A builder is reading the design." };
const TAKING_IN: BuilderCheckView = {
    kind: "pending",
    stage: "taking-in",
    text: "Taking in the builder's questions.",
};
const FAILED: BuilderCheckView = {
    kind: "failed",
    reason: "The agent ended its turn without starting the builder check.",
};

function inp(over: Partial<CardInput> = {}): CardInput {
    return {
        file: file(),
        records: [],
        exited: false,
        topic: TOPIC,
        check: NO_CHECK,
        sent: null,
        seen: null,
        starting: null,
        ...over,
    };
}

function pick<K extends ChatCard["kind"]>(c: ChatCard | null, kind: K): Extract<ChatCard, { kind: K }> {
    if (c == null || c.kind !== kind) {
        throw new Error(`expected a ${kind} card, got ${c?.kind ?? "none"}`);
    }
    return c as Extract<ChatCard, { kind: K }>;
}

const SCOPE: BrainstormPart = { id: "scope", title: "Scope", state: "yours", gist: "Chat only", body: "" };
const MOTION: BrainstormPart = { id: "motion", title: "Motion", state: "guess", gist: "Fade + scale", body: "" };
const TONE: BrainstormPart = { id: "tone", title: "Tone", state: "guess", gist: "Quiet", body: "" };
const ICONS: BrainstormPart = {
    id: "icons",
    title: "Icons",
    state: "guess",
    gist: "Phosphor",
    was: "Lucide",
    why: "You asked for outlines",
    body: "",
};

// the agent has stopped asking and the design awaits review: two guesses and one decision it changed since you confirmed it
function review(over: Partial<BrainstormFile> = {}): BrainstormFile {
    return file({ question: null, done: true, parts: [SCOPE, MOTION, TONE, ICONS], ...over });
}

// every decision is yours
function settled(over: Partial<BrainstormFile> = {}): BrainstormFile {
    const yours = (p: BrainstormPart): BrainstormPart => ({ ...p, state: "yours", was: undefined, why: undefined });
    return file({ question: null, done: true, parts: [SCOPE, yours(MOTION), yours(TONE)], ...over });
}

const BUILDER_CHECK: BuilderCheck = {
    yours: [
        { q: "Who owns retries?", part: "scope", a: "Platform" },
        {
            q: "Which queue?",
            part: "motion",
            why: "Both are in the stack.",
            options: [
                { label: "SQS", detail: "managed", pick: true },
                { label: "Kafka", detail: "already running" },
            ],
        },
    ],
    calls: [{ text: "Retries: 3, backed off", part: "scope" }],
    answered: ["The region is eu-west-1"],
};

// the builder answered every question for the user: nothing open
const BUILDER_DONE = { ...BUILDER_CHECK, yours: BUILDER_CHECK.yours.map((y) => ({ ...y, a: y.a ?? "SQS" })) };

describe("brainstormCard: the question", () => {
    it("is the question card while a question waits (asking), the same one openQuestion draws", () => {
        const c = pick(brainstormCard(inp()), "question");
        expect(c).toEqual(openQuestion(file(), [], false, TOPIC));
        expect(c).toMatchObject({
            kind: "question",
            state: "waiting",
            n: 2,
            part: "Motion",
            question: "Which motion?",
            why: "DESIGN.md allows one entrance.",
            read: "A keeps DESIGN.md.",
            pick: 0,
            pickLabel: "Agent's pick",
            multi: false,
            openText: false,
            weighing: null,
            boards: 2,
            reasons: false,
        });
        expect(c.options).toHaveLength(3);
    });

    it("lists the decisions that are yours as the card's Decided fold", () => {
        const c = pick(brainstormCard(inp({ file: file({ parts: [MOTION, SCOPE, TONE] }) })), "question");
        expect(c.decided).toEqual([{ id: "scope", title: "Scope", gist: "Chat only" }]);
        const none = pick(brainstormCard(inp({ file: file({ parts: [{ ...MOTION, state: "asked" }] }) })), "question");
        expect(none.decided).toEqual([]);
    });

    it("is weighing while the judge works on an approach question that has no options yet", () => {
        const weighed: BrainstormQuestion = {
            n: 3,
            text: "How should it arrive?",
            part: "motion",
            approaches: [
                { name: "Spring", description: "", facts: [] },
                { name: "Tween", description: "", facts: [] },
            ],
        };
        const c = pick(
            brainstormCard(inp({ file: file({ question: weighed, working: "The judge is weighing 2 approaches." }) })),
            "question"
        );
        expect(c).toMatchObject({ state: "weighing", weighing: 2, openText: false, pick: null });
        expect(c.options).toEqual([]);
    });

    it("is null while the agent writes with a question still in the file", () => {
        expect(brainstormCard(inp({ file: file({ working: "Taking in your change." }) }))).toBeNull();
    });

    it("is open text when the question offers no options", () => {
        const c = pick(
            brainstormCard(inp({ file: file({ question: { ...QUESTION, options: undefined } }) })),
            "question"
        );
        expect(c).toMatchObject({ state: "waiting", openText: true, pick: null });
    });

    it("carries a multi-answer question's flag, a judged pick and the reasons", () => {
        const judged: BrainstormQuestion = {
            ...QUESTION,
            multi: true,
            judge: { kind: "weighed", added: [], dropped: [] },
            options: [
                { label: "A1", detail: "", pick: true, pros: ["fast"] },
                { label: "B1", detail: "" },
            ],
        };
        const c = pick(brainstormCard(inp({ file: file({ question: judged }) })), "question");
        expect(c).toMatchObject({ multi: true, pickLabel: "Judge's pick", pick: 0, reasons: true });
    });

    it("counts boards only once the brainstorm names its canvas, and shows the part id for an undefined part", () => {
        expect(pick(brainstormCard(inp({ file: file({ canvas: undefined }) })), "question").boards).toBe(0);
        const stray = pick(
            brainstormCard(inp({ file: file({ question: { ...QUESTION, part: "ghost" } }) })),
            "question"
        );
        expect(stray).toMatchObject({ part: "ghost", boards: 0 });
        const none = pick(brainstormCard(inp({ file: file({ question: { ...QUESTION, part: "" } }) })), "question");
        expect(none.part).toBe("");
    });

    it("is static once the agent has exited, and still carries the question and its options", () => {
        const c = pick(brainstormCard(inp({ exited: true })), "question");
        expect(c.state).toBe("static");
        expect(c.options).toHaveLength(3);
        expect(c.question).toBe("Which motion?");
    });

    it("is gone once a record of this topic answered the question, but not for another topic's", () => {
        expect(brainstormCard(inp({ records: [rec({ n: 2 })] }))).toBeNull();
        expect(pick(brainstormCard(inp({ records: [rec({ n: 2, topic: "other" })] })), "question").state).toBe(
            "waiting"
        );
        expect(pick(brainstormCard(inp({ records: [rec({ n: 1 })] })), "question").state).toBe("waiting");
    });

    it("counts a record from before kinds existed as an answer", () => {
        const old: SentAnswer = { topic: TOPIC, n: 2, part: "Motion", text: "Fade", sentAt: 1, seen: 0 };
        expect(brainstormCard(inp({ records: [old] }))).toBeNull();
    });

    it("is not hidden by a builder answer with the same number", () => {
        const q1 = file({ question: { ...QUESTION, n: 1 } });
        const builder = rec({ n: 1, kind: "builder-answer", text: "brainstorm: builder answer: SQS" });
        expect(pick(brainstormCard(inp({ file: q1, records: [builder] })), "question").n).toBe(1);
        // nor by a step or an action line, which store n 0 anyway
        const action = rec({ n: 0, part: "", kind: "action", text: "brainstorm: guess" });
        expect(pick(brainstormCard(inp({ file: q1, records: [action] })), "question").n).toBe(1);
        // an answer record does hide it
        expect(brainstormCard(inp({ file: q1, records: [rec({ n: 1, kind: "answer" })] }))).toBeNull();
    });

    it("stays the question card in the check phase: the talk question comes first", () => {
        const c = brainstormCard(inp({ file: file({ done: true, check: BUILDER_CHECK }) }));
        expect(pick(c, "question").state).toBe("waiting");
    });

    it("wins over a pending check line and a design waiting for review", () => {
        expect(pick(brainstormCard(inp({ check: READING })), "question").n).toBe(2);
        expect(brainstormCard(inp({ file: file({ done: true }) }))?.kind).toBe("question");
    });

    it("is null with no brainstorm attached", () => {
        expect(brainstormCard(inp({ file: null }))).toBeNull();
        expect(brainstormCard(inp({ file: null, exited: true, sent: "check", check: READING }))).toBeNull();
    });
});

describe("brainstormCard: Confirm the design", () => {
    it("lists the guesses and the changed decision, and folds the ones that are yours", () => {
        const f = review();
        const c = pick(brainstormCard(inp({ file: f })), "confirm");
        expect(c).toMatchObject({ state: "waiting", action: "confirm-all", guesses: 2 });
        expect(c.line).toBe(reviewHead(f).line);
        expect(c.rows).toEqual([
            { id: "motion", title: "Motion", gist: "Fade + scale", view: "guess", isNew: false },
            { id: "tone", title: "Tone", gist: "Quiet", view: "guess", isNew: false },
            {
                id: "icons",
                title: "Icons",
                gist: "Phosphor",
                view: "changed",
                was: "Lucide",
                why: "You asked for outlines",
                isNew: false,
            },
        ]);
        expect(c.yours).toEqual([{ id: "scope", title: "Scope", gist: "Chat only" }]);
    });

    it("offers Confirm all from two guesses only, and shows a single guess as its own row", () => {
        const one = pick(brainstormCard(inp({ file: review({ parts: [SCOPE, MOTION] }) })), "confirm");
        expect(one).toMatchObject({ action: null, guesses: 1 });
        expect(one.rows.map((r) => r.id)).toEqual(["motion"]);
        // a changed decision is not a guess to confirm: it asks Keep or Put mine back
        const changed = pick(brainstormCard(inp({ file: review({ parts: [SCOPE, ICONS] }) })), "confirm");
        expect(changed).toMatchObject({ action: null, guesses: 0 });
        expect(changed.rows.map((r) => r.view)).toEqual(["changed"]);
    });

    it("has Check with a builder as its one action once every decision is yours, with every row folded", () => {
        const f = settled();
        const c = pick(brainstormCard(inp({ file: f })), "confirm");
        expect(c).toMatchObject({ state: "waiting", action: "check", guesses: 0, rows: [] });
        expect(c.line).toBe(reviewHead(f).line);
        expect(c.yours.map((g) => g.id)).toEqual(["scope", "motion", "tone"]);
    });

    it("leaves the notes out of the rows and of the yours", () => {
        const note: BrainstormPart = { id: "recon", title: "Recon", state: "guess", kind: "note", body: "x" };
        const c = pick(brainstormCard(inp({ file: review({ parts: [SCOPE, MOTION, TONE, note] }) })), "confirm");
        expect(c.rows.map((r) => r.id)).toEqual(["motion", "tone"]);
        expect(c.yours.map((g) => g.id)).toEqual(["scope"]);
    });

    it("is null while the agent still has questions: the question card is the open one", () => {
        expect(brainstormCard(inp({ file: review({ done: false }) }))).toBeNull();
    });

    it("is null when parts are still open and there is nothing to confirm", () => {
        const open: BrainstormPart = { id: "motion", title: "Motion", state: "open", body: "" };
        const asked: BrainstormPart = { ...open, id: "tone", title: "Tone", state: "asked" };
        expect(brainstormCard(inp({ file: review({ parts: [SCOPE, open, asked] }) }))).toBeNull();
        expect(brainstormCard(inp({ file: review({ parts: [] }) }))).toBeNull();
    });

    it("marks a guess that is new since the seen mark, and none without one", () => {
        const before = review({ parts: [SCOPE, MOTION, ICONS] });
        const now = review({ parts: [SCOPE, MOTION, TONE, ICONS] });
        const isNew = (c: ChatCard | null) => pick(c, "confirm").rows.map((r) => [r.id, r.isNew]);
        expect(isNew(brainstormCard(inp({ file: now, seen: seenMark(before) })))).toEqual([
            ["motion", false],
            ["tone", true],
            ["icons", false],
        ]);
        expect(isNew(brainstormCard(inp({ file: now, seen: null })))).toEqual([
            ["motion", false],
            ["tone", false],
            ["icons", false],
        ]);
        // a decision the agent rewrote is new too
        const reworded = review({ parts: [SCOPE, { ...MOTION, gist: "Slide up" }, TONE, ICONS] });
        expect(isNew(brainstormCard(inp({ file: reworded, seen: seenMark(now) })))[0]).toEqual(["motion", true]);
    });

    it("stays in place, working, while the agent writes up a click: its line, not a vanished card", () => {
        const f = shownFile(review(), { at: 1, modifiedMs: null, kind: "line" });
        expect(f.working).toBe("Taking in your change.");
        const c = pick(brainstormCard(inp({ file: f, sent: "line" })), "confirm");
        expect(c).toMatchObject({ state: "working", line: "Taking in your change.", action: "confirm-all" });
        expect(c.rows).toHaveLength(3);
        // so does a write the file itself says is under way
        const writing = review({ working: "Rewriting the motion part." });
        expect(pick(brainstormCard(inp({ file: writing })), "confirm")).toMatchObject({
            state: "working",
            line: "Rewriting the motion part.",
        });
    });

    it("keeps the card while a check is not what is pending, and is the card for a settled design with no check yet", () => {
        expect(pick(brainstormCard(inp({ file: settled(), check: NO_CHECK })), "confirm").action).toBe("check");
    });

    it("gives way to the check the moment `check` is sent", () => {
        const f = shownFile(settled(), { at: 1, modifiedMs: null, kind: "check" });
        expect(brainstormCard(inp({ file: f, sent: "check" }))?.kind).toBe("check");
    });
});

describe("brainstormCard: the builder check", () => {
    it("is reading, with the pending-check line, when only the `check` line has been sent", () => {
        const f = shownFile(settled(), { at: 1, modifiedMs: null, kind: "check" });
        const c = pick(brainstormCard(inp({ file: f, sent: "check", check: NO_CHECK })), "check");
        expect(c).toMatchObject({ state: "working", stage: "reading", reason: null, question: null, rows: [] });
        // the text the shown file writes for a pending check
        expect(c.pending).toEqual({ kind: "pending", stage: "reading", text: f.working });
        expect(c.pending?.text).toBe("A builder is reading the design.");
    });

    it("is reading while the builder reads, with the pending check as the view gave it", () => {
        const c = pick(brainstormCard(inp({ file: settled(), check: READING })), "check");
        expect(c).toMatchObject({ state: "working", stage: "reading", reason: null });
        expect(c.pending).toBe(READING);
    });

    it("is taking in while the agent sorts the builder's questions", () => {
        const c = pick(brainstormCard(inp({ file: settled(), check: TAKING_IN })), "check");
        expect(c).toMatchObject({ state: "working", stage: "taking-in", reason: null });
        expect(c.pending).toBe(TAKING_IN);
    });

    it("is failed with its reason, waiting on Try again, when the check did not start", () => {
        const c = pick(brainstormCard(inp({ file: settled(), check: FAILED })), "check");
        expect(c).toMatchObject({ state: "waiting", stage: "failed", reason: FAILED.reason, pending: null });
    });

    it("shows a failure only while the file has no check", () => {
        const c = pick(brainstormCard(inp({ file: settled({ check: BUILDER_DONE }), check: FAILED })), "check");
        expect(c.stage).toBe("review");
    });

    it("asks the first builder question left unanswered, with its options and the pick", () => {
        const c = pick(brainstormCard(inp({ file: settled({ check: BUILDER_CHECK }) })), "check");
        expect(c).toMatchObject({ state: "waiting", stage: "asking", pending: null, reason: null });
        expect(c.question).toEqual({
            n: 2,
            total: 2,
            part: "Motion",
            question: "Which queue?",
            why: "Both are in the stack.",
            options: BUILDER_CHECK.yours[1].options,
            pick: 0,
        });
    });

    it("asks a builder question that names no part, and has no pick or reason when it gives none", () => {
        const check: BuilderCheck = { yours: [{ q: "Who pages?" }], calls: [], answered: [] };
        const q = pick(brainstormCard(inp({ file: settled({ check }) })), "check").question;
        expect(q).toEqual({ n: 1, total: 1, part: "", question: "Who pages?", why: null, options: [], pick: null });
    });

    it("lists the agent's calls and what the spec already answered", () => {
        const c = pick(brainstormCard(inp({ file: settled({ check: BUILDER_CHECK }) })), "check");
        expect(c.calls).toEqual(["Retries: 3, backed off"]);
        expect(c.spec).toEqual(["The region is eu-west-1"]);
    });

    it("is working while the agent writes up a builder answer", () => {
        const f = shownFile(settled({ check: BUILDER_CHECK }), { at: 1, modifiedMs: null, kind: "line" });
        const c = pick(brainstormCard(inp({ file: f, sent: "line" })), "check");
        expect(c).toMatchObject({ state: "working", stage: "asking" });
    });

    it("is the review once no builder question is open, listing the decisions still waiting on you", () => {
        const f = settled({ check: BUILDER_DONE, parts: [SCOPE, { ...MOTION }, { ...TONE, state: "yours" }, ICONS] });
        const c = pick(brainstormCard(inp({ file: f })), "check");
        expect(c).toMatchObject({ state: "waiting", stage: "review", question: null });
        // a changed decision first, then a new guess, as the review draws them
        expect(c.rows.map((r) => [r.id, r.view])).toEqual([
            ["icons", "changed"],
            ["motion", "guess"],
        ]);
        expect(c.rows[0]).toMatchObject({ was: "Lucide", why: "You asked for outlines", isNew: false });
        expect(c.approveBlocker).toBe(approveBlocker(f, null));
        expect(c.approveBlocker).toBe("Review 1 change, confirm 1 guess");
    });

    it("is the review with no rows and Approve open once nothing is left", () => {
        const f = settled({ check: BUILDER_DONE });
        const c = pick(brainstormCard(inp({ file: f })), "check");
        expect(c).toMatchObject({ stage: "review", rows: [], approveBlocker: null, state: "waiting" });
        expect(c.calls).toEqual(["Retries: 3, backed off"]);
    });

    it("leaves out of the rows a decision the check only touched, which stays yours", () => {
        const f = settled({ check: { ...BUILDER_DONE, touched: ["scope"] } });
        expect(pick(brainstormCard(inp({ file: f })), "check").rows).toEqual([]);
    });

    it("marks a row new against the seen mark", () => {
        const f = settled({ check: BUILDER_DONE, parts: [SCOPE, MOTION, { ...TONE, state: "yours" }] });
        const seen = seenMark(settled());
        const row = pick(brainstormCard(inp({ file: f, seen })), "check").rows[0];
        expect(row).toMatchObject({ id: "motion", isNew: false });
        const added = pick(
            brainstormCard(inp({ file: { ...f, parts: [...f.parts, { ...ICONS, id: "late" }] }, seen })),
            "check"
        );
        expect(added.rows.find((r) => r.id === "late")?.isNew).toBe(true);
    });

    it("names the run Arc is starting as Approve's reason", () => {
        const f = settled({ check: BUILDER_DONE });
        const c = pick(brainstormCard(inp({ file: f, starting: { runId: null } })), "check");
        expect(c.approveBlocker).toBe("The run is starting");
    });

    it("is static for an agent that exited, in every stage", () => {
        for (const [f, check] of [
            [settled(), READING],
            [settled(), FAILED],
            [settled({ check: BUILDER_CHECK }), NO_CHECK],
            [settled({ check: BUILDER_DONE }), NO_CHECK],
        ] as [BrainstormFile, BuilderCheckView][]) {
            expect(pick(brainstormCard(inp({ file: f, check, exited: true })), "check").state).toBe("static");
        }
    });
});

describe("brainstormCard: the run", () => {
    it("is the run card once the file records a run", () => {
        const f = settled({ check: BUILDER_DONE, run: "run-1" });
        expect(brainstormCard(inp({ file: f }))).toEqual({ kind: "run", state: "waiting", runId: "run-1" });
    });

    it("wins over every other card", () => {
        const c = brainstormCard(
            inp({ file: file({ done: true, check: BUILDER_CHECK, run: "run-1" }), check: READING })
        );
        expect(c).toEqual({ kind: "run", state: "waiting", runId: "run-1" });
        expect(brainstormCard(inp({ file: review({ run: "run-1" }) }))?.kind).toBe("run");
    });

    it("is the run card from a starting mark that has its run's id, before the file records it", () => {
        const f = settled({ check: BUILDER_DONE });
        expect(brainstormCard(inp({ file: f, starting: { runId: "run-9" } }))).toEqual({
            kind: "run",
            state: "waiting",
            runId: "run-9",
        });
        // the file's own run wins once the agent has written it
        expect(brainstormCard(inp({ file: { ...f, run: "run-1" }, starting: { runId: "run-9" } }))).toMatchObject({
            runId: "run-1",
        });
        // a launcher handed off but no run created yet: still the review
        expect(brainstormCard(inp({ file: f, starting: { runId: null } }))?.kind).toBe("check");
    });

    it("takes a shown file that already carries the starting run", () => {
        const f = settled({ check: BUILDER_DONE, run: "run-9" });
        expect(brainstormCard(inp({ file: f, starting: { runId: "run-9" } }))).toMatchObject({ runId: "run-9" });
    });
});

describe("brainstormCard: an agent that exited", () => {
    it.each([
        ["question", inp()],
        ["confirm", inp({ file: review() })],
        ["check", inp({ file: settled({ check: BUILDER_CHECK }) })],
        ["run", inp({ file: settled({ run: "run-1" }) })],
    ] as [ChatCard["kind"], CardInput][])("turns the %s card static", (kind, input) => {
        expect(brainstormCard({ ...input, exited: false })?.kind).toBe(kind);
        expect(brainstormCard({ ...input, exited: true })).toMatchObject({ kind, state: "static" });
    });
});

// ---- sendRecord: what each line Arc sends leaves in the record ----

describe("sendRecord", () => {
    const send = (action: BrainstormAction, f: BrainstormFile | null, records: readonly SentAnswer[] = [], seen = 0) =>
        sendRecord(action, f, records, TOPIC, brainstormLine(action) ?? "", seen, 1000);

    const asking = () => file();

    it("keeps an answer to the question the file asks, as the answer record has always been", () => {
        expect(send({ kind: "answer", text: "Fade + scale" }, asking(), [], 2)).toEqual({
            topic: TOPIC,
            n: 2,
            part: "Motion",
            text: "Fade + scale",
            sentAt: 1000,
            seen: 2,
        });
    });

    it("keeps nothing for an answer typed with no question open, which stays a bubble", () => {
        expect(send({ kind: "answer", text: "why not a fade?" }, review())).toBeNull();
        expect(send({ kind: "answer", text: "why not a fade?" }, null)).toBeNull();
    });

    it("keeps a builder answer with the open builder question's number and part", () => {
        const f = settled({ check: BUILDER_CHECK });
        expect(send({ kind: "builder-answer", text: "SQS" }, f, [], 1)).toEqual({
            topic: TOPIC,
            n: 2,
            part: "Motion",
            text: "brainstorm: builder answer: SQS",
            sentAt: 1000,
            seen: 1,
            kind: "builder-answer",
        });
    });

    it("keeps a builder answer to a question that names no part with an empty part", () => {
        const check: BuilderCheck = { yours: [{ q: "Who pages?" }], calls: [], answered: [] };
        expect(send({ kind: "builder-answer", text: "On-call" }, settled({ check }))).toMatchObject({
            n: 1,
            part: "",
            kind: "builder-answer",
        });
    });

    it("keeps nothing for a builder answer when no builder question is open", () => {
        expect(send({ kind: "builder-answer", text: "SQS" }, settled({ check: BUILDER_DONE }))).toBeNull();
        expect(send({ kind: "builder-answer", text: "SQS" }, settled())).toBeNull();
        expect(send({ kind: "builder-answer", text: "SQS" }, null)).toBeNull();
    });

    it("keeps a check as the design step, with the decisions it held", () => {
        expect(send({ kind: "check" }, settled(), [], 3)).toEqual({
            topic: TOPIC,
            n: 0,
            part: "",
            text: "brainstorm: check",
            sentAt: 1000,
            seen: 3,
            kind: "design",
            decisions: 3,
        });
        expect(send({ kind: "check" }, null)).toMatchObject({ kind: "design", decisions: 0 });
    });

    it("keeps a check sent again after a failed one as an action, so a retry draws no second row", () => {
        const first = send({ kind: "check" }, settled())!;
        expect(first.kind).toBe("design");
        expect(send({ kind: "check" }, settled(), [first])).toMatchObject({ kind: "action", n: 0, part: "" });
        // an action record carries no counts
        expect(send({ kind: "check" }, settled(), [first])).not.toHaveProperty("decisions");
    });

    it("keeps a check as the design step again after the builder step, a second talk, confirm and check cycle", () => {
        const design = send({ kind: "check" }, settled())!;
        const builder = send({ kind: "keep-talking" }, settled({ check: BUILDER_DONE }), [design])!;
        expect(builder.kind).toBe("builder");
        expect(send({ kind: "check" }, settled(), [design, builder])).toMatchObject({ kind: "design" });
    });

    it("reads the newest design or builder record of this topic only, and in order", () => {
        const design = rec({ n: 0, part: "", kind: "design", text: "brainstorm: check", sentAt: 1 });
        const otherTopic = rec({
            topic: "other",
            n: 0,
            part: "",
            kind: "design",
            text: "brainstorm: check",
            sentAt: 9,
        });
        const builder = rec({ n: 0, part: "", kind: "builder", text: "brainstorm: approved", sentAt: 5 });
        const guess = rec({ n: 0, part: "", kind: "action", text: "brainstorm: guess", sentAt: 6 });
        // another topic's design does not make this topic's check a retry
        expect(send({ kind: "check" }, settled(), [otherTopic])?.kind).toBe("design");
        // actions and answers between do not matter: the newest step record decides
        expect(send({ kind: "check" }, settled(), [design, guess, rec({ sentAt: 7 })])?.kind).toBe("action");
        expect(send({ kind: "check" }, settled(), [design, builder, guess])?.kind).toBe("design");
    });

    it("keeps approved and keep talking as the builder step with the counts it held and what the person did", () => {
        const f = settled({
            check: {
                ...BUILDER_DONE,
                answered: ["a", "b", "c", "d"],
                calls: [{ text: "x" }, { text: "y" }, { text: "z" }],
            },
        });
        // questions are the builder's questions for the user, calls the agent's own; what the spec answered is neither
        expect(send({ kind: "approved" }, f)).toEqual({
            topic: TOPIC,
            n: 0,
            part: "",
            text: "brainstorm: approved",
            sentAt: 1000,
            seen: 0,
            kind: "builder",
            questions: 2,
            calls: 3,
            outcome: "approved",
        });
        expect(send({ kind: "keep-talking" }, f)).toMatchObject({
            text: "brainstorm: keep talking",
            kind: "builder",
            questions: 2,
            calls: 3,
            outcome: "keep-talking",
        });
    });

    it("counts none for a builder step whose file holds no check", () => {
        expect(send({ kind: "approved" }, settled())).toMatchObject({ kind: "builder", questions: 0, calls: 0 });
        expect(send({ kind: "keep-talking" }, null)).toMatchObject({ kind: "builder", questions: 0, calls: 0 });
    });

    it("keeps the run Arc told the agent about", () => {
        expect(send({ kind: "run", runId: "run-42" }, settled({ check: BUILDER_DONE }), [], 1)).toEqual({
            topic: TOPIC,
            n: 0,
            part: "",
            text: "brainstorm: run run-42",
            sentAt: 1000,
            seen: 1,
            kind: "run",
            runId: "run-42",
        });
    });

    it.each([
        { kind: "guess" },
        { kind: "skip" },
        { kind: "confirm", part: "motion" },
        { kind: "confirm-all" },
        { kind: "edit", part: "motion", text: "Slide up" },
        { kind: "keep", part: "icons" },
        { kind: "restore", part: "icons" },
        { kind: "keep-all" },
        { kind: "builder-decide" },
    ] as BrainstormAction[])("keeps a $kind line as an action, to be hidden", (action) => {
        const line = brainstormLine(action)!;
        expect(send(action, review(), [], 4)).toEqual({
            topic: TOPIC,
            n: 0,
            part: "",
            text: line,
            sentAt: 1000,
            seen: 4,
            kind: "action",
        });
        // whatever the file holds, even none
        expect(send(action, null)).toMatchObject({ kind: "action" });
    });
});
