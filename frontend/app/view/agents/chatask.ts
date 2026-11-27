// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// An AskUserQuestion as Chat draws it once it is out of the tools around it (chatmodel.ts `ask` part): each question, what
// you answered (the options you picked, or the words you typed), and the options you passed over, so the decision reads
// at a glance instead of inside a folded tool line. Pure; chataskcard.tsx draws it.

import type { AskQuestionDetail } from "./agentsviewmodel";

/** One answer to a question: an option you picked (its description under it) or the words you typed. */
export type AskAnswer = { label: string; description?: string; typed?: true };

export type AskView = {
    header?: string;
    question: string;
    answers: AskAnswer[];
    // the options you did not pick, by label, in the agent's order
    passed: string[];
};

/** Pure: a question as the card draws it. A picked label the options do not hold still shows (the agent's text as the
 *  transcript kept it); words typed under "Other" come after the picked options. */
export function askView(q: AskQuestionDetail): AskView {
    const picked = new Set(q.picked);
    const answers: AskAnswer[] = q.picked.map((label) => {
        const option = q.options.find((o) => o.label === label);
        return option?.description ? { label, description: option.description } : { label };
    });
    const typed = q.typed?.trim();
    if (typed) {
        answers.push({ label: typed, typed: true });
    }
    const header = q.header?.trim();
    return {
        ...(header ? { header } : {}),
        question: q.question,
        answers,
        passed: q.options.filter((o) => !picked.has(o.label)).map((o) => o.label),
    };
}

/** Pure: whether any question of the ask got an answer. */
export function askAnswered(questions: readonly AskQuestionDetail[]): boolean {
    return questions.some((q) => q.picked.length > 0 || !!q.typed?.trim());
}

/** Pure: the card's head: the one question's header, or how many questions the ask held. */
export function askHead(questions: readonly AskQuestionDetail[]): string {
    if (questions.length > 1) {
        return `${questions.length} questions`;
    }
    return questions[0]?.header?.trim() || "Question";
}
