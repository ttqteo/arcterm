// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import type { AgentVM } from "./agentsviewmodel";
import {
    BUILDER_PART,
    answerLine,
    answeredQuestions,
    approveBlocker,
    asksUser,
    boardBackLabel,
    brainstormAttention,
    brainstormCounts,
    brainstormFilePath,
    brainstormLine,
    brainstormPhase,
    builderCheckView,
    canCheck,
    checkAsk,
    checkClock,
    checkMain,
    checkReview,
    checkSpan,
    checkUnder,
    clockText,
    compactedSummary,
    confirmableGuesses,
    designLabel,
    designUnder,
    droppedQuestion,
    editLock,
    exitedSummary,
    handoffView,
    hasMockups,
    hasProsCons,
    historyRows,
    isAsking,
    judgeWait,
    judgeWork,
    leftPanel,
    lineBox,
    mainView,
    nextSentCheckAt,
    noteParts,
    optionLetter,
    orderedParts,
    paneBack,
    paneView,
    parseBrainstorm,
    parseBrainstormPath,
    partAnswer,
    partBoards,
    partGist,
    partSpikes,
    partTitle,
    partView,
    phaseSteps,
    pickableOptions,
    progressView,
    questionBoards,
    questionTrack,
    resumePrompt,
    reviewHead,
    runLine,
    runPrefill,
    seenMark,
    sendBlocker,
    sentKind,
    sentenceDiff,
    settleSent,
    shownFile,
    spikeUrl,
    stopsJudge,
    terminalAnswer,
    treeLine,
    unseenSince,
    withBrainstorm,
    type BrainstormFile,
    type BrainstormPart,
    type BrainstormQuestion,
    type BuilderCheckRecord,
    type HistoryEntry,
    type ParseResult,
    type PartState,
    type SentLine,
} from "./brainstormmodel";

const part = (id: string, state: PartState, over: Partial<BrainstormPart> = {}): BrainstormPart => ({
    id,
    title: `Title ${id}`,
    state,
    body: "",
    ...over,
});

const file = (over: Partial<BrainstormFile> = {}): BrainstormFile => ({
    v: 1,
    title: "Lag alerts",
    spec: "",
    question: null,
    working: null,
    parts: [],
    history: [],
    done: false,
    check: null,
    run: null,
    ...over,
});

const raw = (over: Record<string, unknown> = {}) =>
    JSON.stringify({ v: 1, title: "T", parts: [{ id: "a", title: "A", state: "yours", body: "x" }], ...over });

const errorOf = (r: ParseResult): string | undefined => (r as { error?: string }).error;

const agent = (over: Partial<AgentVM> = {}): AgentVM => ({ id: "t1", name: "loom", task: "x", state: "idle", ...over });

// the file while the judge weighs an approach question: `working` set over a question that lists its approaches
const approachList = (n: number) =>
    Array.from({ length: n }, (_, i) => ({ name: `Approach ${i}`, description: "", facts: [] }));
const waitQuestion = (n = 7): BrainstormQuestion => ({
    n: 4,
    text: "Which way?",
    part: "a",
    approaches: approachList(n),
});
const waitFile = (over: Partial<BrainstormFile> = {}): BrainstormFile =>
    file({ question: waitQuestion(), working: "Weighing the approaches.", ...over });

describe("parseBrainstorm", () => {
    it("rejects invalid json", () => {
        const r = parseBrainstorm("{nope");
        expect(r.ok).toBe(false);
        expect(errorOf(r).startsWith("brainstorm.json is not valid JSON:")).toBe(true);
    });

    it("rejects a version other than 1, naming it", () => {
        const r = parseBrainstorm(raw({ v: 2 }));
        expect(errorOf(r)).toContain("2");
        expect(errorOf(r)).toContain("version");
    });

    it("rejects a missing or non-string title", () => {
        for (const title of [undefined, 5]) {
            const r = parseBrainstorm(raw({ title }));
            expect(errorOf(r)).toContain("title");
        }
    });

    it("rejects a missing parts array", () => {
        const r = parseBrainstorm(raw({ parts: undefined }));
        expect(errorOf(r)).toContain("parts");
    });

    it("rejects a part with an unknown state, naming the part and the state", () => {
        const r = parseBrainstorm(raw({ parts: [{ id: "p1", title: "P", state: "maybe", body: "" }] }));
        expect(errorOf(r)).toContain("p1");
        expect(errorOf(r)).toContain("maybe");
    });

    it("rejects duplicate part ids, naming the id", () => {
        const p = { id: "dup", title: "P", state: "yours", body: "" };
        const r = parseBrainstorm(raw({ parts: [p, p] }));
        expect(errorOf(r)).toContain("dup");
    });

    it("defaults the optional fields", () => {
        const r = parseBrainstorm(raw());
        expect(r.ok).toBe(true);
        if (!r.ok) {
            return;
        }
        expect(r.file).toMatchObject({
            v: 1,
            title: "T",
            spec: "",
            question: null,
            working: null,
            history: [],
            done: false,
            check: null,
            run: null,
        });
        expect(r.file.parts[0]).toMatchObject({ id: "a", state: "yours", body: "x" });
    });

    it("turns a bare-string call into {text} and keeps the P4 additions", () => {
        const r = parseBrainstorm(
            raw({
                compacted: 1234,
                check: {
                    yours: [{ q: "Q?", why: "w", a: "ans", into: "a" }],
                    calls: ["bare", { text: "with part", part: "a" }],
                    answered: ["done one"],
                    touched: ["a"],
                },
            })
        );
        expect(r.ok).toBe(true);
        if (!r.ok) {
            return;
        }
        expect(r.file.compacted).toBe(1234);
        expect(r.file.check?.calls).toEqual([{ text: "bare" }, { text: "with part", part: "a" }]);
        expect(r.file.check?.yours[0]).toEqual({ q: "Q?", why: "w", a: "ans", into: ["a"] });
        expect(r.file.check?.touched).toEqual(["a"]);
        expect(r.file.check?.answered).toEqual(["done one"]);
    });

    it("reads a builder question's into as a string or a list, and its label, part and options", () => {
        const options = [
            { label: "Resolve itself", detail: "once caught up", pick: true, pros: ["no rota"], cons: ["flaps"] },
            { label: "Someone closes it", cons: ["toil"] },
            { detail: "no label, dropped" },
        ];
        const r = parseBrainstorm(
            raw({
                check: {
                    yours: [
                        { q: "Old?", into: "anti" },
                        { q: "New?", label: "Short", part: "a", into: ["a", "", "b"], options },
                        { q: "None?", into: "" },
                    ],
                    calls: [],
                    answered: [],
                },
            })
        );
        expect(r.ok).toBe(true);
        if (!r.ok) {
            return;
        }
        expect(r.file.check?.yours).toEqual([
            { q: "Old?", into: ["anti"] },
            {
                q: "New?",
                label: "Short",
                part: "a",
                into: ["a", "b"],
                options: [
                    {
                        label: "Resolve itself",
                        detail: "once caught up",
                        pick: true,
                        pros: ["no rota"],
                        cons: ["flaps"],
                    },
                    { label: "Someone closes it", detail: "", cons: ["toil"] },
                ],
            },
            { q: "None?" },
        ]);
    });

    it("accepts a question.part that names no part", () => {
        const r = parseBrainstorm(raw({ question: { n: 3, text: "Why?", part: "ghost" } }));
        expect(r.ok && r.file.question).toEqual({ n: 3, text: "Why?", part: "ghost" });
    });

    it("reads history entries", () => {
        const r = parseBrainstorm(
            raw({
                history: [
                    { kind: "question", n: 1, q: "q1", a: "a1", into: ["a"] },
                    { kind: "recon", q: "rq", a: "ra", into: ["b"] },
                ],
            })
        );
        expect(r.ok && r.file.history).toEqual([
            { kind: "question", n: 1, q: "q1", a: "a1", into: ["a"] },
            { kind: "recon", q: "rq", a: "ra", into: ["b"] },
        ]);
    });
});

describe("brainstorm paths", () => {
    it("builds the file path with the separator of the cwd", () => {
        expect(brainstormFilePath("C:\\proj", "lag")).toBe("C:\\proj\\.superpowers\\brainstorm\\lag\\brainstorm.json");
        expect(brainstormFilePath("/home/p/", "lag")).toBe("/home/p/.superpowers/brainstorm/lag/brainstorm.json");
    });

    it("parses a path back, with either separator", () => {
        expect(parseBrainstormPath("C:\\proj\\.superpowers\\brainstorm\\lag\\brainstorm.json")).toEqual({
            cwd: "C:\\proj",
            topic: "lag",
        });
        expect(parseBrainstormPath("/home/p/.superpowers/brainstorm/lag/brainstorm.json")).toEqual({
            cwd: "/home/p",
            topic: "lag",
        });
        expect(parseBrainstormPath("/home/p/.superpowers/design/lag/canvas.json")).toBeNull();
    });
});

describe("counts and gates", () => {
    const f = file({
        parts: [part("a", "yours"), part("b", "guess"), part("c", "guess"), part("d", "asked"), part("e", "open")],
    });

    it("counts yours, guesses, and asked plus open", () => {
        expect(brainstormCounts(f)).toEqual({ yours: 1, guesses: 2, open: 2 });
    });

    it("canCheck needs done, at least one part and every part yours", () => {
        expect(canCheck(file({ done: true, parts: [part("a", "yours")] }))).toBe(true);
        expect(canCheck(file({ done: false, parts: [part("a", "yours")] }))).toBe(false);
        expect(canCheck(file({ done: true, parts: [] }))).toBe(false);
        expect(canCheck(file({ done: true, parts: [part("a", "yours"), part("b", "guess")] }))).toBe(false);
    });

    it("canCheck waits for a question still open, one about no part included", () => {
        const q = { n: 6, text: "Run the reviewer?", part: "" };
        expect(canCheck(file({ done: true, question: q, parts: [part("a", "yours")] }))).toBe(false);
    });

    it("confirmableGuesses counts plain guesses, not changed parts", () => {
        const g = file({
            parts: [part("a", "guess"), part("b", "guess", { was: "old" }), part("c", "guess"), part("d", "yours")],
        });
        expect(confirmableGuesses(g)).toBe(2);
    });

    it("isAsking is a question with no working line", () => {
        const q = { n: 1, text: "?", part: "a" };
        expect(isAsking(file({ question: q }))).toBe(true);
        expect(isAsking(file({ question: q, working: "Writing" }))).toBe(false);
        expect(isAsking(file())).toBe(false);
    });

    it("asksUser needs the agent at its prompt", () => {
        const f2 = file({ question: { n: 1, text: "?", part: "a" } });
        expect(asksUser(f2, { state: "idle" })).toBe(true);
        expect(asksUser(f2, { state: "working", atPrompt: true })).toBe(true);
        expect(asksUser(f2, { state: "working" })).toBe(false);
        expect(asksUser(null, { state: "idle" })).toBe(false);
        expect(asksUser(file(), { state: "idle" })).toBe(false);
    });
});

describe("withBrainstorm", () => {
    const f = file({ question: { n: 2, text: "?", part: "a" } });

    it("overlays asking with the time since it went idle", () => {
        const a = withBrainstorm(agent({ idleSince: 1000 }), f, 6000);
        expect(a.state).toBe("asking");
        expect(a.blockedMs).toBe(5000);
    });

    it("returns the same object when it is not asking", () => {
        const a = agent({ idleSince: 1000 });
        expect(withBrainstorm(a, null, 6000)).toBe(a);
        expect(withBrainstorm(a, file(), 6000)).toBe(a);
        const busy = agent({ state: "working" });
        expect(withBrainstorm(busy, f, 6000)).toBe(busy);
    });
});

describe("settleSent", () => {
    const sent: SentLine = { at: 1000, modifiedMs: 500, kind: "answer" };

    it("holds while the file is unchanged and the agent has not ended a turn since", () => {
        expect(settleSent(sent, 500, { state: "working" })).toBe(sent);
        expect(settleSent(sent, 500, { state: "idle", idleSince: 900 })).toBe(sent);
        expect(settleSent(sent, 500, undefined)).toBe(sent);
    });

    it("settles once the file changes and the agent is not at work", () => {
        expect(settleSent(sent, 600, { state: "idle", idleSince: 900 })).toBeNull();
        expect(settleSent(sent, 600, undefined)).toBeNull();
        expect(settleSent({ ...sent, modifiedMs: null }, 600, { state: "asking" })).toBeNull();
    });

    it("holds through a write mid-turn, until that turn ends", () => {
        expect(settleSent(sent, 600, { state: "working" })).toBe(sent);
        expect(settleSent(sent, 600, { state: "idle", idleSince: 1500 })).toBeNull();
    });

    it("settles once the agent's turn ends after the send without a write", () => {
        expect(settleSent(sent, 500, { state: "idle", idleSince: 1500 })).toBeNull();
    });

    it("nothing sent stays nothing", () => {
        expect(settleSent(null, 500, { state: "idle", idleSince: 1500 })).toBeNull();
    });
});

