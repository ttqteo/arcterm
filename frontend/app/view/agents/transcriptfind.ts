// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The find bar's matches over a transcript read as entries. They are counted over the text of each prompt and reply
// (findRanges, the Go matcher's own rule), not over the DOM, so the count includes the entries CompactTranscript has not
// drawn and agrees with the hits the search reported; the bar then paints the drawn ones (sessionfindbar.tsx).

import type { AgentEntry } from "./agentsviewmodel";
import { findRanges } from "./sessionsfind";

/** One match: the index of its entry in the transcript, and which of that entry's own matches it is (so the DOM range
 *  of the entry's drawn text can be found again by position). */
export interface FindMatch {
    entry: number;
    nth: number;
}

/** Pure: every match of `terms` over the prompts and replies of `entries`, in transcript order. */
export function transcriptMatches(entries: AgentEntry[], terms: string[]): FindMatch[] {
    const out: FindMatch[] = [];
    if (terms.length === 0) {
        return out;
    }
    entries.forEach((e, entry) => {
        if (e.kind !== "user" && e.kind !== "message") {
            return;
        }
        findRanges(e.text, terms).forEach((_, nth) => out.push({ entry, nth }));
    });
    return out;
}

/** Pure: the bar's count, "2 / 7" from `pos` 1, "No matches" at 0, nothing while the transcript is still loading (null). */
export function findPosLabel(pos: number, total: number | null): string {
    if (total == null) {
        return "";
    }
    return total > 0 ? `${pos + 1} / ${total}` : "No matches";
}
