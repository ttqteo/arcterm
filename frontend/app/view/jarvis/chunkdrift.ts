// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// A chunk not yet done was written against the code of its day. The server keeps the commit it was written at
// (EffortChunk.basecommit) and counts the commits since (EffortChunkDriftCommand); this words that count for the
// chunk view, with the Mark checked that moves the base to today's HEAD. Pure: no React, no Wave runtime imports.

import { shortDate } from "./initiativework";

export type ChunkDriftLine = { text: string; title: string };

// a settled chunk has nothing left to go stale, and a count of zero says nothing worth a line
export function chunkDriftLine(
    status: string,
    drift: Pick<CommandEffortChunkDriftRtnData, "known" | "base" | "behind" | "basets"> | null | undefined
): ChunkDriftLine | null {
    if (drift == null || !drift.known || drift.behind <= 0 || status === "done" || status === "skipped") {
        return null;
    }
    const n = drift.behind === 1 ? "1 commit" : `${drift.behind} commits`;
    const when = drift.basets ? ` (${shortDate(drift.basets)})` : "";
    return {
        text: `Written ${n} ago${when}: check it still holds`,
        title: `Written against ${(drift.base ?? "").slice(0, 9)}. Mark checked once it is right for today's code.`,
    };
}