describe("a sent check", () => {
    const ready = file({ done: true, parts: [part("a", "yours")] });
    const check: SentLine = { at: 1000, modifiedMs: 500, kind: "check" };
    const ended = { state: "idle" as const, idleSince: 1500 };

    it("is what the check action sends; an answer is an answer and anything else a line", () => {
        expect(sentKind({ kind: "check" })).toBe("check");
        expect(sentKind({ kind: "answer", text: "x" })).toBe("answer");
        expect(sentKind({ kind: "builder-answer", text: "x" })).toBe("line");
        expect(sentKind({ kind: "confirm-all" })).toBe("line");
    });

    // Arc's record, not the file, says whether the builder is reading (builderCheckView), so a check settles like any
    // line and leaves its send time behind (nextSentCheckAt)
    it("settles like any line once the turn that took it ends", () => {
        expect(settleSent(check, 500, ended)).toBeNull();
        expect(settleSent(check, 500, { state: "working" })).toBe(check);
    });

    it("shows the builder reading, with no review head and no second check to press", () => {
        const s = shownFile(ready, check);
        expect(s.working).toBe("A builder is reading the design.");
        expect(mainView(s, false)).toBe("working");
        expect(leftPanel(s)).toBe("none");
        expect(sendBlocker({ kind: "check" }, s)).toBe(
            "The agent is still working; check with a builder once it is done"
        );
    });

    it("is sendable only while the agent is not working", () => {
        expect(reviewHead(ready).action).toBe("check");
        expect(sendBlocker({ kind: "check" }, ready)).toBeNull();
        expect(sendBlocker({ kind: "check" }, null)).toBeNull();
        expect(sendBlocker({ kind: "check" }, { ...ready, working: "Writing it" })).not.toBeNull();
        expect(sendBlocker({ kind: "confirm-all" }, { ...ready, working: "Writing it" })).toBeNull();
    });
});

describe("terminalAnswer", () => {
    const asking = file({ question: { n: 2, text: "?", part: "a" }, parts: [part("a", "asked")] });
    const working = { state: "working" as const };

    it("reads a turn started after the file asked as an answer typed in the terminal", () => {
        const sent = terminalAnswer(asking, 500, working, 1000);
        expect(sent).toEqual({ at: 1000, modifiedMs: 500, kind: "answer" });
        expect(shownFile(asking, sent).question).toBeNull();
    });

    it("settles like a sent answer once that turn ends", () => {
        const sent = terminalAnswer(asking, 500, working, 1000);
        expect(settleSent(sent, 500, { state: "idle", idleSince: 1500 })).toBeNull();
    });

    it("leaves a question the agent wrote during its current turn showing", () => {
        expect(terminalAnswer(asking, 1200, working, 1000)).toBeNull();
    });

    it("needs an open question, a working agent and both stamps", () => {
        expect(terminalAnswer(file(), 500, working, 1000)).toBeNull();
        expect(terminalAnswer(asking, 500, { state: "idle" }, 1000)).toBeNull();
        expect(terminalAnswer(asking, 500, undefined, 1000)).toBeNull();
        expect(terminalAnswer(asking, 500, working, undefined)).toBeNull();
        expect(terminalAnswer(asking, null, working, 1000)).toBeNull();
    });
});

describe("builderCheckView", () => {
    const ready = file({ done: true, parts: [part("a", "yours")] });
    const checked = file({ ...ready, check: { yours: [], calls: [], answered: [] } });
    const rec = (state: BuilderCheckRecord["state"], over: Partial<BuilderCheckRecord> = {}): BuilderCheckRecord => ({
        state,
        ts: 1000,
        ...over,
    });
    const idleBefore = { state: "idle" as const, idleSince: 900 };
    const working = { state: "working" as const };
    const TAKING_IN = { kind: "pending", stage: "taking-in", text: "Taking in the builder's questions." };
    const NOT_STARTED = { kind: "failed", reason: "The agent ended its turn without starting the builder check." };

    it("is none with no record and no check sent", () => {
        expect(builderCheckView(undefined, null, ready, 500, idleBefore)).toEqual({ kind: "none" });
    });

    it("is pending while a builder reads, whatever the agent or the file does", () => {
        const reading = { kind: "pending", stage: "reading", text: "A builder is reading the design." };
        expect(builderCheckView(rec("reading"), null, ready, 500, idleBefore)).toEqual(reading);
        expect(builderCheckView(rec("reading"), null, ready, 2000, { state: "idle", idleSince: 1500 })).toEqual(
            reading
        );
    });

    it("answered is pending until the agent's turn ends after the delivery", () => {
        expect(builderCheckView(rec("answered"), null, ready, 500, idleBefore)).toEqual(TAKING_IN);
        expect(builderCheckView(rec("answered"), null, ready, 500, working)).toEqual(TAKING_IN);
        expect(builderCheckView(rec("answered"), null, ready, 500, { state: "idle", idleSince: 1500 })).toEqual({
            kind: "none",
        });
    });

    it("answered is pending until the file is written after the delivery while the agent is not working", () => {
        expect(builderCheckView(rec("answered"), null, ready, 1200, working)).toEqual(TAKING_IN);
        expect(builderCheckView(rec("answered"), null, ready, 1000, idleBefore)).toEqual(TAKING_IN);
        expect(builderCheckView(rec("answered"), null, checked, 1200, idleBefore)).toEqual({ kind: "none" });
    });

    it("failed shows its reason while the file has no check, and hides once it has one", () => {
        const failed = rec("failed", { reason: "The builder ended without its questions." });
        expect(builderCheckView(failed, null, ready, 500, idleBefore)).toEqual({
            kind: "failed",
            reason: "The builder ended without its questions.",
        });
        expect(builderCheckView(failed, null, checked, 500, idleBefore)).toEqual({ kind: "none" });
    });

    it("fails when the agent ended its turn with no record newer than the check it was sent", () => {
        expect(builderCheckView(undefined, 2000, ready, 500, idleBefore)).toEqual(NOT_STARTED);
        expect(builderCheckView(rec("answered"), 2000, ready, 500, idleBefore)).toEqual(NOT_STARTED);
        expect(builderCheckView(rec("failed", { reason: "old" }), 2000, ready, 500, idleBefore)).toEqual(NOT_STARTED);
        expect(builderCheckView(rec("reading", { ts: 2500 }), 2000, ready, 500, idleBefore).kind).toBe("pending");
    });
});

describe("nextSentCheckAt", () => {
    const check: SentLine = { at: 1000, modifiedMs: 500, kind: "check" };

    it("keeps a check's send time once the agent has taken it", () => {
        expect(nextSentCheckAt(null, check, check, undefined)).toBeNull();
        expect(nextSentCheckAt(null, check, null, undefined)).toBe(1000);
        expect(nextSentCheckAt(null, { ...check, kind: "line" as const }, null, undefined)).toBeNull();
        expect(nextSentCheckAt(1000, null, null, undefined)).toBe(1000);
    });

    it("clears it once a record newer than it appears, and keeps it past an older one", () => {
        expect(nextSentCheckAt(1000, null, null, { state: "reading", ts: 1200 })).toBeNull();
        expect(nextSentCheckAt(null, check, null, { state: "reading", ts: 1200 })).toBeNull();
        expect(nextSentCheckAt(1000, null, null, { state: "failed", ts: 800 })).toBe(1000);
    });
});

describe("shownFile", () => {
    const q = { n: 3, text: "?", part: "a" };
    const f = file({ question: q, parts: [part("a", "asked")] });

    it("is the file itself with nothing pending", () => {
        expect(shownFile(f, null)).toBe(f);
    });

    it("reads a pending answer as the agent writing it up, the question closed", () => {
        const s = shownFile(f, { at: 1, modifiedMs: 1, kind: "answer" });
        expect(s.working).toBe("Writing up your answer.");
        expect(s.question).toBeNull();
        expect(isAsking(s)).toBe(false);
        expect(partView(s, s.parts[0])).toBe("writing");
        expect(treeLine(s, false).text).toBe("writing up your answer");
    });

    it("reads another pending line as working, the question kept", () => {
        const s = shownFile(f, { at: 1, modifiedMs: 1, kind: "line" });
        expect(s.working).toBe("Taking in your change.");
        expect(s.question).toBe(q);
        expect(isAsking(s)).toBe(false);
        expect(approveBlocker(s)).toBe("The agent is writing; this opens when it is done");
    });

    it("leaves a working line the file sets itself alone", () => {
        const w = file({ working: "Writing it" });
        expect(shownFile(w, { at: 1, modifiedMs: 1, kind: "answer" })).toBe(w);
    });
});

describe("judgeWait", () => {
    it("is the file's working over a question that lists approaches, while no line is pending", () => {
        expect(judgeWait(waitFile(), false)).toBe(true);
        expect(judgeWait(waitFile(), true)).toBe(false);
    });

    it("is not any other wait: no approaches, no question, or no working", () => {
        expect(judgeWait(waitFile({ question: { ...waitQuestion(), approaches: [] } }), false)).toBe(false);
        expect(judgeWait(waitFile({ question: { ...waitQuestion(), approaches: undefined } }), false)).toBe(false);
        expect(judgeWait(waitFile({ question: null }), false)).toBe(false);
        expect(judgeWait(waitFile({ working: null }), false)).toBe(false);
    });
});

describe("shownFile during the judge's wait", () => {
    it("reads an answer sent in the wait as the agent writing it up, the question closed", () => {
        const f = waitFile();
        const s = shownFile(f, { at: 1, modifiedMs: 1, kind: "answer" });
        expect(s.working).toBe("Writing up your answer.");
        expect(s.question).toBeNull();
    });

    it("reads Skip sent in the wait as a change taken in, the question kept, so the wait is over", () => {
        const f = waitFile();
        const s = shownFile(f, { at: 1, modifiedMs: 1, kind: "line" });
        expect(s.working).toBe("Taking in your change.");
        expect(s.question).toBe(f.question);
        expect(mainView(s, false, true)).toBe("working");
        expect(checkMain({ ...s, check: { yours: [], calls: [], answered: [] } }, false, true)).toBe("working");
    });

    it("is the file itself with nothing sent", () => {
        const f = waitFile();
        expect(shownFile(f, null)).toBe(f);
    });

    it("leaves any other working file alone, a line sent or not", () => {
        const noApproaches = waitFile({ question: { ...waitQuestion(), approaches: [] } });
        const talkAnswer = file({ working: "Writing it", question: null });
        expect(shownFile(noApproaches, { at: 1, modifiedMs: 1, kind: "line" })).toBe(noApproaches);
        expect(shownFile(talkAnswer, { at: 1, modifiedMs: 1, kind: "answer" })).toBe(talkAnswer);
    });
});

describe("stopsJudge", () => {
    it("is an answer or Skip sent during the wait", () => {
        expect(stopsJudge({ kind: "answer", text: "x" }, waitFile(), false)).toBe(true);
        expect(stopsJudge({ kind: "skip" }, waitFile(), false)).toBe(true);
    });

    it("is not any other line", () => {
        expect(stopsJudge({ kind: "confirm", part: "a" }, waitFile(), false)).toBe(false);
        expect(stopsJudge({ kind: "edit", part: "a", text: "x" }, waitFile(), false)).toBe(false);
        expect(stopsJudge({ kind: "guess" }, waitFile(), false)).toBe(false);
    });

    it("is not an answer once a line is pending, or on a judged question with no working", () => {
        expect(stopsJudge({ kind: "answer", text: "x" }, waitFile(), true)).toBe(false);
        expect(stopsJudge({ kind: "answer", text: "x" }, waitFile({ working: null }), false)).toBe(false);
        expect(stopsJudge({ kind: "answer", text: "x" }, null, false)).toBe(false);
    });
});

describe("treeLine", () => {
    const f = file({ run: "abcdef0123456789" });

    it("names the run by its first 8 chars while Arc knows nothing of it", () => {
        expect(treeLine(f, false)).toEqual({ text: "run abcdef01", runId: "abcdef0123456789" });
    });

    it("says what Arc knows of the run, even while asking", () => {
        expect(treeLine(f, true, "merged · run abcdef01")).toEqual({
            text: "merged · run abcdef01",
            runId: "abcdef0123456789",
        });
    });

    it("names asking, the builder check, working and the default", () => {
        const q = { n: 4, text: "?", part: "a" };
        expect(treeLine(file({ question: q }), true)).toEqual({ text: "asking question 4" });
        expect(treeLine(file({ check: { yours: [], calls: [], answered: [] } }), false).text).toBe("builder check");
        expect(treeLine(file({ working: "Writing" }), false).text).toBe("writing up your answer");
        expect(treeLine(file(), false)).toEqual({ text: "in progress" });
    });
});

