// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The order of work: which open chunk of an initiative opens next. The twin of pkg/waveobj/chunkorder.go (what
// `advance`, the summary's ActiveChunk, DUM-E's queue and `wsh effort show` read); both are checked against
// pkg/waveobj/testdata/chunkorder-cases.json, so the two cannot drift without a test failing.
//
// The order is, as one list:
//   1. the active chunks, in plan order (priority never takes the active slot from a chunk);
//   2. the pending chunks, highest rank first, ties in plan order;
//   3. the blocked and deferred chunks, highest rank first, ties in plan order (parked work opens only when
//      nothing is pending, whatever its level).
// Done, skipped and proposed chunks are not in it. The next chunk is its first entry.

export type ChunkPriority = "critical" | "high" | "medium" | "low" | "information";

// highest first: the order the chunk menu lists them in
export const CHUNK_PRIORITIES: readonly ChunkPriority[] = ["critical", "high", "medium", "low", "information"];

const MEDIUM_RANK = CHUNK_PRIORITIES.length - 1 - CHUNK_PRIORITIES.indexOf("medium");

// A level's place on the scale, 0 (information) up to 4 (critical). A chunk with no priority ranks as medium, and so
// does a level this build does not know, so neither can jump the queue or sink under it.
export function chunkRank(priority?: string): number {
    const i = CHUNK_PRIORITIES.indexOf(priority as ChunkPriority);
    return i < 0 ? MEDIUM_RANK : CHUNK_PRIORITIES.length - 1 - i;
}

// The open chunks in the order of work. It returns the chunks themselves (callers keep their extra fields) and leaves
// the array it was given alone.
export function orderOfWork<T extends { status: string; priority?: string }>(chunks: T[]): T[] {
    const active: T[] = [];
    const pending: { c: T; i: number }[] = [];
    const parked: { c: T; i: number }[] = [];
    chunks.forEach((c, i) => {
        if (c.status === "active") {
            active.push(c);
        } else if (c.status === "pending") {
            pending.push({ c, i });
        } else if (c.status === "blocked" || c.status === "deferred") {
            parked.push({ c, i });
        }
    });
    // chunks of one rank keep their plan order
    const byRank = (list: { c: T; i: number }[]) =>
        list.sort((a, b) => chunkRank(b.c.priority) - chunkRank(a.c.priority) || a.i - b.i).map((x) => x.c);
    return [...active, ...byRank(pending), ...byRank(parked)];
}

// The word a chunk's row shows for its level, with the theme-token classes that tone it. null when the chunk has no
// priority (an unset chunk shows nothing), or the level is one this build does not know.
const BADGE_CLASS: Record<ChunkPriority, string> = {
    critical: "text-error font-semibold",
    high: "text-ink-hi font-semibold",
    medium: "text-ink-mid",
    low: "text-muted",
    information: "text-ink-faint",
};

export function priorityBadge(priority?: string): { text: string; className: string } | null {
    if (!priority || !CHUNK_PRIORITIES.includes(priority as ChunkPriority)) {
        return null;
    }
    return { text: priority, className: BADGE_CLASS[priority as ChunkPriority] };
}
