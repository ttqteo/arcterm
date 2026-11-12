// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import type { BrainstormFile, BrainstormQuestion } from "./brainstormmodel";
import {
    addAnswer,
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
    weighingLine,
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
