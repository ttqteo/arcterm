// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Reads one session's transcript whole (its recent window) and projects it with the runtime's projector, for a pane
// that shows a conversation as it stands: Conversation History's session detail, and a sleeping agent's cell.

import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { fireAndForget } from "@/util/util";
import { useAtomValue } from "jotai";
import { useEffect, useState } from "react";
import type { AgentEntry } from "./agentsviewmodel";
import { startTranscriptStream, stopTranscriptStream } from "./livetranscript";
import { activityAtomFor } from "./livetranscriptatoms";
import { projectorFor } from "./transcriptregistry";

// A running session's transcript grows while it is read. The stream (livetranscript.ts) watches the file and stamps
// its activity on every chunk; each stamp re-reads the window, which keeps the read the same shape as a finished
// session's (the stream's own window is only its last few hundred lines).
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

/** The projected transcript at `path`, null while the first read is in flight and [] when there is none. `live`
 *  re-reads it as it grows. */
export function useTranscriptRead(
    path: string | undefined,
    runtime: string | undefined,
    live: boolean
): AgentEntry[] | null {
    const [entries, setEntries] = useState<AgentEntry[] | null>(null);
    const changed = useTranscriptChanges(path, runtime, live);
    // a new session starts from the skeleton; a re-read of the same one keeps showing the last read until it lands
    useEffect(() => {
        setEntries(null);
    }, [path, runtime]);
    useEffect(() => {
        let cancelled = false;
        if (!path || !runtime) {
            setEntries([]);
            return;
        }
        fireAndForget(async () => {
            try {
                // Pi's parent-linked active branch needs the complete file; other runtimes tail the recent window.
                const maxlines = runtime === "pi" ? -1 : 2000;
                const rtn = await RpcApi.GetAgentTranscriptCommand(TabRpcClient, { path, maxlines });
                const projected = projectorFor(runtime, path).project(rtn.lines ?? []);
                if (!cancelled) {
                    setEntries(projected);
                }
            } catch (e) {
                console.warn(`reading transcript ${path} failed`, e);
                if (!cancelled) {
                    setEntries([]);
                }
            }
        });
        return () => {
            cancelled = true;
        };
    }, [path, runtime, changed]);
    return entries;
}
