// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { globalStore } from "@/app/store/jotaiStore";
import { beforeEach, describe, expect, it } from "vitest";
import type { AgentAskQuestion } from "./agentsviewmodel";
import {
    answerWhileAsleepPlaceholder,
    dropHeldAnswer,
    getHeldAnswerAtom,
    heldCleared,
    heldFor,
    heldLines,
    heldLineText,
    heldShown,
    keepHeldAnswer,
    mergeHeld,
    wakesLine,
    type HeldAnswer,
} from "./sleepheld";

const SINCE = 1_700_000_000_000;
const ASLEEP = { since: SINCE, freedBytes: 0, asking: true };

const questions: AgentAskQuestion[] = [
    { question: "Guard the nil case?", options: [{ label: "Yes" }, { label: "No" }] },
    { question: "Which files?", multiSelect: true, options: [{ label: "a.ts" }, { label: "b.ts" }, { label: "c.ts" }] },
];

describe("heldLines", () => {
    it("reads each answered question as the option labels picked", () => {
        expect(heldLines(questions, [{ selectedindexes: [1] }, { selectedindexes: [0, 2] }])).toEqual([
            { question: "Guard the nil case?", answers: ["No"] },
            { question: "Which files?", answers: ["a.ts", "c.ts"] },
        ]);
    });

    it("reads typed text as the answer, over any option (the server holds the same words)", () => {
        expect(heldLines(questions.slice(0, 1), [{ text: "only on the hot path" }])).toEqual([
            { question: "Guard the nil case?", answers: ["only on the hot path"] },
        ]);
        expect(heldLines(questions.slice(0, 1), [{ text: "go", selectedindexes: [0] }])[0].answers).toEqual(["go"]);
    });

    it("skips an option index the question does not have and a question with no answer sent", () => {
        expect(heldLines(questions, [{ selectedindexes: [7] }])).toEqual([
            { question: "Guard the nil case?", answers: [] },
        ]);
    });
});

describe("heldLineText", () => {
    it("is the question, an arrow and what was answered, as the agent's nudge writes it", () => {
        expect(heldLineText({ question: "Guard the nil case?", answers: ["Yes"] })).toBe("Guard the nil case? → Yes");
        expect(heldLineText({ question: "Which files?", answers: ["a.ts", "c.ts"] })).toBe("Which files? → a.ts, c.ts");
    });

    it("puts the question on one line, and shows the question alone when no answer was read", () => {
        expect(heldLineText({ question: "Guard\n  the nil   case?", answers: ["Yes"] })).toBe(
            "Guard the nil case? → Yes"
        );
        expect(heldLineText({ question: "Ship it?", answers: [] })).toBe("Ship it?");
    });
});

describe("wakesLine", () => {
    it("names the agent whose wake carries the answer", () => {
        expect(wakesLine("loom")).toBe("Goes in when loom wakes");
    });
});

describe("answerWhileAsleepPlaceholder", () => {
    it("says the typed words answer the question and the agent reads them on waking, not that they wake it", () => {
        const text = answerWhileAsleepPlaceholder("loom");
        expect(text).toContain("answer loom's question");
        expect(text).toContain("when it wakes");
        expect(text).not.toContain("to wake it");
    });
});

describe("heldFor", () => {
    const lines = [{ selectedindexes: [0] }, { selectedindexes: [1] }];
    const ask = { askId: "ask-1", questions };

    it("is the answer kept for the sleep, for a sleeping agent whose ask was kept", () => {
        expect(heldFor({ sleeping: ASLEEP, ask }, lines)).toEqual({
            since: SINCE,
            lines: [
                { question: "Guard the nil case?", answers: ["Yes"] },
                { question: "Which files?", answers: ["b.ts"] },
            ],
        });
    });

    it("is null for an awake agent, an unmarked sleeper (its ask is dropped, nothing holds the answer) and a held card", () => {
        expect(heldFor({ sleeping: undefined, ask }, lines)).toBeNull();
        expect(heldFor({ sleeping: { since: SINCE, freedBytes: 0 }, ask }, lines)).toBeNull();
        expect(heldFor({ sleeping: ASLEEP, ask: undefined }, lines)).toBeNull();
    });
});

describe("mergeHeld", () => {
    const first: HeldAnswer = { since: SINCE, lines: [{ question: "A?", answers: ["1"] }] };

    it("starts from nothing", () => {
        expect(mergeHeld(null, first)).toEqual(first);
    });

    it("adds a second answer of the same sleep after the first", () => {
        const next: HeldAnswer = { since: SINCE, lines: [{ question: "B?", answers: ["2"] }] };
        expect(mergeHeld(first, next).lines.map((l) => l.question)).toEqual(["A?", "B?"]);
    });

    it("lets a later sleep's answer replace what an earlier sleep held", () => {
        const next: HeldAnswer = { since: SINCE + 5_000, lines: [{ question: "B?", answers: ["2"] }] };
        expect(mergeHeld(first, next)).toEqual(next);
    });
});

describe("heldShown and heldCleared", () => {
    const held: HeldAnswer = { since: SINCE, lines: [{ question: "A?", answers: ["1"] }] };

    it("shows the kept answer while the agent is still in the sleep it was given in", () => {
        expect(heldShown(held, ASLEEP)).toBe(held);
        expect(heldCleared(held, ASLEEP)).toBe(false);
    });

    it("drops it once the agent is awake: it went in with the wake", () => {
        expect(heldShown(held, undefined)).toBeNull();
        expect(heldCleared(held, undefined)).toBe(true);
    });

    it("drops it for a later sleep, which has not been given that answer", () => {
        const later = { since: SINCE + 60_000, freedBytes: 0, asking: true };
        expect(heldShown(held, later)).toBeNull();
        expect(heldCleared(held, later)).toBe(true);
    });

    it("has nothing to clear or show for no answer", () => {
        expect(heldShown(null, ASLEEP)).toBeNull();
        expect(heldCleared(null, undefined)).toBe(false);
    });
});

describe("the per-block store", () => {
    beforeEach(() => dropHeldAnswer("block:b1"));

    it("keeps an answer per block, merges a second of the same sleep, and drops it", () => {
        const atom = getHeldAnswerAtom("block:b1");
        expect(globalStore.get(atom)).toBeNull();
        keepHeldAnswer("block:b1", { since: SINCE, lines: [{ question: "A?", answers: ["1"] }] });
        keepHeldAnswer("block:b1", { since: SINCE, lines: [{ question: "B?", answers: ["2"] }] });
        expect(globalStore.get(atom)?.lines.map((l) => l.question)).toEqual(["A?", "B?"]);
        expect(globalStore.get(getHeldAnswerAtom("block:other"))).toBeNull();
        dropHeldAnswer("block:b1");
        expect(globalStore.get(atom)).toBeNull();
    });

    it("is one atom per block, so a surface switch finds the answer again", () => {
        expect(getHeldAnswerAtom("block:b1")).toBe(getHeldAnswerAtom("block:b1"));
    });
});
