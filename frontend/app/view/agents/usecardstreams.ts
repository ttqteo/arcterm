// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Shared card-stream lifecycle. The transcript streams (livetranscript) and per-card git tracking
// (cardgitstore) are module-level, idempotent singletons; this hook is the React driver that starts
// what's wanted, stops what's no longer wanted, and tears everything down on unmount. cockpitsurface
// drives it with trackGit (transcript + git + debounced-on-activity git reload); runbody drives it
// transcript-only. The two surfaces never co-mount, so stream ownership never collides.

import { useAtomValue } from "jotai";
import { useEffect, useRef } from "react";
import { dropCardGit, refreshCardGit, scheduleCardGit } from "./cardgitstore";
import { lastActivityByIdAtom, startTranscriptStream, stopTranscriptStream } from "./livetranscript";

export type WantedCard = { id: string; path: string; agent?: string; blockId?: string };

// pure: given the currently-streamed ids (-> the path each streams) and the wanted cards, which to start and
// which to stop. an id whose path changed (/clear opens a new transcript under the same agent) is in both: stop
// it, then start it on the new file. dedups wanted ids (last path wins); order follows wanted (start) / current
// insertion (stop).
export function diffStreamSet(
    current: Map<string, string>,
    wanted: { id: string; path: string }[]
): { toStart: string[]; toStop: string[] } {
    const wantedPaths = new Map(wanted.map((w) => [w.id, w.path]));
    const toStart: string[] = [];
    for (const [id, path] of wantedPaths) {
        if (current.get(id) !== path) {
            toStart.push(id);
        }
    }
    const toStop: string[] = [];
    for (const [id, path] of current) {
        if (wantedPaths.get(id) !== path) {
            toStop.push(id);
        }
    }
    return { toStart, toStop };
}

export function useCardStreams(wanted: WantedCard[], opts?: { trackGit?: boolean }): void {
    const trackGit = !!opts?.trackGit;
    const streamedRef = useRef<Map<string, string>>(new Map());
    const gitTrackedRef = useRef<Map<string, { path?: string; blockId?: string }>>(new Map());
    const gitSeenActivityRef = useRef<Map<string, number>>(new Map());
    const lastActivityById = useAtomValue(lastActivityByIdAtom);

    const wantedKey = wanted.map((w) => `${w.id}=${w.path}`).join(",");
    useEffect(() => {
        const byId = new Map<string, WantedCard>();
        for (const w of wanted) {
            byId.set(w.id, w);
        }
        const { toStart, toStop } = diffStreamSet(streamedRef.current, [...byId.values()]);
        // stops first: a restarted id must be gone before its start, which is a no-op for a live stream
        for (const id of toStop) {
            stopTranscriptStream(id);
            streamedRef.current.delete(id);
            if (trackGit) {
                gitTrackedRef.current.delete(id);
                gitSeenActivityRef.current.delete(id);
                dropCardGit(id);
            }
        }
        for (const id of toStart) {
            const w = byId.get(id)!;
            startTranscriptStream(id, w.path, w.agent);
            streamedRef.current.set(id, w.path);
            if (trackGit) {
                gitTrackedRef.current.set(id, { path: w.path, blockId: w.blockId });
                void refreshCardGit(id, w.path, w.blockId);
            }
        }
    }, [wantedKey, trackGit]);

    // debounced git re-load when a tracked card narrates. First sighting adopts the current activity
    // stamp as baseline (the enter-time refresh already covered that state) so only advances schedule.
    useEffect(() => {
        if (!trackGit) {
            return;
        }
        for (const [id, meta] of gitTrackedRef.current) {
            const ts = lastActivityById[id];
            if (ts == null) {
                continue;
            }
            const seen = gitSeenActivityRef.current.get(id);
            if (seen == null) {
                gitSeenActivityRef.current.set(id, ts);
                continue;
            }
            if (ts > seen) {
                gitSeenActivityRef.current.set(id, ts);
                scheduleCardGit(id, meta.path, meta.blockId);
            }
        }
    }, [lastActivityById, trackGit]);

    useEffect(() => {
        return () => {
            for (const id of streamedRef.current.keys()) {
                stopTranscriptStream(id);
                if (trackGit) {
                    dropCardGit(id);
                }
            }
            streamedRef.current.clear();
            gitTrackedRef.current.clear();
            gitSeenActivityRef.current.clear();
        };
    }, []);
}
