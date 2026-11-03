// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// What the Report / Discussion tab strip (counciltabs.tsx) derives from a council. Pure: no React, no store.

import { sentProposals } from "./councilmodel";

/** The count beside the Discussion tab: the ideas sent so far, "" at none (the pill is hidden), "1 idea", "N ideas". */
export function discussionCount(c: Pick<Council, "proposals">): string {
    const n = sentProposals(c).length;
    if (n === 0) {
        return "";
    }
    return n === 1 ? "1 idea" : `${n} ideas`;
}
