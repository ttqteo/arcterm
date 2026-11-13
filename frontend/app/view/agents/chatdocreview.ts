// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The Doc review card in Chat, the pure model (docs/superpowers/specs/2026-11-14-chat-council-design.md): recognizing
// the AskUserQuestion a worker asks when it finishes a section of a paper or a note, the card's fields, and the row an
// answered one folds into. The card (chatdocreviewcard.tsx) draws; the dock and the conversation place it. The
// convention itself is docreview.ts's `parseDocReview`.

import type { AgentAskOption, AgentAskQuestion, AskQuestionDetail } from "./agentsviewmodel";
import { relativeToProject } from "./councilsetupmodel";
import { parseDocReview, type DocReview } from "./docreview";

/** Pure: whether an AskUserQuestion is a Doc review Chat draws as a card: `parseDocReview` reads it as one (exactly one
 *  question, headed `Doc review`, whose first line is a `.md` or `.tex` path). Structural, as `isHandoffAsk` is: the dock
 *  passes the live ask's questions and the transcript an answered ask's (`AskQuestionDetail[]`). Any other ask with that
 *  header stays an ordinary question. */
export function isDocReviewAsk(questions: readonly AgentAskQuestion[] | undefined): boolean {
    return parseDocReview(questions != null ? { questions } : undefined)?.kind === "doc";
}

/** The question of a Doc review as the card and the row read it, structurally: the dock passes the live ask's
 *  `AgentAskQuestion`, the conversation an answered ask's `AskQuestionDetail`. */
export type DocReviewQuestion = { question: string; header?: string; options?: AgentAskOption[] };

// what `parseDocReview` reads out of one question when it is a Doc review (not a Spec or Plan review)
function docReviewOf(q: DocReviewQuestion): DocReview | null {
    const review = parseDocReview({ questions: [q] });
    return review?.kind === "doc" ? review : null;
}

const fileName = (path: string): string => path.split(/[\\/]/).pop() ?? path;

/** One "worth a look" line: `§3.2 Method overview: rewritten` is `where` `§3.2 Method overview` and `what` `rewritten`, so
 *  the card can set the place in its stronger face as the board does. A line with no `: ` (a colon in a URL is not one)
 *  is `what` alone. */
export type DocReviewLook = { where?: string; what: string };

function lookOf(item: string): DocReviewLook {
    const at = item.indexOf(": ");
    return at > 0 ? { where: item.slice(0, at).trim(), what: item.slice(at + 2).trim() } : { what: item };
}

export type DocReviewFields = {
    /** the file as the card draws it: relative to the agent's folder when it sits under it, else as the agent wrote it */
    path: string;
    /** the path as the agent wrote it, the card's tooltip */
    fullPath: string;
    /** the lines between the path and the first item, in the order written */
    intro: string[];
    /** the ask's `Pages: N` line, left out when it gives none */
    pages?: number;
    items: DocReviewLook[];
    /** the index of the agent's own Approve option, which the card's Approve answers; null when it offered none */
    approveIndex: number | null;
};

/** Pure: the card's fields from a Doc review's question, `parseDocReview`'s reading of it; null when the question is
 *  not a Doc review of a `.md` or `.tex` file. `folder` is the agent's working directory, when known. */
export function docReviewFields(q: DocReviewQuestion, folder?: string): DocReviewFields | null {
    const review = docReviewOf(q);
    if (review == null) {
        return null;
    }
    const fields: DocReviewFields = {
        path: relativeToProject(folder ?? "", review.path),
        fullPath: review.path,
        intro: review.intro,
        items: review.items.map(lookOf),
        approveIndex: review.approveIndex >= 0 ? review.approveIndex : null,
    };
    if (review.pageLimit != null) {
        fields.pages = review.pageLimit;
    }
    return fields;
}

export type DocReviewRow = {
    outcome: "approved" | "changes";
    /** the comments a Request changes answer carries; 0 for Approve and for words typed in the box */
    comments: number;
    file: string;
};

// A label as the options are matched: the (Recommended) marker dropped (the agent appends it to the label, as
// docreview.ts reads it), case ignored.
const labelKey = (label: string): string =>
    label
        .replace(/\s*\(recommended\)\s*/gi, " ")
        .trim()
        .toLowerCase();

// formatRequest (proseanchor.ts) writes each comment as a line that starts `N. [<section> ¶<paragraph>]`
const COMMENT_LINE = /^\d+\. \[/gm;

/** Pure: what an answered Doc review folds into. `approved` when the picked label is the ask's approve option, else
 *  `changes` (the Request changes option, or words typed in the box), with its comments counted from the answer's
 *  numbered lines. `file` is the path relative to the agent's folder when it sits under it, else the file's name alone,
 *  since the row is one line cut short at its end. Null when the question is not a Doc review. The caller draws a row
 *  only once the question is answered (`picked` or `typed`). */
export function docReviewRow(q: AskQuestionDetail, folder?: string): DocReviewRow | null {
    const review = docReviewOf(q);
    if (review == null) {
        return null;
    }
    const approve = q.options[review.approveIndex]?.label;
    const approved = approve != null && q.picked.some((p) => labelKey(p) === labelKey(approve));
    const shown = relativeToProject(folder ?? "", review.path);
    return {
        outcome: approved ? "approved" : "changes",
        comments: approved ? 0 : (q.typed?.match(COMMENT_LINE)?.length ?? 0),
        file: shown === review.path ? fileName(review.path) : shown,
    };
}

/** Pure: the folded row's text, `Doc review · approved · sections/method.tex` or
 *  `Doc review · changes requested · 3 comments · sections/method.tex` (the count left out at zero). The mark before it
 *  is the card's: ✓ for approved, ↺ for changes. */
export function docReviewDoneLine(row: DocReviewRow): string {
    const parts = ["Doc review", row.outcome === "approved" ? "approved" : "changes requested"];
    if (row.outcome === "changes" && row.comments > 0) {
        parts.push(`${row.comments} comment${row.comments === 1 ? "" : "s"}`);
    }
    parts.push(row.file);
    return parts.join(" · ");
}