describe("brainstormLine", () => {
    it("types every action as its line", () => {
        expect(brainstormLine({ kind: "answer", text: "my answer" })).toBe("my answer");
        expect(brainstormLine({ kind: "guess" })).toBe("brainstorm: guess");
        expect(brainstormLine({ kind: "skip" })).toBe("brainstorm: skip questions");
        expect(brainstormLine({ kind: "confirm", part: "p" })).toBe("brainstorm: confirm p");
        expect(brainstormLine({ kind: "confirm-all" })).toBe("brainstorm: confirm every guess");
        expect(brainstormLine({ kind: "edit", part: "p", text: "new" })).toBe("brainstorm: edit p: new");
        expect(brainstormLine({ kind: "keep", part: "p" })).toBe("brainstorm: keep p");
        expect(brainstormLine({ kind: "restore", part: "p" })).toBe("brainstorm: restore p");
        expect(brainstormLine({ kind: "keep-all" })).toBe("brainstorm: keep every change");
        expect(brainstormLine({ kind: "check" })).toBe("brainstorm: check");
        expect(brainstormLine({ kind: "builder-answer", text: "x" })).toBe("brainstorm: builder answer: x");
        expect(brainstormLine({ kind: "builder-decide" })).toBe("brainstorm: builder decide");
        expect(brainstormLine({ kind: "approved" })).toBe("brainstorm: approved");
        expect(brainstormLine({ kind: "keep-talking" })).toBe("brainstorm: keep talking");
        expect(brainstormLine({ kind: "run", runId: "r-1" })).toBe("brainstorm: run r-1");
    });

    it("joins a multi-line, tab-filled text into one line", () => {
        expect(brainstormLine({ kind: "answer", text: "a\n\tb  c\r\n" })).toBe("a b c");
        expect(brainstormLine({ kind: "edit", part: "p", text: "x\ny" })).toBe("brainstorm: edit p: x y");
    });

    it("types nothing for a blank text", () => {
        expect(brainstormLine({ kind: "answer", text: "  \n " })).toBeNull();
        expect(brainstormLine({ kind: "edit", part: "p", text: "\t" })).toBeNull();
        expect(brainstormLine({ kind: "builder-answer", text: "" })).toBeNull();
    });
});

describe("unknown part ids render raw", () => {
    const f = file({
        parts: [part("a", "yours")],
        history: [{ kind: "question", n: 1, q: "q", a: "a", into: ["a", "ghost"] }],
        check: {
            yours: [],
            calls: [{ text: "c1", part: "ghost" }, { text: "c2", part: "a" }, { text: "c3" }],
            answered: [],
        },
    });

    it("partTitle falls back to the id", () => {
        expect(partTitle(f, "a")).toBe("Title a");
        expect(partTitle(f, "ghost")).toBe("ghost");
    });

    it("historyRows shows the raw id and does not throw", () => {
        expect(historyRows(f)[0].into).toEqual([
            { id: "a", title: "Title a" },
            { id: "ghost", title: "ghost" },
        ]);
    });

    it("callsByPart keys an unknown part by its raw id and leaves a partless call out", () => {
        expect(handoffView(f).callsByPart).toEqual({ ghost: ["c1"], a: ["c2"] });
    });
});

describe("historyRows", () => {
    const opts = [
        { label: "Owner first", detail: "d1", pick: true },
        { label: "Platform first", detail: "d2" },
        { label: "Both", detail: "d3" },
    ];

    it("is oldest first, labelled Q<n>, with recon at the top", () => {
        const f = file({
            history: [
                { kind: "question", n: 1, q: "q1", a: "a1", into: [] },
                { kind: "recon", q: "rq", a: "ra", into: [] },
                { kind: "question", n: 2, q: "q2", a: "a2", into: [] },
            ],
        });
        expect(historyRows(f).map((r) => r.label)).toEqual(["Recon", "Q1", "Q2"]);
    });

    it("lists every option offered, the picked one marked, and no separate answer", () => {
        const f = file({
            history: [{ kind: "question", n: 1, q: "q", a: "Platform first", into: [], options: opts, picked: 1 }],
        });
        const [r] = historyRows(f);
        expect(r.options).toEqual([
            { label: "Owner first", detail: "d1", picked: false, agentPick: true },
            { label: "Platform first", detail: "d2", picked: true, agentPick: false },
            { label: "Both", detail: "d3", picked: false, agentPick: false },
        ]);
        expect(r.answer).toBeNull();
        expect(r.ownWords).toBe(false);
    });

    it("keeps why it asked, and has reasons to show while an option not picked says what it is", () => {
        const entry = (over: Partial<HistoryEntry>): HistoryEntry => ({
            kind: "question",
            n: 1,
            q: "q",
            a: "Both",
            into: [],
            options: opts,
            picked: 2,
            ...over,
        });
        const [r] = historyRows(file({ history: [entry({ why: "w" })] }));
        expect([r.why, r.reasons]).toEqual(["w", true]);
        const bare = opts.map((o) => ({ ...o, detail: "" }));
        const [quiet] = historyRows(file({ history: [entry({ options: bare })] }));
        expect([quiet.why, quiet.reasons]).toEqual([null, false]);
        const onlyPicked = [
            { label: "A", detail: "" },
            { label: "Both", detail: "what it is" },
        ];
        const [p] = historyRows(file({ history: [entry({ options: onlyPicked, picked: 1 })] }));
        expect(p.reasons).toBe(false);
    });

    it("recon has no reasons toggle, why or not", () => {
        const [r] = historyRows(file({ history: [{ kind: "recon", q: "rq", why: "w", a: "ra", into: [] }] }));
        expect([r.why, r.reasons]).toEqual([null, false]);
    });

    it("an answer typed instead of an option is drawn after them, in your words", () => {
        const f = file({ history: [{ kind: "question", n: 1, q: "q", a: "Only at night.", into: [], options: opts }] });
        const [r] = historyRows(f);
        expect(r.options.every((o) => !o.picked)).toBe(true);
        expect(r.answer).toBe("Only at night.");
        expect(r.ownWords).toBe(true);
    });

    it("a question with no options shows its answer alone, not as your words", () => {
        const [r] = historyRows(file({ history: [{ kind: "question", n: 1, q: "q", a: "a1", into: [] }] }));
        expect(r.options).toEqual([]);
        expect(r.answer).toBe("a1");
        expect(r.ownWords).toBe(false);
    });

    it("recon shows what it found, falling back to what was asked", () => {
        const f = file({
            history: [
                { kind: "recon", q: "rq1", a: "found", into: [] },
                { kind: "recon", q: "rq2", a: "", into: [] },
            ],
        });
        expect(historyRows(f).map((r) => r.answer)).toEqual(["found", "rq2"]);
    });
});

describe("question options", () => {
    const opts = [
        { label: "Owner first", detail: "Pages the owner", pick: true },
        { label: "Platform first", detail: "One rota" },
    ];

    it("parse with why and options, the pick kept only when true", () => {
        const r = parseBrainstorm(
            raw({
                question: {
                    n: 4,
                    text: "Who?",
                    part: "a",
                    why: "Every group names a team.",
                    options: [
                        { label: "Owner first", detail: "Pages the owner", pick: true },
                        { label: "Platform first", detail: "One rota", pick: "yes" },
                    ],
                },
            })
        );
        expect(r.ok && r.file.question).toEqual({
            n: 4,
            text: "Who?",
            part: "a",
            why: "Every group names a team.",
            options: opts,
        });
    });

    it("parse pros, cons and the agent's read, dropping blank and non-string lines", () => {
        const r = parseBrainstorm(
            raw({
                question: {
                    n: 2,
                    text: "Which?",
                    read: "Graph adds the most.",
                    options: [
                        { label: "Graph", detail: "d", pros: ["new signal", "", 3], cons: ["pairs"] },
                        { label: "Forecast", detail: "e", pros: "cheap", cons: [] },
                    ],
                },
            })
        );
        const q = r.ok ? r.file.question : null;
        expect(q?.read).toBe("Graph adds the most.");
        expect(q?.options).toEqual([
            { label: "Graph", detail: "d", pros: ["new signal"], cons: ["pairs"] },
            { label: "Forecast", detail: "e" },
        ]);
        expect(q != null && hasProsCons(q)).toBe(true);
        expect(hasProsCons({ n: 1, text: "Q", part: "", options: [{ label: "A", detail: "" }] })).toBe(false);
        expect(hasProsCons({ n: 1, text: "Q", part: "" })).toBe(false);
    });

    it("keep a history entry's why", () => {
        const r = parseBrainstorm(raw({ history: [{ kind: "question", n: 1, q: "q", why: "w", a: "a", into: [] }] }));
        expect(r.ok && r.file.history[0].why).toBe("w");
    });

    it("a file without them reads as before", () => {
        const r = parseBrainstorm(
            raw({ question: { n: 1, text: "Q" }, history: [{ kind: "question", n: 1, q: "q", a: "a", into: [] }] })
        );
        expect(r.ok && r.file.question).toEqual({ n: 1, text: "Q", part: "" });
        expect(r.ok && r.file.history[0]).toEqual({ kind: "question", n: 1, q: "q", a: "a", into: [] });
    });

    it("drop an option with no label and a malformed options field, without failing the file", () => {
        const r = parseBrainstorm(
            raw({ question: { n: 1, text: "Q", options: [{ detail: "x" }, { label: " " }, "B", { label: "C" }] } })
        );
        expect(r.ok && r.file.question?.options).toEqual([{ label: "C", detail: "" }]);
        const bad = parseBrainstorm(raw({ question: { n: 1, text: "Q", options: "A or B" } }));
        expect(bad.ok && bad.file.question).toEqual({ n: 1, text: "Q", part: "" });
    });

    it("keep a history entry's picked index only when it names one of its options", () => {
        const entry = (picked: unknown) =>
            parseBrainstorm(
                raw({ history: [{ kind: "question", n: 1, q: "q", a: "a", into: [], options: opts, picked }] })
            );
        const picked = (r: ParseResult) => (r.ok ? r.file.history[0].picked : "error");
        expect(picked(entry(1))).toBe(1);
        expect(picked(entry(0))).toBe(0);
        expect(picked(entry(2))).toBeUndefined();
        expect(picked(entry(-1))).toBeUndefined();
        expect(picked(entry(0.5))).toBeUndefined();
        expect(picked(entry("1"))).toBeUndefined();
        const r = entry(1);
        expect(r.ok && r.file.history[0].options).toEqual(opts);
    });

    it("letter the options A, B, C", () => {
        expect([0, 1, 2, 3].map(optionLetter)).toEqual(["A", "B", "C", "D"]);
    });
});

describe("mainView", () => {
    const q = { n: 1, text: "Q", part: "a" };

    it("is the question while it asks, the working note while the agent writes, else the design", () => {
        expect(mainView(file({ question: q }), false)).toBe("question");
        expect(mainView(file({ working: "w" }), false)).toBe("working");
        expect(mainView(file({ question: q, working: "w" }), false)).toBe("working");
        expect(mainView(file(), false)).toBe("design");
    });

    it("the design opened over either shows the design", () => {
        expect(mainView(file({ question: q }), true)).toBe("design");
        expect(mainView(file({ working: "w" }), true)).toBe("design");
    });

    it("is judging while the judge weighs the approaches, a rerun's earlier options included", () => {
        expect(mainView(waitFile(), false)).toBe("judging");
        const rerun = waitFile({
            question: {
                ...waitQuestion(),
                options: [{ label: "A", detail: "" }],
                read: "old",
                judge: { kind: "weighed", added: [], dropped: [] },
            },
        });
        expect(mainView(rerun, false)).toBe("judging");
    });

    it("is working, not judging, with a line pending, no approaches or no question", () => {
        expect(mainView(waitFile(), false, true)).toBe("working");
        expect(mainView(waitFile({ question: { ...waitQuestion(), approaches: [] } }), false)).toBe("working");
        expect(mainView(waitFile({ question: { ...waitQuestion(), approaches: undefined } }), false)).toBe("working");
        expect(mainView(waitFile({ question: null }), false)).toBe("working");
    });

    it("is the question once the wait ends with options and no working", () => {
        expect(mainView(waitFile({ working: null }), false)).toBe("question");
    });

    it("the design opened over the wait shows the design, and the way back is judging", () => {
        expect(mainView(waitFile(), true)).toBe("design");
        expect(designUnder(waitFile(), true)).toBe("judging");
        expect(designUnder(waitFile(), true, true)).toBe("working");
    });
});

