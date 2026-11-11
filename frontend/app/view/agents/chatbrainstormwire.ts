// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The pure glue between Chat and the brainstorm question card (docs/superpowers/specs/2026-11-11-chat-redesign-design.md,
// section 6): which of your messages the conversation offers to chatbrainstorm.ts's pairAnswers, what a message sent from the
// box leaves in the send record while a question waits, and the box's placeholder for it. chatconversation.tsx draws the
// card and the ✓ rows, chatpane.tsx records the box's answers; this holds the rules they share.

import type { AgentEntry } from "./agentsviewmodel";
import { questionPlaceholder, type OpenQuestion, type SentAnswer } from "./chatbrainstorm";
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

/** The record to keep for a message sent from the box, or null when it answers nothing. While a question waits (or the
 *  judge weighs it) a message in words is its answer; with no question open, a pointer or an agent that exited there is
 *  nothing to answer. A slash command and a bash-mode command are no answer either, and neither is an empty message.
 *  `seen` is counted on `entries` before the message lands (userTextCount), as chatpending.ts counts for its bubble. */
export function boxAnswerRecord(
    question: OpenQuestion | null,
    topic: string,
    text: string,
    entries: AgentEntry[],
    now: number
): SentAnswer | null {
    if (question == null || question.state === "pointer" || question.state === "static") {
        return null;
    }
    const body = text.trim();
    if (body === "" || body.startsWith("/") || body.startsWith("!")) {
        return null;
    }
    return { topic, n: question.n, part: question.part, text, sentAt: now, seen: userTextCount(entries, text) };
}

/** The box's placeholder while a question waits, or null (no question, a pointer, or an agent that exited, whose box says
 *  what it always says). */
export function boxPlaceholderOverride(question: OpenQuestion | null): string | null {
    return question == null || question.state === "static" ? null : questionPlaceholder(question);
}

/** What a ✓ row shows of the message it replaces: the answer without the attachments block a send with files carries (the
 *  row is one line), or the whole text when the message is nothing but attachments. */
export function answeredText(text: string): string {
    const body = splitAttachments(text).text.trim();
    return body !== "" ? body : text.trim();
}
