// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// What the Report / Discussion / Map tab strip (counciltabs.tsx) derives from a council. Pure: no React, no store.

import { mapWords } from "./councilmapmodel";
import { sentProposals } from "./councilmodel";

/** The three views a council's tab strip switches between; the wire's names (councilViewAtom), not the labels. */
export type CouncilTabId = "summary" | "discussion" | "map";

/** One tab of the strip: `label` is the word on it, `count` the pill beside it ("" for none). */
export interface CouncilTab {
    id: CouncilTabId;
    label: string;
    count: string;
}

/** The count beside the Discussion tab: the ideas sent so far, "" at none (the pill is hidden), "1 idea", "N ideas". */
export function discussionCount(c: Pick<Council, "proposals">): string {
    const n = sentProposals(c).length;
    if (n === 0) {
        return "";
    }
    return n === 1 ? "1 idea" : `${n} ideas`;
}

/** Pure: the tabs of a council, in order: Report, Discussion (with the count of ideas sent) and the Map, which is open
 *  while the council runs and after, with an idea sent or none. The Map's word follows the council's language (`Bản đồ`
 *  in a Vietnamese council); Report and Discussion keep theirs. */
export function councilTabs(c: Pick<Council, "proposals" | "lang">): CouncilTab[] {
    return [
        { id: "summary", label: "Report", count: "" },
        { id: "discussion", label: "Discussion", count: discussionCount(c) },
        { id: "map", label: mapWords(c).tab, count: "" },
    ];
}