describe("boardBackLabel", () => {
    it("goes back to the question during the judge's wait", () => {
        expect(boardBackLabel(waitFile(), false)).toBe("Back to the question");
        expect(boardBackLabel(waitFile(), true)).toBe("Back to the design");
        expect(boardBackLabel(waitFile(), false, true)).toBe("Back to the design");
    });

    const q = { n: 1, text: "Q", part: "a" };

    it("goes back to the question it was opened from, else to the design", () => {
        expect(boardBackLabel(file({ question: q }), false)).toBe("Back to the question");
        expect(boardBackLabel(file({ question: q }), true)).toBe("Back to the design");
        expect(boardBackLabel(file({ question: q, working: "w" }), false)).toBe("Back to the design");
        expect(boardBackLabel(file(), false)).toBe("Back to the design");
        expect(boardBackLabel(null, false)).toBe("Back to the design");
    });
});

describe("pickableOptions", () => {
    const options = ["A", "B", "C", "D", "E"].map((label) => ({ label, detail: "" }));
    const q = { n: 1, text: "Q", part: "a", options: options.slice(0, 3) };
    const s = { designOpen: false, board: null, removed: false };
    const check = { yours: [], calls: [], answered: [] };

    it("is the options the question view draws", () => {
        expect(pickableOptions(file({ question: q }), s)).toBe(3);
        expect(pickableOptions(file({ question: { ...q, options: undefined } }), s)).toBe(0);
    });

    it("stops at the number of letter keys", () => {
        expect(pickableOptions(file({ question: { ...q, options } }), s)).toBe(4);
    });

    it("is none when nothing draws them: no file, the agent writing, the design or a board open, the file gone", () => {
        expect(pickableOptions(null, s)).toBe(0);
        expect(pickableOptions(file({ question: q, working: "w" }), s)).toBe(0);
        expect(pickableOptions(file({ question: q }), { ...s, designOpen: true })).toBe(0);
        expect(pickableOptions(file({ question: q }), { ...s, board: "B.dc.html" })).toBe(0);
        expect(pickableOptions(file({ question: q }), { ...s, removed: true })).toBe(0);
    });

    it("in the check, is the talk question's options while it is the main area", () => {
        const builder = { q: "B?", options: options.slice(0, 2) };
        const f = file({ question: q, check: { ...check, yours: [builder] } });
        expect(pickableOptions(f, s)).toBe(3);
        expect(pickableOptions({ ...f, working: "w" }, s)).toBe(0);
    });

    it("in the check, is the open builder question's options once no talk question is asked", () => {
        const yours = [
            { q: "done", a: "yes", options },
            { q: "B?", options: options.slice(0, 2) },
        ];
        expect(pickableOptions(file({ check: { ...check, yours } }), s)).toBe(2);
        expect(pickableOptions(file({ check: { ...check, yours: [{ q: "B?" }] } }), s)).toBe(0);
    });

    it("in the check, is none on the review, whether opened over a question or with nothing left to ask", () => {
        const yours = [{ q: "B?", options }];
        expect(pickableOptions(file({ question: q, check: { ...check, yours } }), { ...s, designOpen: true })).toBe(0);
        expect(pickableOptions(file({ check: { ...check, yours: [{ q: "B?", a: "yes", options }] } }), s)).toBe(0);
    });

    it("during the judge's wait, is the approaches the pane draws as the rows, up to the letter keys", () => {
        expect(pickableOptions(waitFile(), s)).toBe(4);
        expect(pickableOptions(waitFile({ question: waitQuestion(2) }), s)).toBe(2);
        expect(pickableOptions(waitFile({ question: waitQuestion(2) }), { ...s, sent: null })).toBe(2);
    });

    it("during the judge's wait in the check, is the approaches too", () => {
        expect(pickableOptions(waitFile({ check }), s)).toBe(4);
        expect(pickableOptions(waitFile({ check, question: waitQuestion(3) }), s)).toBe(3);
    });

    it("is none during the wait with a line sent, the design open or a board open", () => {
        const sent = { at: 1, modifiedMs: 1, kind: "line" } as const;
        expect(pickableOptions(waitFile(), { ...s, sent })).toBe(0);
        expect(pickableOptions(waitFile({ check }), { ...s, sent })).toBe(0);
        expect(pickableOptions(waitFile(), { ...s, designOpen: true })).toBe(0);
        expect(pickableOptions(waitFile(), { ...s, board: "B.dc.html" })).toBe(0);
    });
});

describe("checkMain", () => {
    const check = { yours: [], calls: [], answered: [] };
    const q = { n: 6, text: "Q", part: "" };
    const open = { q: "B?" };

    it("asks the talk question first, then the first unanswered builder question, else the review", () => {
        expect(checkMain(file({ question: q, check: { ...check, yours: [open] } }), false)).toBe("question");
        expect(checkMain(file({ check: { ...check, yours: [{ q: "A?", a: "yes" }, open] } }), false)).toBe("builder");
        expect(checkMain(file({ check: { ...check, yours: [{ q: "A?", a: "yes" }] } }), false)).toBe("review");
        expect(checkMain(file({ check }), false)).toBe("review");
    });

    it("shows the agent writing over any question", () => {
        expect(checkMain(file({ question: q, working: "w", check: { ...check, yours: [open] } }), false)).toBe(
            "working"
        );
    });

    it("is the review when the design is opened over a question or the agent writing", () => {
        expect(checkMain(file({ question: q, check: { ...check, yours: [open] } }), true)).toBe("review");
        expect(checkMain(file({ working: "w", check }), true)).toBe("review");
    });

    it("is judging while the judge weighs the approaches, working with a line pending or none listed", () => {
        const f = waitFile({ check: { ...check, yours: [open] } });
        expect(checkMain(f, false)).toBe("judging");
        expect(checkMain(f, false, true)).toBe("working");
        expect(checkMain({ ...f, question: { ...waitQuestion(), approaches: [] } }, false)).toBe("working");
        expect(checkMain({ ...f, question: null }, false)).toBe("working");
        expect(checkMain(f, true)).toBe("review");
        expect(checkUnder(f, true)).toBe("judging");
        expect(checkUnder(f, true, true)).toBe("working");
    });
});

describe("lineBox", () => {
    const check = { yours: [], calls: [], answered: [] };
    const q = { n: 6, text: "Q", part: "" };

    it("is offered with no question open: the design after done, parts awaiting keep or restore, the check's review", () => {
        expect(lineBox(file({ done: true, parts: [part("a", "yours")] }))).toBe("open");
        expect(lineBox(file({ parts: [part("a", "guess", { was: "old" })] }))).toBe("open");
        expect(lineBox(file({ done: true, check: { ...check, yours: [{ q: "A?", a: "yes" }] } }))).toBe("open");
    });

    it("is not offered while a talk or builder question is open, nor once a run started", () => {
        expect(lineBox(file({ question: q }))).toBe("none");
        expect(lineBox(file({ check: { ...check, yours: [{ q: "B?" }] } }))).toBe("none");
        expect(lineBox(file({ done: true, run: "r1" }))).toBe("none");
    });

    it("is locked while the agent writes, a sent line pending included, or a builder check is pending", () => {
        expect(lineBox(file({ working: "Writing" }))).toBe("locked");
        const sent: SentLine = { at: 1, modifiedMs: 0, kind: "answer" };
        expect(lineBox(shownFile(file({ done: true }), sent))).toBe("locked");
        expect(lineBox(file({ done: true }), true)).toBe("locked");
    });
});

describe("questionTrack", () => {
    it("answered questions, the one asked, then one per open part but the builder's", () => {
        const f = file({
            question: { n: 3, text: "Q", part: "c" },
            history: [
                { kind: "question", n: 1, q: "q1", a: "a1", into: [] },
                { kind: "recon", q: "r", a: "r", into: [] },
                { kind: "question", n: 2, q: "q2", a: "a2", into: [] },
            ],
            parts: [
                part("a", "yours"),
                part("b", "guess"),
                part("c", "asked"),
                part("d", "open"),
                part(BUILDER_PART, "open"),
            ],
        });
        expect(questionTrack(f)).toEqual(["done", "done", "now", "ahead"]);
    });

    it("has no now segment while no question is asked", () => {
        expect(questionTrack(file({ parts: [part("a", "open")] }))).toEqual(["ahead"]);
    });
});

describe("designLabel", () => {
    it("names how many parts are yours", () => {
        const f = file({ parts: [part("a", "yours"), part("b", "guess"), part("c", "asked")] });
        expect(designLabel(f)).toBe("The design · 1 of 3 yours");
    });

    it("is plain with no parts yet", () => {
        expect(designLabel(file())).toBe("The design");
    });
});

describe("orderedParts", () => {
    it("keeps file order and moves the builder part last", () => {
        const f = file({ parts: [part("x", "yours"), part(BUILDER_PART, "open"), part("y", "guess")] });
        expect(orderedParts(f).map((p) => p.id)).toEqual(["x", "y", BUILDER_PART]);
    });
});

describe("sentenceDiff", () => {
    it("marks same, removed and added sentences", () => {
        expect(sentenceDiff("One. Two. Three.", "One. Deux! Three.")).toEqual([
            { kind: "same", text: "One." },
            { kind: "removed", text: "Two." },
            { kind: "added", text: "Deux!" },
            { kind: "same", text: "Three." },
        ]);
    });

    it("handles an empty side", () => {
        expect(sentenceDiff("", "A.")).toEqual([{ kind: "added", text: "A." }]);
        expect(sentenceDiff("A?", "")).toEqual([{ kind: "removed", text: "A?" }]);
    });
});

describe("handoffView", () => {
    const check = {
        yours: [{ q: "q1", a: "ans" }, { q: "q2" }],
        calls: [{ text: "c1", part: "p1" }],
        answered: ["x"],
    };
    const parts = [part("p1", "yours"), part("p2", "yours"), part("p3", "yours")];

    it("counts questions and finds the open one", () => {
        const v = handoffView(file({ parts, check }));
        expect(v.questions).toBe(2 + 1 + 1);
        expect(v.open).toEqual({ q: "q2" });
        expect(v.answered).toEqual([{ q: "q1", a: "ans" }]);
    });

    it("counts the three tiles: for you, the agent decided, already in the design", () => {
        const v = handoffView(file({ parts, check }));
        expect([v.forYou, v.calls.length, v.already]).toEqual([2, 1, 1]);
    });

    it("treats every part as touched when touched is absent", () => {
        const v = handoffView(file({ parts, check }));
        expect(v.touched.map((p) => p.id)).toEqual(["p1", "p2", "p3"]);
        expect(v.untouched).toEqual([]);
    });

    it("splits touched and untouched when the builder named them", () => {
        const v = handoffView(file({ parts, check: { ...check, touched: ["p2", "ghost"] } }));
        expect(v.touched.map((p) => p.id)).toEqual(["p2"]);
        expect(v.untouched.map((p) => p.id)).toEqual(["p1", "p3"]);
    });
});

describe("partView", () => {
    const asking = { n: 2, text: "?", part: "a" };

    it("reads a guess that was yours as changed", () => {
        expect(partView(file(), part("a", "guess"))).toBe("guess");
        expect(partView(file(), part("a", "guess", { was: "before" }))).toBe("changed");
    });

    it("reads an asked part as writing only while the agent writes and asks nothing", () => {
        expect(partView(file({ working: "w" }), part("a", "asked"))).toBe("writing");
        expect(partView(file({ question: asking }), part("a", "asked"))).toBe("asked");
        expect(partView(file({ working: "w", question: asking }), part("a", "asked"))).toBe("asked");
    });

    it("passes yours and open through", () => {
        expect(partView(file(), part("a", "yours"))).toBe("yours");
        expect(partView(file(), part("a", "open"))).toBe("open");
    });
});

describe("phase", () => {
    const steps = (f: BrainstormFile) => phaseSteps(f).map((s) => `${s.label}:${s.status}`);
    const check = { yours: [], calls: [], answered: [] };

    it("talks until a builder check exists", () => {
        expect(brainstormPhase(file({ done: true }))).toBe("talk");
        expect(steps(file())).toEqual(["Talking it through:current", "Builder check:todo", "Run:todo"]);
    });

    it("is on the builder check once the check is written", () => {
        expect(steps(file({ check }))).toEqual(["Talking it through:done", "Builder check:current", "Run:todo"]);
    });

    it("is on the run once one started, check or not", () => {
        expect(brainstormPhase(file({ check, run: "r1" }))).toBe("run");
        expect(steps(file({ run: "r1" }))).toEqual(["Talking it through:done", "Builder check:done", "Run:current"]);
    });

    it("reads every phase done once the run merged", () => {
        const merged = phaseSteps(file({ check, run: "r1" }), true).map((s) => `${s.label}:${s.status}`);
        expect(merged).toEqual(["Talking it through:done", "Builder check:done", "Run:done"]);
    });
});

