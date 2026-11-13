// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The pure glue between Chat and the brainstorm question card (docs/superpowers/specs/2026-11-11-chat-redesign-design.md,
// section 6): which of your messages the conversation offers to chatbrainstorm.ts's pairAnswers, what a message sent from the
// box leaves in the send record while a question waits, and the box's placeholder for it. chatconversation.tsx draws the
// card and the ✓ rows, chatpane.tsx records the box's answers; this holds the rules they share.

import type { AgentEntry } from "./agentsviewmodel";
import { questionPlaceholder, type ChatCard, type PairedAnswer, type SentAnswer } from "./chatbrainstorm";
import { splitAttachments } from "./chatfiles";
import type { ChatItem } from "./chatmodel";
import { userTextCount } from "./chatpending";
import { unwrapWholePaste } from "./chattagblocks";

/** Your plain messages as pairAnswers takes them: the key is the row's, the text is read the way userTextCount counts it
 *  (a message the harness wrapped whole as a paste is its body), so a record's `seen` and this agree. Commands, sent
 *  cards and markers are no answer. */
export function answerMessages(items: readonly ChatItem[]): { key: string; text: string }[] {
    const out: { key: string; text: string }[] = [];
    for (const item of items) {
        if (item.kind === "you" && !("command" in item)) {
            out.push({ key: item.key, text: unwrapWholePaste(item.text) });
        }
    }
    return out;
}

/** The record to keep for a message sent from the box, or null when it answers nothing. While a question card waits (or
 *  the judge weighs it) a message in words is its answer; with no card, a card of another kind (the Confirm, check and
 *  run cards are answered by their buttons, and a builder question by its own field: words in the box there are the
 *  user's own, pushback the agent reads as such) or an agent that exited there is nothing to answer. A slash command and
 *  a bash-mode command are no answer either, and neither is an empty message. `seen` is counted on `entries` before the
 *  message lands (userTextCount), as chatpending.ts counts for its bubble. */
export function boxAnswerRecord(
    question: ChatCard | null,
    topic: string,
    text: string,
    entries: AgentEntry[],
    now: number
): SentAnswer | null {
    if (question == null || question.kind !== "question" || question.state === "static") {
        return null;
    }
    const body = text.trim();
    if (body === "" || body.startsWith("/") || body.startsWith("!")) {
        return null;
    }
    // `typed`: these are the user's words, not a click on an option, so the ✓ row says "You replied"
    return {
        topic,
        n: question.n,
        part: question.part,
        text,
        sentAt: now,
        seen: userTextCount(entries, text),
        typed: true,
    };
}

/** The box's placeholder while a question card waits, or null (no card, a card of another kind, or an agent that
 *  exited: the box says what it always says). */
export function boxPlaceholderOverride(question: ChatCard | null): string | null {
    return question == null || question.kind !== "question" || question.state === "static"
        ? null
        : questionPlaceholder(question);
}

/** Whether the message a record paired with draws nothing at all, not even an empty row in the column: an action line
 *  (confirm, edit, keep, check retry…: its effect shows on the card and in the step's ✓ row), and the line that started
 *  a run while the run is live (its card is at the end of the conversation; the ✓ row comes once the run is over, which
 *  `doneRuns`, the run ids that are landed, complete or cancelled, says), and the Fix or Skip line of a verdict card (the
 *  card folds into its own ✓ row where it stood). Every other kind has a row. */
export function pairedHidden(answer: PairedAnswer, doneRuns: ReadonlySet<string>): boolean {
    switch (answer.kind) {
        case "action":
        case "verdict":
            return true;
        case "run":
            return answer.runId == null || !doneRuns.has(answer.runId);
        default:
            return false;
    }
}

/** What a ✓ row shows of the message it replaces: the answer without the attachments block a send with files carries (the
 *  row is one line), or the whole text when the message is nothing but attachments. */
export function answeredText(text: string): string {
    const body = splitAttachments(text).text.trim();
    return body !== "" ? body : text.trim();
}
