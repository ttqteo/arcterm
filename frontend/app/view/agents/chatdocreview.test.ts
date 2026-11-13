// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import type { AskQuestionDetail } from "./agentsviewmodel";
import { docReviewDoneLine, docReviewFields, docReviewRow, isDocReviewAsk } from "./chatdocreview";
import { formatRequest, type ProseComment } from "./proseanchor";

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

const card = (question: string, options = OPTIONS, header = "Doc review") => ({ question, header, options });

describe("docReviewFields", () => {
    const BOARD = [
        "C:/r/paper/sections/method.tex",
        "Rewrote the method overview and aligned Table 3 with §5.1.",
        "Pages: 12",
        "- §3.2 Method overview: rewritten",
        "- §5.1 ¶1: 17/29 now matches Table 3",
        "- the bibliography was regenerated",
    ].join("\n");

    it("reads the path, the intro, the page count and the things worth a look", () => {
        expect(docReviewFields(card(BOARD))).toEqual({
            path: "C:/r/paper/sections/method.tex",
            fullPath: "C:/r/paper/sections/method.tex",
            intro: ["Rewrote the method overview and aligned Table 3 with §5.1."],
            pages: 12,
            items: [
                { where: "§3.2 Method overview", what: "rewritten" },
                { where: "§5.1 ¶1", what: "17/29 now matches Table 3" },
                { what: "the bibliography was regenerated" },
            ],
            approveIndex: 0,
        });
    });

    it("shows a path under the agent's folder relative to it, one outside it as given", () => {
        expect(docReviewFields(card(BOARD), "C:\\r\\paper")?.path).toBe("sections/method.tex");
        expect(docReviewFields(card(BOARD), "c:/r/paper/")?.path).toBe("sections/method.tex");
        expect(docReviewFields(card(BOARD), "D:/elsewhere")?.path).toBe("C:/r/paper/sections/method.tex");
        expect(docReviewFields(card(BOARD))?.path).toBe("C:/r/paper/sections/method.tex");
        // the full path stays whole for the tooltip
        expect(docReviewFields(card(BOARD), "C:/r/paper")?.fullPath).toBe("C:/r/paper/sections/method.tex");
    });

    it("leaves the page count out when the ask gives none, and the list empty when it names no items", () => {
        const f = docReviewFields(card("/r/notes/ideas.md\nThe second list is new."));
        expect(f).toEqual({
            path: "/r/notes/ideas.md",
            fullPath: "/r/notes/ideas.md",
            intro: ["The second list is new."],
            items: [],
            approveIndex: 0,
        });
        expect(f != null && "pages" in f).toBe(false);
    });

    it("keeps every intro line, and splits an item only at its first `: `", () => {
        const f = docReviewFields(
            card("/r/p/a.tex\nFirst line.\nSecond line.\n- see https://x.org/a: the link\n- Table 2: now 3: not 2")
        );
        expect(f?.intro).toEqual(["First line.", "Second line."]);
        expect(f?.items).toEqual([
            { where: "see https://x.org/a", what: "the link" },
            { where: "Table 2", what: "now 3: not 2" },
        ]);
    });

    it("finds the approve option wherever the agent put it, and none when it offered none", () => {
        const ask = "/r/p/a.tex";
        expect(
            docReviewFields(card(ask, [{ label: "Request changes" }, { label: "Approve (Recommended)" }]))?.approveIndex
        ).toBe(1);
        expect(docReviewFields(card(ask, [{ label: "Request changes" }]))?.approveIndex).toBeNull();
        expect(docReviewFields(card(ask, []))?.approveIndex).toBeNull();
    });

    it("is null for anything that is not a Doc review of a paper or a note", () => {
        expect(docReviewFields(card("/r/specs/x-design.md", OPTIONS, "Spec review"))).toBeNull();
        expect(docReviewFields(card("Please look at the intro", OPTIONS))).toBeNull();
        expect(docReviewFields(card("/r/p/a.tex", OPTIONS, "Handoff"))).toBeNull();
    });
});

const answered = (over: Partial<AskQuestionDetail>): AskQuestionDetail => ({
    question: "C:/r/paper/sections/method.tex\nRewrote it.\n- §3.2: rewritten",
    header: "Doc review",
    options: OPTIONS,
    picked: [],
    ...over,
});