describe("progressView", () => {
    const parts = [part(BUILDER_PART, "open"), part("a", "yours"), part("b", "guess"), part("c", "asked")];

    it("has one segment per part, the builder last, each with its state", () => {
        expect(progressView(file({ parts })).segments).toEqual([
            { id: "a", title: "Title a", state: "yours" },
            { id: "b", title: "Title b", state: "guess" },
            { id: "c", title: "Title c", state: "asked" },
            { id: BUILDER_PART, title: `Title ${BUILDER_PART}`, state: "open" },
        ]);
    });

    it("reads N of M parts yours while talking", () => {
        const v = progressView(file({ parts }));
        expect([v.lead, v.rest]).toEqual(["1 of 4", "parts yours"]);
        expect(progressView(file()).lead).toBe("0 of 0");
    });

    it("reads yours and what is open at the builder check", () => {
        const check = { yours: [], calls: [], answered: [] };
        const all = file({ check, parts: [part("a", "yours"), part("b", "yours")] });
        expect([progressView(all).lead, progressView(all).rest]).toEqual(["2 yours", "· nothing open"]);
        expect(progressView(file({ check, parts })).rest).toBe("· 2 open");
    });
});

describe("partGist", () => {
    it("is the agent's gist, else the body's first sentence", () => {
        const f = file();
        expect(partGist(f, part("a", "guess", { gist: "One line.", body: "Long. Body." }))).toBe("One line.");
        expect(partGist(f, part("a", "guess", { body: "First one. Second one." }))).toBe("First one.");
    });

    it("with no body, says what the part waits on", () => {
        const f = file({ question: { n: 4, text: "?", part: "c" } });
        expect(partGist(f, part("c", "asked"))).toBe("Written from your answer to question 4.");
        expect(partGist(f, part("x", "asked"))).toBe("Waiting on the agent’s question.");
        expect(partGist(file({ working: "w" }), part("c", "asked"))).toBe(
            "The agent is writing this from your answer."
        );
        expect(partGist(f, part(BUILDER_PART, "open"))).toBe("The agent writes this last.");
        expect(partGist(f, part("o", "open"))).toBe("Not talked through yet.");
    });
});

describe("reviewHead", () => {
    it("offers the builder check once every decision is yours and the agent is done", () => {
        const f = file({ done: true, parts: [part("a", "yours"), part("n", "guess", { kind: "note" })] });
        expect(reviewHead(f)).toEqual({
            line: "Every decision is yours. Next, a fresh agent reads the design as a builder would.",
            action: "check",
            guesses: 0,
        });
    });

    it("counts the guesses and offers confirm all for two or more", () => {
        const two = reviewHead(file({ parts: [part("a", "guess"), part("b", "guess"), part("c", "yours")] }));
        expect(two).toEqual({
            line: "2 decisions are still the agent’s guess. Each reads in one line; open one to read it whole.",
            action: "confirm-all",
            guesses: 2,
        });
        const one = reviewHead(file({ parts: [part("a", "guess"), part("k", "guess", { was: "old" })] }));
        expect(one.line).toBe(
            "1 decision is still the agent’s guess. 1 decision changed since you confirmed it. Each reads in one line; open one to read it whole."
        );
        expect(one.action).toBeNull();
    });

    it("with nothing to confirm, says the agent still asks", () => {
        const f = file({ question: { n: 2, text: "?", part: "c" }, parts: [part("a", "yours"), part("c", "asked")] });
        expect(reviewHead(f)).toEqual({
            line: "Nothing to confirm; the agent still has questions.",
            action: null,
            guesses: 0,
        });
    });

    it("offers no check while one is pending, and leaves a failed one to its Try again", () => {
        const f = file({ done: true, parts: [part("a", "yours")] });
        const pending = { kind: "pending", stage: "reading", text: "A builder is reading the design." } as const;
        expect(reviewHead(f, pending).action).toBeNull();
        expect(reviewHead(f, { kind: "failed", reason: "x" }).action).toBeNull();
        expect(reviewHead(f, { kind: "none" }).action).toBe("check");
    });
});

describe("notes", () => {
    const parts = [
        part("a", "yours"),
        part("n1", "guess", { kind: "note" }),
        part("b", "guess"),
        part("n2", "open", { kind: "note" }),
        part(BUILDER_PART, "open"),
    ];

    it("parse with kind note and a gist; a note needs no state", () => {
        const r = parseBrainstorm(
            raw({
                parts: [
                    { id: "a", title: "A", state: "guess", body: "x", gist: "g" },
                    { id: "n", title: "N", kind: "note", body: "found" },
                    { id: "m", title: "M", kind: "other", state: "yours", body: "" },
                ],
            })
        );
        expect(r.ok && r.file.parts).toEqual([
            { id: "a", title: "A", state: "guess", body: "x", gist: "g" },
            { id: "n", title: "N", state: "yours", kind: "note", body: "found" },
            { id: "m", title: "M", state: "yours", body: "" },
        ]);
        expect(errorOf(parseBrainstorm(raw({ parts: [{ id: "x", kind: "other", body: "" }] })))).toBe(
            'part "x" has an unknown state "undefined"'
        );
    });

    it("are left out of every count, gate and label", () => {
        const f = file({ parts });
        expect(brainstormCounts(f)).toEqual({ yours: 1, guesses: 1, open: 1 });
        expect(confirmableGuesses(f)).toBe(1);
        expect(designLabel(f)).toBe("The design · 1 of 3 yours");
        expect(progressView(f).segments.map((x) => x.id)).toEqual(["a", "b", BUILDER_PART]);
        expect(questionTrack(file({ parts: [part("n", "open", { kind: "note" }), part("o", "open")] }))).toEqual([
            "ahead",
        ]);
        const ready = file({ done: true, parts: [part("a", "yours"), part("n", "guess", { kind: "note" })] });
        expect(canCheck(ready)).toBe(true);
        expect(noteParts(f).map((p) => p.id)).toEqual(["n1", "n2"]);
    });
});

describe("leftPanel", () => {
    const q1 = { n: 1, text: "?", part: "a" };
    const said = [{ kind: "question" as const, n: 1, q: "?", a: "x", into: [] }];
    const yours = [part("a", "yours")];

    it("holds the builder check once every part is yours and the agent is done", () => {
        expect(leftPanel(file({ done: true, parts: yours, history: said }))).toBe("ready");
        expect(leftPanel(file({ done: true, parts: yours }))).toBe("ready");
    });

    it("holds nothing while the agent writes, even when ready", () => {
        expect(leftPanel(file({ done: true, parts: yours, working: "w" }))).toBe("none");
    });

    it("holds nothing beside the first question, and the list otherwise", () => {
        expect(leftPanel(file({ question: q1, parts: [part("a", "asked")] }))).toBe("none");
        expect(leftPanel(file({ question: q1, parts: [part("a", "asked")], history: said }))).toBe("left");
        expect(leftPanel(file({ parts: [part("a", "guess")] }))).toBe("left");
        expect(leftPanel(file({ parts: yours }))).toBe("left");
    });
});

// the Check-Review board: 8 decisions the check changed, 2 new since it (a guess, and one question 16 asks), 3 left
// as confirmed, 6 notes, and the builder's 3 questions answered
const reviewBoard = (): BrainstormFile => {
    const changed = (id: string, cause: Partial<BrainstormPart>) =>
        part(id, "guess", { title: `Title ${id}`, gist: `now ${id}`, body: `Now ${id}.`, was: `Was ${id}.`, ...cause });
    const notes = ["engine", "research", "proscons", "steps", "options", "hardware"].map((id) =>
        part(id, "yours", { kind: "note" })
    );
    return file({
        done: true,
        question: { n: 16, text: "What is the graph model for?", part: "graph" },
        parts: [
            part("intent", "yours"),
            changed("constraints", { why: "answer 12: your boss wants PyTorch" }),
            changed("direction", { why: "answer 15: decide both models at a high level now" }),
            part("torch", "guess", { gist: "A shared torch base." }),
            changed("grain", { why: "builder question 1 and 3" }),
            changed("role", { from: "builder question 1" }),
            changed("damping", { why: "builder question 1" }),
            changed("purpose", { why: "builder questions 1 and 2" }),
            changed("evaluation", { why: "builder question 1" }),
            changed("model", { why: "you asked for an ML model, not a statistical profile" }),
            part("graph", "asked"),
            part("order", "yours"),
            ...notes,
            part(BUILDER_PART, "yours"),
        ],
        check: {
            yours: [
                {
                    q: "What should the forecast act on?",
                    a: "Add a per-entity event_count field",
                    into: ["grain", "role", "damping", "purpose", "evaluation"],
                },
                { q: "Re-grade severity?", a: "Neither", into: ["purpose"] },
                { q: "A day with no row?", a: "Zero", into: ["grain"] },
            ],
            calls: [
                { text: "p1", part: "purpose" },
                { text: "m1", part: "model" },
                { text: "e1", part: "evaluation" },
                { text: "m2", part: "model" },
                { text: "p2", part: "purpose" },
                { text: "m3", part: "model" },
                { text: "e2", part: "evaluation" },
                { text: "m4", part: "model" },
            ],
            answered: [],
            touched: ["constraints", "direction", "grain", "role", "damping", "purpose", "evaluation", "model"],
        },
    });
};

describe("approveBlocker", () => {
    const yoursAll = [part("a", "yours"), part("b", "yours"), part("n", "guess", { kind: "note" })];
    const check = { yours: [{ q: "q1" }], calls: [], answered: [] };
    const answered = { ...check, yours: [{ q: "q1", a: "yes" }] };

    it("asks for the builder's unanswered questions first, then the talk question", () => {
        const three = { ...check, yours: [{ q: "q1" }, { q: "q2" }, { q: "q3" }, { q: "q4", a: "yes" }] };
        expect(approveBlocker(file({ parts: yoursAll, check: three }))).toBe(
            "Answer the builder’s 3 questions, then review what they change"
        );
        expect(approveBlocker(file({ parts: yoursAll, check }))).toBe(
            "Answer the builder’s 1 question, then review what it changes"
        );
        const q = { n: 16, text: "Q", part: "a" };
        expect(approveBlocker(file({ parts: yoursAll, check, question: q }))).toBe(
            "Answer the builder’s 1 question, then review what it changes, and answer question 16"
        );
    });

    it("names what is left in the design once the builder is answered", () => {
        expect(approveBlocker(reviewBoard())).toBe("Review 8 changes, confirm 1 guess, answer question 16");
        const parts = [part("a", "guess", { was: "w" }), part("b", "open"), part("c", "asked"), part("d", "yours")];
        expect(approveBlocker(file({ parts, check: answered }))).toBe("Review 1 change, 2 decisions still open");
        expect(approveBlocker(file({ parts: [part("a", "open")], check: answered }))).toBe("1 decision still open");
    });

    it("blocks a design that is still the agent's guesses", () => {
        const parts = Array.from({ length: 10 }, (_, i) => part(`g${i}`, "guess"));
        expect(approveBlocker(file({ parts: [...parts, part("y", "yours")], check: answered }))).toBe(
            "Confirm 10 guesses"
        );
    });

    it("never counts notes", () => {
        const notes = [part("n1", "guess", { kind: "note" }), part("n2", "open", { kind: "note" })];
        expect(approveBlocker(file({ parts: [part("a", "yours"), ...notes], check: answered }))).toBeNull();
    });

    it("names the agent writing before anything else", () => {
        expect(approveBlocker(file({ check, working: "w" }))).toBe("The agent is writing; this opens when it is done");
    });

    it("is null once everything is yours and answered, or once a run started", () => {
        expect(approveBlocker(file({ parts: yoursAll, check: answered }))).toBeNull();
        expect(approveBlocker(file({ check, run: "r1", working: "w" }))).toBeNull();
    });
});

