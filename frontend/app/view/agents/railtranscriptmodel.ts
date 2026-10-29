// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The Transcript tab's decisions (docs/superpowers/specs/2026-10-29-rail-transcript-tab-design.md): the window of
// transcript lines it has loaded and how a read changes it, the Compactions control's next step, and when it appends
// what the agent writes. Pure: no React, no Wave runtime, no wshrpc types (railtranscript.tsx maps the RPC answer onto
// these).

import type { AgentEntry } from "./agentsviewmodel";

// a transcript read's answer, from the end (a tail), or from before a line (an earlier chunk): `start` is the file index of
// lines[0] (wavesrv numbers the non-empty lines from 0), `total` the lines the file holds, `end` the byte offset just past
// the last newline-terminated line it read, and `partial` says the last line returned has no newline yet
export interface ReadAnswer {
    lines: string[];
    start: number;
    total: number;
    end: number;
    partial?: boolean;
}

// an append answer: the complete lines after the byte offset it was asked from, and the new `end`; `reset` says the
// file is now shorter than that offset (replaced), so no lines come back
export interface AppendAnswer {
    lines: string[];
    end: number;
    reset?: boolean;
}

// the part of the file the tab holds: lines[0] is file line `start`, `end` the byte offset the next append reads from
export interface LoadedWindow {
    lines: string[];
    start: number;
    total: number;
    end: number;
}

// the window cannot take the answer (a gap before it, or the file was replaced): read the tail again
export type Reread = "reread";

// The first read. A last line with no newline yet is half written: it is dropped here, and the answer's `end` already
// sits before it, so the first append returns it whole.
export function firstWindow(answer: ReadAnswer): LoadedWindow {
    const lines = answer.partial === true ? answer.lines.slice(0, -1) : answer.lines.slice();
    return { lines, start: answer.start, total: answer.total, end: answer.end };
}

// An earlier chunk goes in front of the window. It must end where the window starts; any other chunk leaves a hole (or
// overlaps), so the caller reads the tail again. Only its lines and start count: `end` and `total` stay the window's own,
// since the window still holds the file's end.
export function prependChunk(w: LoadedWindow, answer: ReadAnswer): LoadedWindow | Reread {
    if (answer.start + answer.lines.length !== w.start) {
        return "reread";
    }
    return { lines: [...answer.lines, ...w.lines], start: answer.start, total: w.total, end: w.end };
}

// What the agent wrote since `w.end`, after the window's last line. An answer with nothing new returns `w` itself, so a
// poll that finds nothing redraws nothing.
export function appendLines(w: LoadedWindow, answer: AppendAnswer): LoadedWindow | Reread {
    if (answer.reset === true) {
        return "reread";
    }
    if (answer.lines.length === 0 && answer.end === w.end) {
        return w;
    }
    const lines = [...w.lines, ...answer.lines];
    // an append answer carries no total: the file holds at least what the window reaches
    return { lines, start: w.start, total: Math.max(w.total, w.start + lines.length), end: answer.end };
}

// The `keyOffset` CompactTranscript takes after a prepend: how many entries the loads have put in front so far. The
// lines are projected whole again after a load, so the entries added in front are the growth in their count.
export function keyOffsetAfter(prev: number, entriesBefore: number, entriesAfter: number): number {
    return prev + (entriesAfter - entriesBefore);
}

// The Compactions control shows when a compaction is loaded, or when the loaded part does not start the file (an earlier
// one may exist)
export function showsCompactions(entries: AgentEntry[], w: Pick<LoadedWindow, "start">): boolean {
    return w.start > 0 || entries.some((e) => e.kind === "compaction");
}

export type CompactionStep = number | "load-earlier" | "none-left";

// What a press of the Compactions control does, newest first. `lastShownIndex` is the entry index of the marker the last
// press scrolled to (null before the first press), in the `entries` given: a load that puts entries in front shifts it by
// the same count as the `keyOffset`. The answer is the entry index of the next older marker, "load-earlier" when none older
// is loaded and the window does not start the file (the caller loads a chunk and asks again), or "none-left" at the start.
export function compactionStep(entries: AgentEntry[], lastShownIndex: number | null, atStart: boolean): CompactionStep {
    for (let i = (lastShownIndex ?? entries.length) - 1; i >= 0; i--) {
        if (entries[i]?.kind === "compaction") {
            return i;
        }
    }
    return atStart ? "none-left" : "load-earlier";
}

export const APPEND_INTERVAL_MS = 3000;

// "read": read now. "later": a stamp came inside the interval, so one read at `at` covers it and any that follow before
// then; a caller keeps one timer, and asks again when it fires. "wait": a read is in flight, which may have started before
// the stamp, so the caller notes it and asks again when that read lands.
export type AppendDecision = { do: "read" } | { do: "later"; at: number } | { do: "wait" };

// Each activity stamp from the live stream asks for an append read; this keeps them to one in APPEND_INTERVAL_MS, with a
// trailing read for the last stamp. Times are the caller's clock in ms; `lastReadAt` is when the last read started, null
// before any.
export function appendThrottle(input: { lastReadAt: number | null; inFlight: boolean; now: number }): AppendDecision {
    const { lastReadAt, inFlight, now } = input;
    if (inFlight) {
        return { do: "wait" };
    }
    if (lastReadAt == null || now - lastReadAt >= APPEND_INTERVAL_MS) {
        return { do: "read" };
    }
    return { do: "later", at: lastReadAt + APPEND_INTERVAL_MS };
}

// The tab reads appends only while it is seen: the Agent surface shown (it stays mounted while hidden), the rail open, and
// Transcript the tab it shows
export function shouldStream(input: { surface: string; railOpen: boolean; shownTab: string }): boolean {
    return input.surface === "agent" && input.railOpen && input.shownTab === "transcript";
}
