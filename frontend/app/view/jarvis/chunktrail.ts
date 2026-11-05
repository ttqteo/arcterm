// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The chunk view's trail and its one-move button (docs/superpowers/specs/2026-11-05-jarvis-revamp-design.md, decision
// 9, board Chunk.dc.html). The trail reads newest first: a note (by the person or an agent, a status change that
// carries text included) is a block; a bare status change (one whose note is empty) is a thin line. Built on the note
// cards sidebarnotes.ts makes. Pure.

import { stamp, type FeedEntry } from "./effortfeed";
import { chunkTone, type ChunkTone } from "./effortmodel";
import { changedTo, sidebarNotes, type NoteCard } from "./sidebarnotes";

export type TrailBlock = Omit<NoteCard, "open" | "chev" | "changed"> & {
    kind: "note";
    // the status this note's change set, drawn as its `→ <status>` tag; null for a plain note
    tag: string | null;
    // Show all pressed: the text unclamped, and the run's report under it
    expanded: boolean;
};

export type TrailLine = {
    kind: "status";
    key: string;
    entry: FeedEntry;
    // the status it set; null when the change's status went unrecorded
    status: string | null;
    tone: ChunkTone;
    day: string;
};

export type TrailEntry = TrailBlock | TrailLine;

const newestFirst = (a: TrailEntry, b: TrailEntry) => b.entry.ts - a.entry.ts || b.entry.seq - a.entry.seq;

/**
 * One chunk's trail, newest first. `expanded` holds the keys of the blocks the person opened with Show all;
 * `notesOnly` leaves the thin lines out.
 */
export function chunkTrail(
    feed: FeedEntry[],
    label: string,
    now: number,
    expanded: Set<string>,
    notesOnly: boolean
): TrailEntry[] {
    const blocks: TrailEntry[] = sidebarNotes(feed, label, now, expanded).map(
        ({ open: _open, chev: _chev, changed, ...card }) => ({
            ...card,
            kind: "note",
            tag: changed,
            expanded: expanded.has(card.key),
        })
    );
    const blockKeys = new Set(blocks.map((b) => b.key));
    const lines: TrailEntry[] = notesOnly
        ? []
        : feed
              .filter(
                  (f) =>
                      f.chunk === label &&
                      (f.kind === "chunk-status" || f.kind === "chunk-done") &&
                      !blockKeys.has(String(f.seq))
              )
              .map((f) => {
                  const status = changedTo(f);
                  return {
                      kind: "status",
                      key: String(f.seq),
                      entry: f,
                      status,
                      tone: chunkTone(status ?? ""),
                      day: stamp(f.ts, now),
                  };
              });
    return [...blocks, ...lines].sort(newestFirst);
}

// the line under the status control: "3 status changes · 1 note", a status change with text counted in both
export function trailCounts(trail: TrailEntry[]): { statusChanges: number; notes: number } {
    return {
        statusChanges: trail.filter((t) => t.kind === "status" || t.tag != null).length,
        notes: trail.filter((t) => t.kind === "note").length,
    };
}

export type ChunkMoveKind = { kind: "set"; status: string } | { kind: "advance" } | { kind: "reopen" };

/**
 * The one button beside the status control: the move the status most often needs. `isActiveChunk` is whether this is
 * the chunk `wsh effort advance` would close (the plan's first active one), so Done advances the plan only then.
 */
export function chunkMove(status: string, isActiveChunk: boolean): { label: string; move: ChunkMoveKind } | null {
    switch (status) {
        case "pending":
            return { label: "Start", move: { kind: "set", status: "active" } };
        case "active":
            return { label: "Done", move: isActiveChunk ? { kind: "advance" } : { kind: "set", status: "done" } };
        case "done":
            // today's reopen: the chunk active again, any other active one back to pending
            return { label: "Reopen", move: { kind: "reopen" } };
        case "blocked":
            return { label: "Unblock", move: { kind: "set", status: "active" } };
        case "deferred":
        case "skipped":
            return { label: "Reopen", move: { kind: "set", status: "pending" } };
        default:
            return null;
    }
}