describe("checkAsk", () => {
    // the Main board: the builder's 3 questions, none answered, and the agent's 8 calls over 3 parts
    const parts = [
        part("intent", "yours"),
        part("role", "yours", { title: "Where the forecast sits" }),
        part("purpose", "yours"),
        part("evaluation", "yours"),
        part("model", "yours"),
    ];
    const yours = [
        { q: "What should the forecast act on?", label: "What the forecast acts on", part: "role" },
        { q: "Re-grade severity?" },
        { q: "A day with no row?", label: "A day with no aggregate row" },
    ];
    const calls = [
        { text: "m1", part: "model" },
        { text: "p1", part: "purpose" },
        { text: "m2", part: "model" },
        { text: "e1", part: "evaluation" },
        { text: "p2", part: "purpose" },
        { text: "m3", part: "model" },
        { text: "e2", part: "evaluation" },
        { text: "m4", part: "model" },
    ];
    const f = file({ parts, check: { yours, calls, answered: [] } });

    it("asks the first unanswered question and counts the check's questions", () => {
        const m = checkAsk(f);
        expect(m.index).toBe(1);
        expect(m.total).toBe(3);
        expect(m.open).toBe(yours[0]);
        expect(m.calls).toBe(8);
        expect(m.already).toEqual([]);
        expect(m.questions).toBe(11);
    });

    it("queues each question by its label, else its text", () => {
        expect(checkAsk(f).queue).toEqual([
            { label: "What the forecast acts on", state: "now" },
            { label: "Re-grade severity?", state: "waiting" },
            { label: "A day with no aggregate row", state: "waiting" },
        ]);
        const later = checkAsk(
            file({ parts, check: { yours: [{ ...yours[0], a: "x" }, ...yours.slice(1)], calls, answered: ["a1"] } })
        );
        expect(later.index).toBe(2);
        expect(later.open).toBe(yours[1]);
        expect(later.queue.map((q) => q.state)).toEqual(["answered", "now", "waiting"]);
        expect(later.already).toEqual(["a1"]);
        expect(later.questions).toBe(12);
    });

    it("groups the calls in the design's order, those with no known part last", () => {
        expect(checkAsk(f).callGroups).toEqual([
            { part: "purpose", title: "Title purpose", calls: ["p1", "p2"] },
            { part: "evaluation", title: "Title evaluation", calls: ["e1", "e2"] },
            { part: "model", title: "Title model", calls: ["m1", "m2", "m3", "m4"] },
        ]);
        const loose = checkAsk(
            file({
                parts,
                check: { yours, calls: [{ text: "x" }, { text: "y", part: "ghost" }, calls[1]], answered: [] },
            })
        );
        expect(loose.callGroups).toEqual([
            { part: "purpose", title: "Title purpose", calls: ["p1"] },
            { part: null, title: "Other decisions", calls: ["x", "y"] },
        ]);
    });

    it("has no open question once all are answered", () => {
        const m = checkAsk(file({ parts, check: { yours: [{ q: "a", a: "x" }], calls: [], answered: [] } }));
        expect(m.open).toBeNull();
        expect(m.index).toBe(0);
        expect(m.queue).toEqual([{ label: "a", state: "answered" }]);
    });
});

describe("checkReview", () => {
    it("reads the Check-Review board", () => {
        const m = checkReview(reviewBoard());
        expect(m.changed.map((r) => r.id)).toEqual([
            "constraints",
            "direction",
            "grain",
            "role",
            "damping",
            "purpose",
            "evaluation",
            "model",
        ]);
        expect(m.changed.every((r) => r.action === "keep-restore" && r.view === "changed")).toBe(true);
        expect(m.changed[0]).toEqual({
            id: "constraints",
            title: "Title constraints",
            gist: "now constraints",
            cause: "answer 12: your boss wants PyTorch",
            was: "Was constraints.",
            body: "Now constraints.",
            view: "changed",
            action: "keep-restore",
            calls: [],
        });
        expect(m.changed.find((r) => r.id === "role")?.cause).toBe("builder question 1");
        expect(m.changed.find((r) => r.id === "model")?.calls).toEqual(["m1", "m2", "m3", "m4"]);
        expect(m.fresh.map((r) => [r.id, r.view, r.action, r.question])).toEqual([
            ["torch", "guess", "confirm", undefined],
            ["graph", "asked", "answer", 16],
        ]);
        expect(m.unchanged.map((p) => p.id)).toEqual(["intent", "order", BUILDER_PART]);
        expect(m.notes).toHaveLength(6);
        expect(m.cursorIds).toEqual([...m.changed.map((r) => r.id), "torch", "graph"]);
        expect(m.pending).toBe(8);
        expect(m.summary).toBe(
            "Your answers to the builder changed 8 decisions you had confirmed, and 2 are new. Keep each change or put yours back; the agent’s 8 calls sit under the decision they belong to."
        );
        expect(m.answered).toEqual([
            {
                q: "What should the forecast act on?",
                a: "Add a per-entity event_count field",
                changed: ["grain", "role", "damping", "purpose", "evaluation"].map((id) => ({
                    id,
                    title: `Title ${id}`,
                })),
            },
            { q: "Re-grade severity?", a: "Neither", changed: [{ id: "purpose", title: "Title purpose" }] },
            { q: "A day with no row?", a: "Zero", changed: [{ id: "grain", title: "Title grain" }] },
        ]);
    });

    it("draws a kept part as changed and settled, with no action", () => {
        const f = reviewBoard();
        const kept = {
            ...f,
            parts: f.parts.map((p) => (p.id === "role" ? { ...p, state: "yours" as const, was: undefined } : p)),
        };
        const row = checkReview(kept).changed.find((r) => r.id === "role");
        expect(row).toMatchObject({ view: "yours", action: null });
        expect(row?.was).toBeUndefined();
        expect(checkReview(kept).summary).toContain("changed 8 decisions");
        expect(checkReview(kept).pending).toBe(7);
    });

    it("counts a yours part an agent's call is under as changed, even untouched", () => {
        const f = file({
            parts: [part("a", "yours"), part("b", "yours")],
            check: { yours: [], calls: [{ text: "c", part: "b" }, { text: "loose" }], answered: [], touched: [] },
        });
        const m = checkReview(f);
        expect(m.changed.map((r) => [r.id, r.view, r.action, r.calls])).toEqual([["b", "yours", null, ["c"]]]);
        expect(m.unchanged.map((p) => p.id)).toEqual(["a"]);
        expect(m.summary).toBe(
            "Your answers to the builder changed 1 decision you had confirmed. The agent’s 1 call sits under the decision it belongs to."
        );
    });

    it("drops the clauses whose count is 0", () => {
        const fresh = file({
            parts: [part("a", "yours"), part("b", "guess")],
            check: { yours: [], calls: [], answered: [] },
        });
        expect(checkReview(fresh).summary).toBe("1 decision is new since the check.");
        const none = file({ parts: [part("a", "yours")], check: { yours: [], calls: [], answered: [] } });
        expect(checkReview(none).summary).toBe("The check changed nothing you had confirmed.");
    });
});

describe("summaries", () => {
    const parts = [
        ...["a", "b", "c", "d", "e"].map((id) => part(id, "yours")),
        part("f", "guess"),
        part("g", "guess"),
        part("h", "open"),
    ];

    it("compactedSummary", () => {
        expect(compactedSummary(file({ parts }))).toBe(
            "The agent compacted its context and re-read its brainstorm file: 5 parts yours, 2 guesses, 1 open. Nothing was lost."
        );
        expect(compactedSummary(file({ parts: [part("a", "yours"), part("b", "guess"), part("c", "open")] }))).toBe(
            "The agent compacted its context and re-read its brainstorm file: 1 part yours, 1 guess, 1 open. Nothing was lost."
        );
    });

    it("exitedSummary", () => {
        const two = parts.slice(0, 7);
        expect(exitedSummary(file({ parts: two, question: { n: 5, text: "?", part: "a" } }))).toBe(
            "The brainstorm is saved: 5 parts yours, 2 guesses, and question 5 still unanswered. A new agent reads it and carries on from that question."
        );
        expect(exitedSummary(file({ parts: two }))).toBe(
            "The brainstorm is saved: 5 parts yours, 2 guesses. A new agent reads it and carries on."
        );
    });

    it("resumePrompt and runLine", () => {
        expect(resumePrompt("C:\\p\\brainstorm.json")).toBe(
            "Resume the brainstorm in C:\\p\\brainstorm.json with arc:brainstorm."
        );
        expect(runLine("siem-pipeline")).toBe("siem-pipeline · orchestrator · this design attached");
    });
});

describe("runPrefill", () => {
    const base = { projectName: "proj", cwd: "C:\\proj" };

    it("joins a relative spec to the cwd and builds the goal", () => {
        const p = runPrefill(file({ title: "Lag alerts", spec: "docs/specs/lag.md" }), base);
        expect(p.projectName).toBe("proj");
        expect(p.shape).toBe("orchestrator");
        expect(p.goal).toBe("Build Lag alerts as specified in C:\\proj\\docs\\specs\\lag.md.");
        expect(p.prototype).toBeUndefined();
    });

    it("keeps an absolute spec as it is", () => {
        const p = runPrefill(file({ title: "T", spec: "D:\\elsewhere\\s.md" }), base);
        expect(p.goal).toBe("Build T as specified in D:\\elsewhere\\s.md.");
    });

    it("names no spec in the goal when the brainstorm wrote none", () => {
        expect(runPrefill(file({ title: "T" }), base).goal).toBe("Build T.");
    });

    it("uses the first listed board, in part order, as the prototype", () => {
        const f = file({
            canvas: "lag",
            spec: "s.md",
            parts: [
                part("a", "yours"),
                part("b", "guess", { boards: ["Page.dc.html"] }),
                part("c", "guess", { boards: ["Other.dc.html"] }),
            ],
        });
        expect(runPrefill(f, base).prototype).toBe("C:\\proj\\.superpowers\\design\\lag\\project\\Page.dc.html");
    });

    it("has no prototype without a listed board or without a canvas", () => {
        expect(runPrefill(file({ canvas: "lag", parts: [part("a", "yours")] }), base).prototype).toBeUndefined();
        expect(
            runPrefill(file({ parts: [part("a", "yours", { boards: ["Page.dc.html"] })] }), base).prototype
        ).toBeUndefined();
    });
});

describe("brainstormAttention", () => {
    it("builds the outward attention item", () => {
        const f = file({
            question: { n: 3, text: "What pages you?", part: "page" },
            parts: [part("page", "asked", { title: "What on-call sees" })],
        });
        expect(brainstormAttention({ agentId: "t1", agentName: "loom", topic: "lag" }, f)).toEqual({
            kind: "brainstorm",
            key: "brainstorm:t1:3",
            source: "loom",
            text: "What pages you?",
            action: "brainstorm",
            oref: "brainstorm:lag",
            phaseidx: 0,
            waitingsince: 0,
        });
    });

    it("keys the item by the question's number, so a new question is a new item", () => {
        const at = (n: number) =>
            brainstormAttention(
                { agentId: "t", agentName: "n", topic: "x" },
                file({ question: { n, text: "?", part: "" } })
            );
        expect(at(6).key).toBe("brainstorm:t:6");
        expect(at(7).key).not.toBe(at(6).key);
    });
});

describe("paneView", () => {
    const f = file();
    const s = { file: f, error: null, removed: false, exited: false, showDesign: false, board: null };

    it("defaults to the design", () => {
        expect(paneView(s)).toBe("design");
    });

    it("removed beats everything", () => {
        expect(paneView({ ...s, removed: true, error: "e", exited: true, board: "B" })).toBe("removed");
    });

    it("error shows only with no last good file", () => {
        expect(paneView({ ...s, file: null, error: "bad" })).toBe("error");
        expect(paneView({ ...s, error: "bad" })).toBe("design");
    });

    it("exited holds unless showDesign or a run started", () => {
        expect(paneView({ ...s, exited: true })).toBe("exited");
        expect(paneView({ ...s, exited: true, showDesign: true })).toBe("design");
        expect(paneView({ ...s, exited: true, file: file({ run: "r1" }) })).toBe("run");
    });

    it("board beats run beats check beats design", () => {
        const withCheck = file({ check: { yours: [], calls: [], answered: [] } });
        const withRun = { ...withCheck, run: "r1" };
        expect(paneView({ ...s, file: withRun, board: "B.dc.html" })).toBe("board");
        expect(paneView({ ...s, file: withRun })).toBe("run");
        expect(paneView({ ...s, file: file({ run: "r1" }) })).toBe("run");
        expect(paneView({ ...s, file: withCheck, board: "B.dc.html" })).toBe("board");
        expect(paneView({ ...s, file: withCheck })).toBe("check");
    });
});

describe("designUnder and checkUnder", () => {
    const q = { n: 1, text: "Q", part: "a" };
    const check = { yours: [], calls: [], answered: [] };

    it("name the main view the design was opened over, or the design itself when it was not", () => {
        expect(designUnder(file({ question: q }), true)).toBe("question");
        expect(designUnder(file({ working: "w" }), true)).toBe("working");
        expect(designUnder(file(), true)).toBe("design");
        expect(designUnder(file({ question: q }), false)).toBe("design");
    });

    it("name the check's main area the review was opened over, or the review itself when it was not", () => {
        expect(checkUnder(file({ question: q, check }), true)).toBe("question");
        expect(checkUnder(file({ check: { ...check, yours: [{ q: "B?" }] } }), true)).toBe("builder");
        expect(checkUnder(file({ check }), true)).toBe("review");
        expect(checkUnder(file({ question: q, check }), false)).toBe("review");
    });
});

