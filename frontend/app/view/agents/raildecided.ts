// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The rules of the rail's Decided tab (raildecidedpane.tsx; docs/superpowers/specs/2026-11-25-agent-pair-judge-design.md),
// pure: whether anything waits on the person (the tab's dot), why an open item is open, what an answer chip sends, which
// message an agreed item links to. The lists themselves are the server's (PairView.decided); this only reads them.

import { shortTabId } from "./agentrowmodel";

/** Whether the person has something to answer: an A item with no answer yet. The tab's dot reads this; an answered item
 *  stays in Waits on you until the working agent's next block, but nothing waits on the person any more. A nil list over
 *  the wire reads as empty. */
export function waitsOnYou(decided: PairDecided | null | undefined): boolean {
    return (decided?.asks ?? []).some((a) => a.answer === "");
}

/** Why an open item is open, in the words under it: a judge's reopen mark names the judge, a judge's `new:` point says
 *  so (naming the judge only while the pair has several); "" for one the working agent itself left open. */
export function openReason(item: PairItem, judges: number): string {
    if (item.reopenedby !== "") {
        return `reopened by judge ${shortTabId(item.reopenedby)}`;
    }
    if (item.newby !== "") {
        return judges > 1 ? `judge ${shortTabId(item.newby)}'s new point` : "judge's new point";
    }
    return "";
}

/** What a chip on a Waits-on-you item sends: the chip's words to both sides, tagged with the A item they answer. */
export function answerChip(pairId: string, item: PairItem, chip: string): CommandPairSayData {
    return { pairid: pairId, text: chip, to: "both", replyto: "", item: item.num };
}

/** The message an agreed item links to (where it was settled), or null with none, or when it is no longer there. */
export function linkedMessage(messages: readonly PairMessage[] | null | undefined, item: PairItem): PairMessage | null {
    return item.msgid === "" ? null : ((messages ?? []).find((m) => m.id === item.msgid) ?? null);
}
