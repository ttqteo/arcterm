// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// How the Cockpit's keyboard walks an ask of several questions: where a digit pick moves to, and what Enter does.
// Pure, so the rules are tested apart from the key handler (usecockpitkeyboard.ts).
//
// Only an ask of more than one question is walked. A single-question ask has nowhere to walk to, and the keys keep
// doing what they did: a digit toggles its option, and Enter sends an answered ask or else opens the agent
// (`openFocus`), so both functions answer "not walked" for it.

import { canSubmitAsk, nextUnansweredQuestion, type AgentAskQuestion } from "./agentsviewmodel";

const isAnswered = (selections: Record<number, Set<number>>, texts: Record<number, string>, qi: number) =>
    (selections[qi]?.size ?? 0) > 0 || (texts[qi] ?? "").trim() !== "";

/** Pure: whether the keys walk this ask, which is when it has more than one question. */
export function walksAsk(questions: AgentAskQuestion[]): boolean {
    return questions.length > 1;
}

/** Pure: the question to move to after a pick on `qi`, or null to stay. A multi-select question stays, since it
 *  takes several picks; a single-select one moves to the next unanswered question, as a click does. It never
 *  submits: the keyboard keeps Enter as the confirm step. A single-question ask stays too. */
export function pickAdvance(
    questions: AgentAskQuestion[],
    selections: Record<number, Set<number>>,
    texts: Record<number, string>,
    qi: number
): number | null {
    if (!walksAsk(questions) || questions[qi]?.multiSelect) {
        return null;
    }
    const next = nextUnansweredQuestion(questions, selections, texts, qi);
    return next === -1 ? null : next;
}

export type EnterAction = { kind: "submit" } | { kind: "question"; qi: number };

/** Pure: Enter on an ask of several questions submits once every question has an answer; otherwise it moves to the
 *  first unanswered question, starting from the active one, so Enter never opens the agent over a partial answer.
 *  Null for a single-question ask: the caller does what it did before (send it if answered, else open focus). */
export function enterAction(
    questions: AgentAskQuestion[],
    selections: Record<number, Set<number>>,
    texts: Record<number, string>,
    activeQi: number
): EnterAction | null {
    if (!walksAsk(questions)) {
        return null;
    }
    if (canSubmitAsk(questions, selections, texts)) {
        return { kind: "submit" };
    }
    const n = questions.length;
    const start = Math.max(0, Math.min(activeQi, n - 1));
    for (let step = 0; step < n; step++) {
        const qi = (start + step) % n;
        if (!isAnswered(selections, texts, qi)) {
            return { kind: "question", qi };
        }
    }
    return { kind: "question", qi: start };
}
