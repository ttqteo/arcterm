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
 *  file, which never slides; `full` asks the same of any runtime (a search hit can sit in the first turn). */
export function transcriptAsk(
    path: string,
    runtime: string,
    win: LoadedWindow | null,
    full = false
): CommandGetAgentTranscriptData {
    if (win == null || win.end <= 0) {
        return { path, maxlines: runtime === "pi" || full ? -1 : TAIL_LINES };
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
async function readWindow(
    path: string,
    runtime: string,
    win: LoadedWindow | null,
    full: boolean
): Promise<LoadedWindow> {
    let held = win;
    // a tail read never says "reread", so this is at most two reads
    for (;;) {
        const asked = transcriptAsk(path, runtime, held, full);
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
    full: boolean; // the whole file is read, not its tail
    win: LoadedWindow | null; // the lines read so far; null before the first read lands
    busy: boolean; // a read is in flight
    again: boolean; // a change came while it was: one more read follows it
    token: number; // changes with the session, so an answer for an older one is dropped
}

/** Pure: whether the reader holds another read than the one asked for now, which drops its window and reads afresh. A
 *  session open on its tail that a find then targets reads the whole file: it must not keep the tail window and only
 *  append to it, so `full` flipping resets the reader as a change of path does. */
export function readChanged(
    r: Pick<Reader, "path" | "runtime" | "full">,
    path: string | undefined,
    runtime: string | undefined,
    full: boolean
): boolean {
    return r.path !== path || r.runtime !== runtime || r.full !== full;
}

/** The projected transcript at `path`, null while the first read is in flight and [] when there is none. `live` reads
 *  what is written after the window as it grows: the entries already there keep their index, so a pane that keys on it
 *  (CompactTranscript's drawn window and open folds) keeps its place. `full` reads the whole file instead of its tail,
 *  which Conversation History asks for a session a search hit opened. */
export function useTranscriptRead(
    path: string | undefined,
    runtime: string | undefined,
    live: boolean,
    full = false
): AgentEntry[] | null {
    // the entries carry the `full` they were read under: the render in which `full` flips, before the effect below resets
    // the reader, must not hand back the other read's entries (a find would count its matches over the tail)
    const [read, setRead] = useState<{ entries: AgentEntry[] | null; full: boolean }>({ entries: null, full });
    const changed = useTranscriptChanges(path, runtime, live);
    const reader = useRef<Reader>({ full: false, win: null, busy: false, again: false, token: 0 });
    // Each change reads once more, one read at a time: a change that comes while the first read is in flight (the stream's
    // first chunk lands within it) asks for one more after it instead of cancelling it and reading the tail again.
    useEffect(() => {
        const r = reader.current;
        const setEntries = (entries: AgentEntry[] | null) => setRead({ entries, full });
        if (readChanged(r, path, runtime, full)) {
            // a new session starts from the skeleton and from its own first read; a re-read of the same one keeps showing
            // the last read until it lands
            Object.assign(r, { path, runtime, full, win: null, busy: false, again: false, token: r.token + 1 });
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
                    const next = await readWindow(path, runtime, r.win, full);
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
                    setRead((prev) => ({ entries: prev.entries ?? [], full }));
                }
            } finally {
                if (mine === r.token) {
                    r.busy = false;
                }
            }
        });
    }, [path, runtime, full, changed]);
    return read.full === full ? read.entries : null;
}