describe("paneBack", () => {
    const q = { n: 1, text: "Q", part: "a" };
    const check = { yours: [], calls: [], answered: [] };
    const s = {
        file: file({ question: q }),
        error: null,
        removed: false,
        exited: false,
        showDesign: false,
        board: null,
        designOpen: false,
    };
    const back = (over: Partial<typeof s> & { file?: BrainstormFile | null; error?: string | null } = {}) => {
        const x = { ...s, ...over };
        return paneBack(x, x.file);
    };

    it("a full-size board steps back to where it was opened, the question or the design", () => {
        expect(back({ board: "B.dc.html" })).toBe("board");
        expect(back({ board: "B.dc.html", designOpen: true })).toBe("board");
        expect(back({ board: "B.dc.html", file: file({ question: q, check }) })).toBe("board");
    });

    it("the design opened over the question or the working note steps back to it", () => {
        expect(back({ designOpen: true })).toBe("design");
        expect(back({ designOpen: true, file: file({ working: "w" }) })).toBe("design");
        expect(back({ designOpen: true, exited: true, showDesign: true })).toBe("design");
    });

    it("the design opened with nothing under it has no step, a pending builder check's design included", () => {
        expect(back({ designOpen: true, file: file() })).toBeNull();
    });

    it("the check's review opened over its question, a builder question or the working note steps back to it", () => {
        expect(back({ designOpen: true, file: file({ question: q, check }) })).toBe("design");
        expect(back({ designOpen: true, file: file({ check: { ...check, yours: [{ q: "B?" }] } }) })).toBe("design");
        expect(back({ designOpen: true, file: file({ working: "w", check }) })).toBe("design");
        expect(back({ designOpen: true, file: file({ check }) })).toBeNull();
    });

    it("has no step from the question itself, a run, the exited card, or an unreadable or removed file", () => {
        expect(back()).toBeNull();
        expect(back({ file: file({ question: q, check }) })).toBeNull();
        expect(back({ designOpen: true, file: file({ question: q, run: "r1" }) })).toBeNull();
        expect(back({ designOpen: true, exited: true })).toBeNull();
        expect(back({ designOpen: true, file: null, error: "bad" })).toBeNull();
        expect(back({ designOpen: true, removed: true })).toBeNull();
    });
});

describe("partBoards and questionBoards", () => {
    const BASE = "http://127.0.0.1:1234";
    const boards = ["A.dc.html", "B.dc.html"];
    const parts = [part("layout", "asked", { boards }), part("copy", "open")];
    const q = (p: string) => ({ n: 3, text: "Which layout?", part: p });

    it("a part's boards show once the canvas is named and served", () => {
        const f = file({ canvas: "topic", parts });
        expect(partBoards(f, parts[0], BASE)).toEqual(boards);
        expect(partBoards(f, parts[0], null)).toBeNull();
        expect(partBoards(file({ parts }), parts[0], BASE)).toBeNull();
        expect(partBoards(f, parts[1], BASE)).toBeNull();
        expect(partBoards(f, undefined, BASE)).toBeNull();
    });

    it("the question shows its part's boards", () => {
        expect(questionBoards(file({ canvas: "topic", parts, question: q("layout") }), BASE)).toEqual(boards);
    });

    it("none for a part with no boards, an unknown part, no part, or no question", () => {
        const f = (question: BrainstormFile["question"]) => file({ canvas: "topic", parts, question });
        expect(questionBoards(f(q("copy")), BASE)).toBeNull();
        expect(questionBoards(f(q("ghost")), BASE)).toBeNull();
        expect(questionBoards(f(q("")), BASE)).toBeNull();
        expect(questionBoards(f(null), BASE)).toBeNull();
    });

    it("none until the canvas is named and served", () => {
        expect(questionBoards(file({ parts, question: q("layout") }), BASE)).toBeNull();
        expect(questionBoards(file({ canvas: "topic", parts, question: q("layout") }), null)).toBeNull();
    });
});

describe("spikes", () => {
    const BASE = "http://127.0.0.1:1234";
    const spikesOf = (spikes: unknown) => {
        const r = parseBrainstorm(raw({ parts: [{ id: "a", title: "A", state: "yours", body: "x", spikes }] }));
        return r.ok ? r.file.parts[0].spikes : "error";
    };

    it("a part lists its spikes as paths under the canvas folder", () => {
        expect(spikesOf(["spike/motion.html", "spike/drag.html"])).toEqual(["spike/motion.html", "spike/drag.html"]);
    });

    it("reads backslashes and a leading ./ as the same path", () => {
        expect(spikesOf(["spike\\motion.html", "./spike/drag.html"])).toEqual(["spike/motion.html", "spike/drag.html"]);
    });

    it("drops what is not a path under the canvas folder, keeping the rest", () => {
        expect(
            spikesOf([
                "",
                "  ",
                5,
                "/abs/x.html",
                "C:/x.html",
                "../other/x.html",
                "spike/../../x.html",
                "spike/ok.html",
            ])
        ).toEqual(["spike/ok.html"]);
    });

    it("leaves spikes out when there are none or they are not a list", () => {
        expect(spikesOf(undefined)).toBeUndefined();
        expect(spikesOf("spike/motion.html")).toBeUndefined();
        expect(spikesOf(["../x.html"])).toBeUndefined();
    });

    it("a part's spikes show once the canvas is named and served", () => {
        const p = part("motion", "yours", { spikes: ["spike/motion.html"] });
        const f = file({ canvas: "topic", parts: [p] });
        expect(partSpikes(f, p, BASE)).toEqual(["spike/motion.html"]);
        expect(partSpikes(f, p, null)).toBeNull();
        expect(partSpikes(file({ parts: [p] }), p, BASE)).toBeNull();
        expect(partSpikes(f, part("copy", "open"), BASE)).toBeNull();
        expect(partSpikes(f, undefined, BASE)).toBeNull();
    });

    it("a part has mockups when it has boards or spikes to open", () => {
        const spiked = part("motion", "guess", { spikes: ["spike/motion.html"] });
        const boarded = part("page", "guess", { boards: ["Page.dc.html"] });
        const f = file({ canvas: "topic", parts: [spiked, boarded] });
        expect(hasMockups(f, spiked, BASE)).toBe(true);
        expect(hasMockups(f, boarded, BASE)).toBe(true);
        expect(hasMockups(f, part("copy", "guess"), BASE)).toBe(false);
        expect(hasMockups(f, spiked, null)).toBe(false);
    });

    it("a spike is served from the canvas folder, each segment encoded", () => {
        expect(spikeUrl(BASE, "my topic", "spike/motion one.html")).toBe(`${BASE}/my%20topic/spike/motion%20one.html`);
    });
});

// question 8 asked A, B or C for the layout and was dropped after pushback; question 11 asked only dark or light
const overreach = (look: Partial<BrainstormPart> = {}): BrainstormFile =>
    file({
        parts: [
            part("layout", "open"),
            part("look", "yours", { from: "answer 11", body: "Mockup B, dark, like the spike.", ...look }),
        ],
        history: [
            {
                kind: "question",
                n: 8,
                q: "A, B or C?",
                a: "",
                into: [],
                part: "layout",
                superseded: true,
                options: [
                    { label: "A", detail: "" },
                    { label: "B", detail: "" },
                    { label: "C", detail: "" },
                ],
            },
            { kind: "recon", q: "You pushed back: none of these fit.", a: "Asked a narrower question.", into: [] },
            { kind: "question", n: 11, q: "Dark or light?", a: "Dark, like the spike", into: ["look"] },
        ],
    });

describe("a superseded question", () => {
    it("parses superseded and part, leniently", () => {
        const r = parseBrainstorm(
            raw({
                history: [
                    { kind: "question", n: 8, q: "A, B or C?", part: "layout", superseded: true, into: [] },
                    { kind: "question", n: 9, q: "q", a: "x", into: [], superseded: "yes" },
                    { kind: "recon", q: "r", a: "x", into: [], superseded: true },
                    { kind: "question", n: 10, q: "q", a: "y", into: [] },
                ],
            })
        );
        expect(r.ok && r.file.history.map((h) => [h.n ?? null, h.superseded ?? null, h.part ?? null])).toEqual([
            [8, true, "layout"],
            [9, null, null],
            [null, null, null],
            [10, null, null],
        ]);
    });

    it("is no answered question: the track and the answered list leave it out", () => {
        const f = overreach();
        expect(answeredQuestions(f).map((h) => h.n)).toEqual([11]);
        expect(questionTrack(f)).toEqual(["done", "ahead"]);
    });

    it("draws in the rail as dropped, with nothing picked and no answer", () => {
        const rows = historyRows(overreach());
        expect(rows.map((r) => [r.label, r.dropped])).toEqual([
            ["Recon", false],
            ["Q8", true],
            ["Q11", false],
        ]);
        const q8 = rows[1];
        expect([q8.answer, q8.ownWords, q8.options.some((o) => o.picked)]).toEqual([null, false, false]);
    });

    it("says in an open part's row that its question was dropped", () => {
        const f = overreach();
        const layout = f.parts[0];
        expect(droppedQuestion(f, layout)).toBe(8);
        expect(partGist(f, layout)).toBe("Question 8 was dropped after your pushback; nothing is decided yet.");
    });

    it("stops standing once the part is asked again or filled in", () => {
        const f = overreach();
        for (const state of ["asked", "guess", "yours"] as const) {
            expect(droppedQuestion(f, { ...f.parts[0], state })).toBeNull();
        }
        expect(droppedQuestion(f, part("other", "open"))).toBeNull();
    });

    it("reads a drop that names its part in into", () => {
        const f = file({
            parts: [part("layout", "open")],
            history: [{ kind: "question", n: 8, q: "q", a: "", into: ["layout"], superseded: true }],
        });
        expect(droppedQuestion(f, f.parts[0])).toBe(8);
    });
});

describe("partAnswer", () => {
    it("is the user's answer the part's from names, from the entry that went into it", () => {
        const f = overreach();
        const said = partAnswer(f, f.parts[1]);
        expect(said).toEqual({ n: 11, text: "Dark, like the spike" });
        expect(answerLine(said!)).toBe("answer 11: “Dark, like the spike”");
    });

    it("reads a picked option as its label when a is empty", () => {
        const f = file({
            parts: [part("p", "yours", { from: "answer 2" })],
            history: [
                {
                    kind: "question",
                    n: 2,
                    q: "q",
                    a: "",
                    into: ["p"],
                    options: [
                        { label: "One", detail: "" },
                        { label: "Two", detail: "" },
                    ],
                    picked: 1,
                },
            ],
        });
        expect(partAnswer(f, f.parts[0])).toEqual({ n: 2, text: "Two" });
    });

    it("is none for a from that names no answer, or an answer that did not go into the part", () => {
        const f = overreach();
        for (const from of ["mockup", "recon", "your call", undefined]) {
            expect(partAnswer(f, { ...f.parts[1], from })).toBeNull();
        }
        expect(partAnswer(f, { ...f.parts[1], from: "answer 12" })).toBeNull();
        expect(partAnswer(f, { ...f.parts[1], id: "other" })).toBeNull();
        // a dropped question has no answer to quote
        expect(partAnswer(f, { ...f.parts[0], from: "answer 8" })).toBeNull();
    });

    it("reads a from with more after the number", () => {
        const f = overreach();
        expect(partAnswer(f, { ...f.parts[1], from: "your answer 11, with the board" })?.n).toBe(11);
    });

    it("puts the answer on a review row in place of the from it names, and keeps a why", () => {
        const f = overreach();
        const look = (over: Partial<BrainstormPart>) => {
            const g = { ...f, parts: [{ ...f.parts[1], state: "guess" as const, ...over }] };
            return checkReview(g).fresh[0];
        };
        expect([look({}).cause, look({}).said]).toEqual(["", { n: 11, text: "Dark, like the spike" }]);
        expect(look({ why: "builder question 1" }).cause).toBe("builder question 1");
        expect(look({ from: "mockup" })).toMatchObject({ cause: "mockup" });
        expect(look({ from: "mockup" }).said).toBeUndefined();
    });
});

