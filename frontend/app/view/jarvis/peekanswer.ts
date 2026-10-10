// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The peek's answer form: a question one key cannot answer (several questions, or several picks) opens the Cockpit's
// own AnswerBar under its row, and these are its keys. Pure, like petpeekmodel.ts; the selections, the free text
// and the active question are the model's shared answer atoms, so a pick here is the same pick on the Cockpit.

import { canSubmitAsk, nextUnansweredQuestion, type AgentAskQuestion } from "@/app/view/agents/agentsviewmodel";

export type FormKey =
    | { kind: "toggle"; qi: number; oi: number }
    | { kind: "question"; qi: number }
    | { kind: "submit" }
    | { kind: "collapse" };

// What a bare key does in an open form: a digit picks an option of the active question, the arrows move between
// questions, Enter sends a finished answer or takes an unfinished one to the question still open, and Escape folds
// the form. null leaves the key to the queue (j/k, Space, /).
export function formKey(
    key: string,
    questions: AgentAskQuestion[],
    active: number,
    selections: Record<number, Set<number>>,
    texts: Record<number, string>
): FormKey | null {
    if (/^[1-9]$/.test(key)) {
        const oi = Number(key) - 1;
        return oi < (questions[active]?.options?.length ?? 0) ? { kind: "toggle", qi: active, oi } : null;
    }
    switch (key) {
        case "ArrowLeft":
            return active > 0 ? { kind: "question", qi: active - 1 } : null;
        case "ArrowRight":
            return active < questions.length - 1 ? { kind: "question", qi: active + 1 } : null;
        case "Enter": {
            if (canSubmitAsk(questions, selections, texts)) {
                return { kind: "submit" };
            }
            const open = nextUnansweredQuestion(questions, selections, texts, -1);
            return open === -1 ? null : { kind: "question", qi: open };
        }
        case "Escape":
            return { kind: "collapse" };
        default:
            return null;
    }
}

// The question a pick leaves active: a single pick is that question's answer, so the form moves on to the next one
// still unanswered; a multi-select question takes more picks, and a finished form stays put for Enter. Never sends:
// unlike a click on the Cockpit's bar, a digit typed one too many must not answer for you.
export function questionAfterPick(
    questions: AgentAskQuestion[],
    qi: number,
    selections: Record<number, Set<number>>,
    texts: Record<number, string>
): number {
    if (questions[qi]?.multiSelect) {
        return qi;
    }
    const next = nextUnansweredQuestion(questions, selections, texts, qi);
    return next === -1 ? qi : next;
}
