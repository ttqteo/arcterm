// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The Doc review card in Chat, the pure model (docs/superpowers/specs/2026-11-14-chat-council-design.md): recognizing
// the AskUserQuestion a worker asks when it finishes a section of a paper or a note. The card (chatdocreviewcard.tsx)
// draws; the dock and the conversation place it. The convention itself is docreview.ts's `parseDocReview`.

import type { AgentAskQuestion } from "./agentsviewmodel";
import { parseDocReview } from "./docreview";

/** Pure: whether an AskUserQuestion is a Doc review Chat draws as a card: `parseDocReview` reads it as one (exactly one
 *  question, headed `Doc review`, whose first line is a `.md` or `.tex` path). Structural, as `isHandoffAsk` is: the dock
 *  passes the live ask's questions and the transcript an answered ask's (`AskQuestionDetail[]`). Any other ask with that
 *  header stays an ordinary question. */
export function isDocReviewAsk(questions: readonly AgentAskQuestion[] | undefined): boolean {
    return parseDocReview(questions != null ? { questions } : undefined)?.kind === "doc";
}