describe("unseenSince", () => {
    const recon = (q: string, a: string): HistoryEntry => ({ kind: "recon", q, a, into: [] });
    const asked: HistoryEntry = { kind: "question", n: 1, q: "q1", a: "a1", into: ["a"] };
    const before = file({
        question: { n: 2, text: "q2", part: "a" },
        parts: [part("a", "guess", { body: "A." }), part("n1", "yours", { kind: "note", gist: "Old.", body: "Old." })],
        history: [asked, recon("You asked: why?", "Because.")],
    });

    it("finds nothing before the pane's first read, and nothing in the file it saw", () => {
        expect(unseenSince(before, null)).toEqual({ parts: [], notes: [], recon: [] });
        expect(unseenSince(before, seenMark(before))).toEqual({ parts: [], notes: [], recon: [] });
    });

    it("marks the notes and recon the agent added while the question stayed open", () => {
        const after: BrainstormFile = {
            ...before,
            parts: [
                ...before.parts,
                part("n2", "yours", { kind: "note", gist: "Trend: X.", body: "X." }),
                part("n3", "yours", { kind: "note", gist: "Trend: Y.", body: "Y." }),
            ],
            history: [...before.history, recon("You asked: research current trends", "Two trends.")],
        };
        expect(unseenSince(after, seenMark(before))).toEqual({ parts: ["n2", "n3"], notes: ["n2", "n3"], recon: [2] });
    });

    it("marks a part whose text changed, not one whose state alone did", () => {
        const after: BrainstormFile = {
            ...before,
            parts: [
                part("a", "yours", { body: "A." }),
                part("n1", "yours", { kind: "note", gist: "New.", body: "Old." }),
            ],
        };
        expect(unseenSince(after, seenMark(before))).toEqual({ parts: ["n1"], notes: ["n1"], recon: [] });
    });

    it("lists a changed decision among the parts but not the notes", () => {
        const after: BrainstormFile = { ...before, parts: [part("a", "guess", { body: "B." }), before.parts[1]] };
        expect(unseenSince(after, seenMark(before))).toEqual({ parts: ["a"], notes: [], recon: [] });
    });

    it("historyRows marks only the unseen recon rows", () => {
        const after: BrainstormFile = { ...before, history: [...before.history, recon("You asked: more", "More.")] };
        const rows = historyRows(after, unseenSince(after, seenMark(before)));
        expect(rows.map((r) => [r.label, r.unseen])).toEqual([
            ["Recon", false],
            ["Recon", true],
            ["Q1", false],
        ]);
        expect(historyRows(after).every((r) => !r.unseen)).toBe(true);
    });
});

describe("a judged question", () => {
    const listed = (n: number) =>
        Array.from({ length: n }, (_, i) => ({
            name: `Approach ${i + 1}`,
            description: `d${i + 1}`,
            facts: [`f${i + 1}`],
        }));
    const DROPPED = [
        { name: "Refuse a send back to a sender whose request is still open", reason: "misses longer cycles." },
        { name: "Human approval for chained sends", reason: "stalls automation on a human." },
        { name: "Prompt wording plus docs only", reason: "enforces nothing." },
    ];
    const question = (over: Partial<BrainstormQuestion> = {}): BrainstormQuestion => ({
        n: 4,
        text: "How should loops be stopped?",
        part: "guard",
        approaches: listed(7),
        judge: { kind: "weighed", added: [], dropped: DROPPED },
        ...over,
    });
    const opts = [
        { label: "One hop", detail: "d1", pick: true },
        { label: "Inbox", detail: "d2" },
    ];

    it("parses the approaches and a weighed judge on the question and on a history entry", () => {
        const r = parseBrainstorm(
            raw({
                question: {
                    n: 4,
                    text: "Q",
                    approaches: [
                        { name: "One", description: "d", facts: ["f1", "", 3] },
                        { name: " ", description: "nameless, not counted" },
                        { description: "no name" },
                        { name: "Two" },
                    ],
                    judge: { added: ["Two", ""], dropped: [{ name: "Three", reason: "slow" }, { reason: "no name" }] },
                },
                history: [
                    {
                        kind: "question",
                        n: 3,
                        q: "q",
                        a: "One hop",
                        into: [],
                        options: opts,
                        picked: 0,
                        judge: { added: [] },
                    },
                ],
            })
        );
        expect(r.ok && r.file.question).toEqual({
            n: 4,
            text: "Q",
            part: "",
            approaches: [
                { name: "One", description: "d", facts: ["f1"] },
                { name: "Two", description: "", facts: [] },
            ],
            judge: { kind: "weighed", added: ["Two"], dropped: [{ name: "Three", reason: "slow" }] },
        });
        expect(r.ok && r.file.history[0].judge).toEqual({ kind: "weighed", added: [], dropped: [] });
    });

    it("parses a failed judge", () => {
        const r = parseBrainstorm(
            raw({ question: { n: 1, text: "Q", read: "r", options: opts, judge: { failed: "x" } } })
        );
        expect(r.ok && r.file.question?.judge).toEqual({ kind: "failed", reason: "x" });
    });

    it("reads a judge of the wrong shape as no record, and the rest of the question as it reads without one", () => {
        const q = { n: 1, text: "Q", part: "a", read: "r", options: opts };
        const h = { kind: "question", n: 1, q: "q", a: "One hop", into: [], options: opts, picked: 0 };
        const plain = parseBrainstorm(raw({ question: q, history: [h] }));
        expect(plain.ok && plain.file.question).toEqual(q);
        expect(plain.ok && "judge" in plain.file.history[0]).toBe(false);
        for (const judge of ["x", {}, { added: 3 }, { added: [], dropped: "none" }, { failed: "" }, null]) {
            const r = parseBrainstorm(raw({ question: { ...q, judge }, history: [{ ...h, judge }] }));
            expect(r.ok && r.file.question).toEqual(q);
            expect(r.ok && r.file.history).toEqual(plain.ok && plain.file.history);
        }
    });

    it("judgeWork says how many the agent listed, what the judge added, and how many it dropped", () => {
        expect(judgeWork(question())).toEqual({
            line: "weighed the 7 approaches the agent listed, added none, dropped 3.",
            judged: true,
            dropped: DROPPED,
        });
        const added = (names: string[]) =>
            judgeWork(question({ judge: { kind: "weighed", added: names, dropped: DROPPED } }))?.line;
        expect(added(["A"])).toBe("weighed the 7 approaches the agent listed, added A, dropped 3.");
        expect(added(["A", "B"])).toBe("weighed the 7 approaches the agent listed, added A and B, dropped 3.");
        expect(added(["A", "B", "C"])).toBe("weighed the 7 approaches the agent listed, added A, B and C, dropped 3.");
    });

    it("judgeWork with nothing dropped says dropped none, and with no list still reads as a sentence", () => {
        const none = judgeWork(question({ judge: { kind: "weighed", added: ["A"], dropped: [] } }));
        expect(none).toEqual({
            line: "weighed the 7 approaches the agent listed, added A, dropped none.",
            judged: true,
            dropped: [],
        });
        expect(judgeWork(question({ approaches: undefined }))?.line).toBe(
            "weighed the approaches the agent listed, added none, dropped 3."
        );
    });

    it("judgeWork on a failed judge says the read and pick are the agent's, and why", () => {
        expect(
            judgeWork(question({ judge: { kind: "failed", reason: "Arc restarted before the judge started." } }))
        ).toEqual({
            line: "the judge failed, so the read and pick are the agent’s: Arc restarted before the judge started.",
            judged: false,
            dropped: [],
        });
    });

    it("judgeWork is null without a judge record", () => {
        expect(judgeWork(question({ judge: undefined }))).toBeNull();
    });

    it("marks a history row judged only when its entry's judge weighed it", () => {
        const entry = (judge?: HistoryEntry["judge"]): HistoryEntry => ({
            kind: "question",
            n: 1,
            q: "q",
            a: "One hop",
            into: [],
            options: opts,
            picked: 0,
            ...(judge ? { judge } : {}),
        });
        const rows = historyRows(
            file({
                history: [
                    entry({ kind: "weighed", added: [], dropped: DROPPED }),
                    entry(),
                    entry({ kind: "failed", reason: "x" }),
                ],
            })
        );
        expect(rows.map((r) => r.judged)).toEqual([true, false, false]);
    });
});

describe("the builder check's wait", () => {
    const READING = { kind: "pending", stage: "reading", text: "A builder is reading the design." } as const;
    const TAKING_IN = { kind: "pending", stage: "taking-in", text: "Taking in the builder's questions." } as const;
    const rec = (state: BuilderCheckRecord["state"], ts = 1000): BuilderCheckRecord => ({ state, ts, runId: "r1" });
    // the five checks the spec measured: usual 2:09, longest 8:28
    const TIMES = { usualms: 129_000, longestms: 508_000 };

    it("keeps the design in the main area while the check is pending and the agent writes nothing", () => {
        expect(mainView(file({ done: true, parts: [part("a", "yours")] }), false)).toBe("design");
        expect(mainView(file({ working: "Sorting the builder's questions." }), false)).toBe("working");
    });

    it("locks the design's edits while the agent writes or a check is pending, taking in included", () => {
        expect(editLock(file(), { kind: "none" })).toBeNull();
        expect(editLock(file(), { kind: "failed", reason: "x" })).toBeNull();
        expect(editLock(file(), READING)).toBe("check");
        expect(editLock(file(), TAKING_IN)).toBe("check");
        expect(editLock(file({ working: "w" }), READING)).toBe("working");
    });

    it("times a reading check from its run, else from its record, and a finished one only from its run", () => {
        expect(checkSpan(rec("reading"), null)).toEqual({ start: 1000, end: null });
        expect(checkSpan(rec("reading"), { createdts: 1200 })).toEqual({ start: 1200, end: null });
        expect(checkSpan(rec("answered", 152_000), { createdts: 1200, completedts: 152_200 })).toEqual({
            start: 1200,
            end: 152_200,
        });
        // the answered record's time is when the builder finished, not when it started
        expect(checkSpan(rec("answered", 152_000), null)).toBeNull();
        expect(checkSpan(rec("answered"), { createdts: 1200 })).toBeNull();
        expect(checkSpan(rec("failed"), { createdts: 1200, completedts: 9000 })).toBeNull();
        expect(checkSpan(undefined, null)).toBeNull();
    });

    it("reads m:ss", () => {
        expect(clockText(0)).toBe("0:00");
        expect(clockText(102_999)).toBe("1:42");
        expect(clockText(508_000)).toBe("8:28");
        expect(clockText(-5)).toBe("0:00");
    });

    it("counts a reading check against the usual time, with the bar running to the longest", () => {
        const c = checkClock(READING, { start: 0, end: null }, TIMES, 102_000);
        expect(c).toEqual({
            line: "A builder is reading the design.",
            elapsed: "1:42",
            running: true,
            bar: { fill: 102_000 / 508_000, usual: 129_000 / 508_000 },
            note: "Checks here usually take about 2 minutes. You can read the design meanwhile.",
            over: false,
            times: "usual 2:09 · longest 8:28",
        });
    });

    it("says plainly when the check runs past the usual time, and the bar stays full past the longest", () => {
        const over = checkClock(READING, { start: 0, end: null }, TIMES, 370_000);
        expect(over.elapsed).toBe("6:10");
        expect(over.note).toBe("Taking longer than usual: most checks here finish in about 2 minutes.");
        expect(over.over).toBe(true);
        expect(checkClock(READING, { start: 0, end: null }, TIMES, 900_000).bar.fill).toBe(1);
    });

    it("rounds a short usual time to under a minute", () => {
        const c = checkClock(READING, { start: 0, end: null }, { usualms: 20_000, longestms: 40_000 }, 5000);
        expect(c.note).toBe("Checks here usually take under a minute. You can read the design meanwhile.");
    });

    it("shows the clock alone before the first past check", () => {
        const c = checkClock(READING, { start: 0, end: null }, { usualms: 0, longestms: 0 }, 65_000);
        expect(c).toMatchObject({
            elapsed: "1:05",
            bar: null,
            times: null,
            note: "You can read the design meanwhile.",
        });
        expect(checkClock(READING, { start: 0, end: null }, null, 65_000).bar).toBeNull();
    });

    it("stops the clock at the builder's time while the agent takes in its questions", () => {
        const c = checkClock(TAKING_IN, { start: 0, end: 151_000 }, TIMES, 999_000);
        expect(c).toMatchObject({
            line: "Taking in the builder's questions.",
            elapsed: "2:31",
            running: false,
            bar: { fill: 151_000 / 508_000, usual: 129_000 / 508_000 },
            note: "The builder finished in 2:31. The agent is sorting its questions into yours, its calls and what the design already answers.",
            over: false,
            times: "usual 2:09 · longest 8:28",
        });
    });

    it("leaves the time out while a finished check's run is unknown", () => {
        const c = checkClock(TAKING_IN, null, TIMES, 999_000);
        expect(c.elapsed).toBeNull();
        expect(c.bar).toBeNull();
        expect(c.note).toBe(
            "The builder finished. The agent is sorting its questions into yours, its calls and what the design already answers."
        );
    });
});
