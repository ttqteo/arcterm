// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Live narration for working agents: opens StreamAgentTranscriptCommand per visible
// agent, accumulates raw JSONL lines, and projects them with the agent's projector
// (transcriptregistry) into liveEntriesByIdAtom. lastActivityByIdAtom stamps each chunk for
// the liveness cue. The open stream IS the subscription — stopTranscriptStream cancels
// the generator, which cancels the backend ctx and tears down the fsnotify watcher.

import { globalStore } from "@/app/store/jotaiStore";
import { addWSReconnectHandler, removeWSReconnectHandler } from "@/app/store/ws";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { imagePasteNumbers, samePasteNumbers } from "./imagepasteids";
import {
    dropLiveId,
    imagePastesByIdAtom,
    lastActivityByIdAtom,
    liveEntriesByIdAtom,
    tasksByIdAtom,
} from "./livetranscriptatoms";
import { projectorFor } from "./transcriptregistry";

const STREAM_TAIL_LINES = 300;
// live-card working set; per-chunk projection runs over this window, not the whole session, so
// cost is O(window) not O(total lines). Full history stays on disk (focus/interior view). Must
// comfortably exceed what the timeline can render (TIMELINE_RENDER_CAP) so the view is always backed.
const MAX_RETAINED_LINES = 4000;

export function capLines(lines: string[], max: number): string[] {
    return lines.length > max ? lines.slice(lines.length - max) : lines;
}
// The server applies a 5s default request timeout (DefaultTimeoutMs) to every RPC, streams
// included — which would tear down the fsnotify watcher during any quiet stretch of an agent's
// work. Pass an effectively-infinite timeout (one year, matching the timeoutYear convention);
// the stream is instead ended explicitly via gen.return() when the panel unmounts.
const STREAM_TIMEOUT_MS = 31536000000;

// The whole-map atoms are defined in livetranscriptatoms.ts (the leaf module also owning the
// per-id slices derived from them); re-exported here so existing consumers importing from
// this file keep working unchanged.
export { lastActivityByIdAtom, liveEntriesByIdAtom, tasksByIdAtom } from "./livetranscriptatoms";

interface StreamHandle {
    stop: () => void;
    path: string;
    agent?: string;
}
const streams = new Map<string, StreamHandle>();

export function startTranscriptStream(id: string, path: string, agent?: string): void {
    if (!path || streams.has(id)) {
        return;
    }
    const projector = projectorFor(agent, path);
    const project = projector.project;
    // Pi's parent-linked active branch cannot be reconstructed from a bounded tail, so it is the
    // only runtime that requests the complete file (taillines -1) and keeps every streamed line
    // while the session is open. Every other runtime tails STREAM_TAIL_LINES and caps retention.
    const isPi = agent?.toLowerCase() === "pi" || path.replace(/\\/g, "/").includes("/.pi/agent/sessions/");
    const tailLines = isPi ? -1 : STREAM_TAIL_LINES;
    const gen = RpcApi.StreamAgentTranscriptCommand(
        TabRpcClient,
        { path, taillines: tailLines },
        { timeout: STREAM_TIMEOUT_MS }
    );
    let cancelled = false;
    const handle: StreamHandle = {
        path,
        agent,
        stop: () => {
            cancelled = true;
            void gen.return?.(undefined);
        },
    };
    streams.set(id, handle);
    let lines: string[] = [];
    void (async () => {
        try {
            for await (const chunk of gen) {
                if (cancelled) {
                    break;
                }
                if (!chunk?.lines?.length) {
                    continue;
                }
                lines.push(...chunk.lines);
                lines = isPi ? lines : capLines(lines, MAX_RETAINED_LINES);
                const entries = project(lines);
                globalStore.set(liveEntriesByIdAtom, { ...globalStore.get(liveEntriesByIdAtom), [id]: entries });
                globalStore.set(lastActivityByIdAtom, { ...globalStore.get(lastActivityByIdAtom), [id]: Date.now() });
                const tasks = projector.extractTasks?.(lines);
                if (tasks != null) {
                    globalStore.set(tasksByIdAtom, { ...globalStore.get(tasksByIdAtom), [id]: tasks });
                }
                // only Claude Code numbers its pasted images; written only when a number is new, so no chunk re-renders
                // the rail for nothing
                if (!isPi) {
                    const pastes = imagePasteNumbers(lines);
                    const known = globalStore.get(imagePastesByIdAtom);
                    if (pastes.size > 0 && !samePasteNumbers(known[id], pastes)) {
                        globalStore.set(imagePastesByIdAtom, { ...known, [id]: pastes });
                    }
                }
            }
        } catch {
            // stream ended or errored — keep the last entries, just stop updating
        } finally {
            // a stale generator (from a stream restarted mid-flight, e.g. on ws reconnect) may
            // resolve after its replacement is already registered; only delete if we're still it
            if (streams.get(id) === handle) {
                streams.delete(id);
            }
        }
    })();
}

// Stops the generator without touching the atoms — used by restartActiveStreams, where the id
// is still wanted and the stale entries should stay visible until the fresh stream re-tails.
function stopStreamOnly(id: string): void {
    const handle = streams.get(id);
    if (!handle) {
        return;
    }
    handle.stop();
    streams.delete(id);
}

export function stopTranscriptStream(id: string): void {
    stopStreamOnly(id);
    dropLiveId(id);
}

// On a websocket reconnect the old generators are hung (a socket drop never errored/returned them),
// and useCardStreams won't re-drive start (its wanted-set is unchanged). Stop every active stream and
// re-open it; the fresh startTranscriptStream re-tails STREAM_TAIL_LINES (a small, acceptable catch-up).
// Uses stopStreamOnly (not stopTranscriptStream) so the last-known entries stay visible instead of
// vanishing and reappearing once the re-tail lands.
export function restartActiveStreams(): void {
    const active = [...streams.entries()].map(([id, h]) => ({ id, path: h.path, agent: h.agent }));
    for (const { id } of active) {
        stopStreamOnly(id);
    }
    for (const { id, path, agent } of active) {
        startTranscriptStream(id, path, agent);
    }
}

addWSReconnectHandler(restartActiveStreams);
if (import.meta.hot) {
    import.meta.hot.dispose(() => removeWSReconnectHandler(restartActiveStreams));
}
