// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import type { AskQuestionDetail } from "./agentsviewmodel";
import { isDocReviewAsk } from "./chatdocreview";

const OPTIONS = [{ label: "Approve" }, { label: "Request changes" }];

const ask = (header: string, question: string, options = OPTIONS) => [{ question, header, options }];

describe("isDocReviewAsk", () => {
    it("is true for a Doc review of a LaTeX source", () => {
        expect(isDocReviewAsk(ask("Doc review", "C:/paper/sections/intro.tex\n- §2 tightened\nPages: 12"))).toBe(true);
    });

    it("is true for a Doc review of a markdown note", () => {
        expect(isDocReviewAsk(ask("Doc review", "docs/notes/2026-11-14-ideas.md\n- the second list is new"))).toBe(
            true
        );
    });

    it("reads the header's case and spacing, a backticked path and a path alone", () => {
        expect(isDocReviewAsk(ask(" doc Review ", "`/r/paper/main.tex`"))).toBe(true);
        expect(isDocReviewAsk(ask("DOC REVIEW", "/r/notes.md"))).toBe(true);
    });

    it("is false for a Spec review or a Plan review, even over a markdown file", () => {
        expect(isDocReviewAsk(ask("Spec review", "docs/superpowers/specs/x-design.md\n- a decision"))).toBe(false);
        expect(isDocReviewAsk(ask("Plan review", "docs/superpowers/plans/x.md\n- a fix"))).toBe(false);
    });

    it("is false for a Handoff and for any other header", () => {
        expect(isDocReviewAsk(ask("Handoff", "Plan saved to `docs/plans/p.md`. How to run it?"))).toBe(false);
        expect(isDocReviewAsk(ask("Scope", "paper/intro.tex"))).toBe(false);
        expect(isDocReviewAsk([{ question: "paper/intro.tex" }])).toBe(false);
    });

    it("is false for a Doc review whose first line is not a path it reads", () => {
        expect(isDocReviewAsk(ask("Doc review", "Please look at the intro section"))).toBe(false);
        expect(isDocReviewAsk(ask("Doc review", "notes/intro.txt\n- one"))).toBe(false);
        // a mockup board belongs to the Spec and Plan reviews
        expect(isDocReviewAsk(ask("Doc review", "C:/r/.superpowers/design/x/project/Main.dc.html"))).toBe(false);
        expect(isDocReviewAsk(ask("Doc review", ""))).toBe(false);
    });

    it("is false for no questions, or for more than one", () => {
        expect(isDocReviewAsk(undefined)).toBe(false);
        expect(isDocReviewAsk([])).toBe(false);
        expect(
            isDocReviewAsk([...ask("Doc review", "paper/intro.tex"), ...ask("Doc review", "paper/method.tex")])
        ).toBe(false);
    });

    it("takes the transcript's answered questions as the live ask's", () => {
        const answered: AskQuestionDetail[] = [
            {
                question: "paper/intro.tex\n- one",
                header: "Doc review",
                options: OPTIONS,
                picked: ["Request changes"],
                typed: "1. [intro] shorter",
            },
        ];
        expect(isDocReviewAsk(answered)).toBe(true);
    });
});
