// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// What the record body tells the item view. The body itself is the Brief's record peek (briefpeek.ts); the list
// is what can say a record is gone, because the detail cache keeps a record it once loaded.

import type { PeekFacts } from "../peekstore";

// summary: the record's row in taskListAtom, undefined once the list no longer has it
export function recordPeekFacts(summary: SpaceSummary | undefined): PeekFacts {
    return { gone: summary == null };
}
