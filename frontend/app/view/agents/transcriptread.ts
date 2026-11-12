// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Reads one session's transcript (its recent window, then what is written after it) and projects it with the runtime's
// projector, for a pane that shows a conversation as it stands: Conversation History's session detail, and a sleeping
// agent's cell. The window is the Transcript tab's (railtranscriptmodel.ts): a first read of the tail, then each change
// reads only the bytes after the window's end and appends them, so the entries already drawn never move.

import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { fireAndForget } from "@/util/util";
import { useAtomValue } from "jotai";
import { useEffect, useRef, useState } from "react";
import type { AgentEntry } from "./agentsviewmodel";
import { startTranscriptStream, stopTranscriptStream } from "./livetranscript";
import { activityAtomFor } from "./livetranscriptatoms";
import { appendLines, firstWindow, type LoadedWindow, type Reread } from "./railtranscriptmodel";
import { projectorFor } from "./transcriptregistry";

/** Lines in the first read: the recent window of a file (Conversation History and the Transcript tab read the same). */
export const TAIL_LINES = 2000;

/** Pure: the question to put to the file. The tail while no window is held, or when the held one has no complete line to
 *  read on from (frombyte 0 reads as no offset, and the answer would be a tail the window would take for an append);
 *  otherwise the bytes after the window's end. Pi's parent-linked active branch needs every line, so it reads the whole
 *  file, which never slides. */
export function transcriptAsk(path: string, runtime: string, win: LoadedWindow | null): CommandGetAgentTranscriptData {
    if (win == null || win.end <= 0) {
        return { path, maxlines: runtime === "pi" ? -1 : TAIL_LINES };
    }
    return { path, frombyte: win.end };
}

/** Pure: the window after `answer`, which answers `asked`. A tail read is the window; an append grows the held one and
 *  keeps its first line, or says "reread" when the file was replaced (the caller asks for the tail then). */
export function windowAfter(
    win: LoadedWindow | null,
    asked: CommandGetAgentTranscriptData,
    answer: CommandGetAgentTranscriptRtnData
): LoadedWindow | Reread {
    const lines = answer.lines ?? [];
    if (win == null || asked.frombyte == null) {
        return firstWindow({
            lines,
            start: answer.start,
            total: answer.total,
            end: answer.end,
            partial: answer.partial,
        });
    }
    return appendLines(win, { lines, end: answer.end, reset: answer.reset });
}

// the window grown by what the file gained since it was read (the same window back when nothing is new), or its tail read
// again when it cannot be joined
async function readWindow(path: string, runtime: string, win: LoadedWindow | null): Promise<LoadedWindow> {
    let held = win;
    // a tail read never says "reread", so this is at most two reads
    for (;;) {
        const asked = transcriptAsk(path, runtime, held);
        const answer = await RpcApi.GetAgentTranscriptCommand(TabRpcClient, asked);
        const next = windowAfter(held, asked, answer);
        if (next !== "reread") {
            return next;
        }
        held = null;
    }
}

// A running session's transcript grows while it is read. The stream (livetranscript.ts) watches the file and stamps
// its activity on every chunk; each stamp reads what the file gained since the window's end (the stream's own window is
// only its last few hundred lines).
function useTranscriptChanges(
    path: string | undefined,
    runtime: string | undefined,
    live: boolean
): number | undefined {
    const streamId = live && path ? `transcript-read:${path}` : "";
    useEffect(() => {
        if (!streamId) {
            return;
        }
        startTranscriptStream(streamId, path, runtime);
        return () => stopTranscriptStream(streamId);
    }, [streamId]);
    return useAtomValue(activityAtomFor(streamId));
}

// what the hook holds of one session between renders
interface Reader {
    path?: string;
    runtime?: string;
    win: LoadedWindow | null; // the lines read so far; null before the first read lands
    busy: boolean; // a read is in flight
    again: boolean; // a change came while it was: one more read follows it
    token: number; // changes with the session, so an answer for an older one is dropped
}

/** The projected transcript at `path`, null while the first read is in flight and [] when there is none. `live` reads
 *  what is written after the window as it grows: the entries already there keep their index, so a pane that keys on it
 *  (CompactTranscript's drawn window and open folds) keeps its place. */
export function useTranscriptRead(
    path: string | undefined,
    runtime: string | undefined,
    live: boolean
): AgentEntry[] | null {
    const [entries, setEntries] = useState<AgentEntry[] | null>(null);
    const changed = useTranscriptChanges(path, runtime, live);
    const reader = useRef<Reader>({ win: null, busy: false, again: false, token: 0 });
    // Each change reads once more, one read at a time: a change that comes while the first read is in flight (the stream's
    // first chunk lands within it) asks for one more after it instead of cancelling it and reading the tail again.
    useEffect(() => {
        const r = reader.current;
        if (r.path !== path || r.runtime !== runtime) {
            // a new session starts from the skeleton and from its own first read; a re-read of the same one keeps showing
            // the last read until it lands
            Object.assign(r, { path, runtime, win: null, busy: false, again: false, token: r.token + 1 });
            setEntries(null);
        }
        if (!path || !runtime) {
            setEntries([]);
            return;
        }
        if (r.busy) {
            r.again = true;
            return;
        }
        const mine = r.token;
        r.busy = true;
        fireAndForget(async () => {
            try {
                for (;;) {
                    r.again = false;
                    const next = await readWindow(path, runtime, r.win);
                    if (mine !== r.token) {
                        return;
                    }
                    if (next !== r.win) {
                        r.win = next;
                        setEntries(projectorFor(runtime, path).project(next.lines));
                    }
                    if (!r.again) {
                        return;
                    }
                }
            } catch (e) {
                console.warn(`reading transcript ${path} failed`, e);
                // a failed append leaves what is drawn; a failed first read leaves an empty transcript
                if (mine === r.token) {
                    setEntries((prev) => prev ?? []);
                }
            } finally {
                if (mine === r.token) {
                    r.busy = false;
                }
            }
        });
    }, [path, runtime, changed]);
    return entries;
}