// a saved comment as the review view makes it, so the row counts the answer formatRequest really writes
const proseComment = (n: number): ProseComment => ({
    id: `c${n}`,
    sectionIndex: n,
    sectionLabel: `§${n}`,
    paragraph: 1,
    sentences: [0, 0],
    quote: `quote ${n}`,
    selectedText: `quote ${n}`,
    note: `note ${n}`,
    draft: false,
});

describe("docReviewRow", () => {
    it("reads Approve as approved, with no comments", () => {
        expect(docReviewRow(answered({ picked: ["Approve"] }))).toEqual({
            outcome: "approved",
            comments: 0,
            file: "method.tex",
        });
    });

    it("reads the approve option however the agent wrote its label, or ordered its options", () => {
        expect(docReviewRow(answered({ picked: ["approve (Recommended)"] }))?.outcome).toBe("approved");
        const reordered = answered({
            options: [{ label: "Request changes" }, { label: "Approve" }],
            picked: ["Approve"],
        });
        expect(docReviewRow(reordered)?.outcome).toBe("approved");
    });

    it("counts the comments of a Request changes answer formatRequest wrote", () => {
        const typed = formatRequest(
            [proseComment(1), proseComment(2), proseComment(3)],
            "§3 still reads like a tutorial."
        );
        expect(docReviewRow(answered({ picked: ["Request changes"], typed }))).toEqual({
            outcome: "changes",
            comments: 3,
            file: "method.tex",
        });
        // the answer is typed text alone, as the review view sends it
        expect(docReviewRow(answered({ typed }))?.comments).toBe(3);
    });

    it("counts an edit suggestion as one comment, and a general note alone as none", () => {
        const edit: ProseComment = { ...proseComment(1), suggestion: { from: "a b", to: "a c", old: "b", new: "c" } };
        const typed = formatRequest([edit, proseComment(2)], "");
        expect(docReviewRow(answered({ typed }))?.comments).toBe(2);
        expect(docReviewRow(answered({ typed: formatRequest([], "Cut §4 by half.") }))).toMatchObject({
            outcome: "changes",
            comments: 0,
        });
    });

    it("reads a free typed answer as changes requested, with no count", () => {
        expect(docReviewRow(answered({ typed: "Looks fine but shorten the intro" }))).toEqual({
            outcome: "changes",
            comments: 0,
            file: "method.tex",
        });
        expect(docReviewRow(answered({ picked: ["Request changes"] }))).toMatchObject({
            outcome: "changes",
            comments: 0,
        });
    });

    it("names the file relative to the agent's folder when it sits under it, else by its name", () => {
        expect(docReviewRow(answered({ picked: ["Approve"] }), "C:/r/paper")?.file).toBe("sections/method.tex");
        expect(docReviewRow(answered({ picked: ["Approve"] }), "D:/elsewhere")?.file).toBe("method.tex");
        const other = answered({ question: "/home/u/notes\\ideas.md", picked: ["Approve"] });
        expect(docReviewRow(other)?.file).toBe("ideas.md");
    });

    it("is null for an ask that is not a Doc review", () => {
        expect(docReviewRow(answered({ header: "Scope", picked: ["Approve"] }))).toBeNull();
        expect(docReviewRow(answered({ question: "no path here", picked: ["Approve"] }))).toBeNull();
    });
});

describe("docReviewDoneLine", () => {
    it("is the row as the board draws it", () => {
        expect(docReviewDoneLine({ outcome: "approved", comments: 0, file: "sections/method.tex" })).toBe(
            "Doc review · approved · sections/method.tex"
        );
        expect(docReviewDoneLine({ outcome: "changes", comments: 3, file: "sections/method.tex" })).toBe(
            "Doc review · changes requested · 3 comments · sections/method.tex"
        );
    });

    it("says one comment in the singular and leaves the count out at zero", () => {
        expect(docReviewDoneLine({ outcome: "changes", comments: 1, file: "a.tex" })).toBe(
            "Doc review · changes requested · 1 comment · a.tex"
        );
        expect(docReviewDoneLine({ outcome: "changes", comments: 0, file: "a.tex" })).toBe(
            "Doc review · changes requested · a.tex"
        );
    });
});
