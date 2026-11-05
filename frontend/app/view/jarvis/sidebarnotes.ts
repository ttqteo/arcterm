// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// A chunk's note cards (design L367-397, model L1508-1542), read by the Chunk sidebar and by the chunk view's trail
// (chunktrail.ts). Pure.

import { noteBody, stamp, type FeedEntry } from "./effortfeed";

// a note under this length is read whole; the newest one opens by default (design L1515)
export const NOTE_OPEN_CHARS = 280;

export type NoteCard = {
    key: string;
    entry: FeedEntry;
    who: "agent" | "you" | "";
    day: string;
    edited: boolean;
    text: string;
    open: boolean;
    chev: string;
    editable: boolean;
    runOid: string;
    sessionTab: string;
    // the status this entry set, when it is a status change that carries text (changedTo); null for a plain note
    changed: string | null;
};

const MARKED = /^marked (\w+)$/;

/**
 * The status a feed entry set, when it is a status change: read off its `marked …` line, a `chunk-done` reading done
 * even when its note went unlocated. Null for a note, a chunk added, or a status change whose status went unrecorded.
 */
export function changedTo(f: FeedEntry): string | null {
    if (f.kind !== "chunk-status" && f.kind !== "chunk-done") {
        return null;
    }
    const m = MARKED.exec(f.marked);
    if (m != null) {
        return m[1];
    }
    return f.kind === "chunk-done" ? "done" : null;
}

// a note's run read: WOS settles a missing object as no value and no error, so "not loading" is what says gone
export function noteRunFace(r: {
    run: Run | undefined;
    loading: boolean;
    error: boolean;
}): "loading" | "gone" | "ready" {
    if (r.run != null) {
        return "ready";
    }
    return r.loading && !r.error ? "loading" : "gone";
}

export function sidebarNotes(feed: FeedEntry[], label: string, now: number, expanded: Set<string>): NoteCard[] {
    const entries = feed.filter((f) => f.chunk === label && noteBody(f) !== "");
    return entries.map((f, i) => {
        const key = String(f.seq);
        const text = noteBody(f);
        const newestShort = i === 0 && text.length < NOTE_OPEN_CHARS;
        const open = newestShort || expanded.has(key);
        const who = f.author === "agent" || f.author === "you" ? f.author : "";
        return {
            key,
            entry: f,
            who,
            day: stamp(f.ts, now),
            edited: f.edited === true,
            text,
            open,
            chev: newestShort ? "" : open ? "less" : "more",
            // an agent's note is its record of what it did; yours and legacy ones stay editable
            editable: f.noteAt != null && who !== "agent",
            runOid: (f.run ?? "").replace(/^run:/, ""),
            sessionTab: (f.session ?? "").replace(/^agent:/, ""),
            changed: changedTo(f),
        };
    });
}
