// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The Chunk sidebar's note cards (design L367-397, model L1508-1542). Pure.

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
};

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
        };
    });
}
