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
// Done, skipped and proposed chunks are not in it, and neither is a chunk saved for later (EffortChunk.later): it is not
// the initiative's work, so the filter comes before the rank and a later chunk of any level is never next. The next
// chunk is its first entry.

import { isLater } from "./laterchunk";

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
export function orderOfWork<T extends { status: string; priority?: string; later?: boolean }>(chunks: T[]): T[] {
    const active: T[] = [];
    const pending: { c: T; i: number }[] = [];
    const parked: { c: T; i: number }[] = [];
    chunks.forEach((c, i) => {
        if (isLater(c)) {
            return;
        }
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

// How many open chunks carry each level, highest first, for the badges on an initiative's card and row ("1 critical",
// "4 high"), so the levels show without opening it. Open is the order of work's statuses (pending, active, blocked,
// deferred): done, skipped and proposed chunks are not counted, nor a chunk saved for later, nor one with no level or
// one this build does not know. Levels with none are left out.
export type PriorityCount = { level: ChunkPriority; n: number };

const OPEN_STATUSES = new Set(["pending", "active", "blocked", "deferred"]);

export function openPriorityCounts(chunks: { status: string; priority?: string; later?: boolean }[]): PriorityCount[] {
    const counts = new Map<ChunkPriority, number>();
    for (const c of chunks) {
        if (isLater(c) || !OPEN_STATUSES.has(c.status) || !CHUNK_PRIORITIES.includes(c.priority as ChunkPriority)) {
            continue;
        }
        const level = c.priority as ChunkPriority;
        counts.set(level, (counts.get(level) ?? 0) + 1);
    }
    return CHUNK_PRIORITIES.filter((l) => counts.has(l)).map((level) => ({ level, n: counts.get(level) }));
}

export function priorityBadge(priority?: string): { text: string; className: string } | null {
    if (!priority || !CHUNK_PRIORITIES.includes(priority as ChunkPriority)) {
        return null;
    }
    return { text: priority, className: BADGE_CLASS[priority as ChunkPriority] };
}
