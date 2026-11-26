// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The closing card at the foot of a finished council's Discussion (councilchat.tsx `ClosingCard`): the council's answer
// in one sentence, how much it settled, and the way to its Report. It points at the Report and copies none of it: the
// answer is the Report's bold line (councilsummarymodel.ts `answerLine`) and the counts are its "What it settled" groups
// (councilmemorymodel.ts `settledOf`). Pure: no React, no store; councilclosingmodel.test.ts holds its rules.

import { settledOf } from "./councilmemorymodel";
import { answerLine } from "./councilsummarymodel";

/** What the closing card draws. */
export interface ClosingCard {
    kicker: string; // `Council done`, `Council stopped`, `Council ended`
    answer: string; // the Report's bold line; "" when the summary has no text
    direction: string; // the chosen direction's text; "" with none
    counts: string; // `3 agreed · 2 still open · 1 ruled out`, the groups that have entries; "" for none
}

const KICKER: Partial<Record<string, string>> = {
    done: "Council done",
    stopped: "Council stopped",
    failed: "Council ended",
};

/** Pure: the closing card of council `c`, or null while it has none to show: the council has not ended (it runs, waits
 *  for you or is queued), or it ended without a summary (the Discussion's Summarize and failure notes cover that). */
export function closingCard(c: Council): ClosingCard | null {
    const kicker = KICKER[c.state];
    if (kicker == null || c.summary == null) {
        return null;
    }
    const settled = settledOf(c);
    const counts = (settled?.groups ?? []).map((g) => `${g.items.length} ${g.label.toLowerCase()}`).join(" · ");
    return { kicker, answer: answerLine(c), direction: settled?.direction ?? "", counts };
}
