// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import type { AskQuestionDetail } from "./agentsviewmodel";
import { askAnswered, askHead, askView } from "./chatask";

const q = (extra: Partial<AskQuestionDetail> = {}): AskQuestionDetail => ({
    question: "Keep Tidy?",
    header: "Tidy",
    options: [
        { label: "Keep Tidy", description: "the new button only lays out the split" },
        { label: "Drop Tidy", description: "remove it and the dagre layout" },
    ],
    picked: [],
    ...extra,
});

describe("askView", () => {
    it("puts the picked option with its description first and the rest as passed over", () => {
        expect(askView(q({ picked: ["Drop Tidy"] }))).toEqual({
            header: "Tidy",
            question: "Keep Tidy?",
            answers: [{ label: "Drop Tidy", description: "remove it and the dagre layout" }],
            passed: ["Keep Tidy"],
        });
    });

    it("shows words typed under Other as an answer of their own, every option passed over", () => {
        const v = askView(q({ typed: "  only on a split, in its header  " }));
        expect(v.answers).toEqual([{ label: "only on a split, in its header", typed: true }]);
        expect(v.passed).toEqual(["Keep Tidy", "Drop Tidy"]);
    });

    it("keeps every pick of a multi-select in the agent's order, then the typed words", () => {
        const v = askView(q({ picked: ["Keep Tidy", "Drop Tidy"], typed: "both?" }));
        expect(v.answers.map((a) => a.label)).toEqual(["Keep Tidy", "Drop Tidy", "both?"]);
        expect(v.passed).toEqual([]);
    });

    it("keeps a picked label the options do not hold, with no description", () => {
        expect(askView(q({ picked: ["Something else"] })).answers).toEqual([{ label: "Something else" }]);
    });

    it("has no answers for an unanswered question, and leaves out a blank header", () => {
        const v = askView(q({ header: "  " }));
        expect(v.answers).toEqual([]);
        expect(v).not.toHaveProperty("header");
    });
});

describe("askAnswered", () => {
    it("is true once any question has a pick or typed words", () => {
        expect(askAnswered([q(), q({ picked: ["Keep Tidy"] })])).toBe(true);
        expect(askAnswered([q({ typed: "x" })])).toBe(true);
        expect(askAnswered([q(), q({ typed: "   " })])).toBe(false);
        expect(askAnswered([])).toBe(false);
    });
});

describe("askHead", () => {
    it("is the one question's header, Question without one, or the count of several", () => {
        expect(askHead([q()])).toBe("Tidy");
        expect(askHead([q({ header: undefined })])).toBe("Question");
        expect(askHead([q(), q()])).toBe("2 questions");
    });
});
