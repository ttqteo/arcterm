// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Load each agent's disk-backed subagents into subagentsByIdAtom (and its background tasks into
// backgroundTasksByIdAtom): refresh on enter and when its transcript path changes, debounce on parent transcript
// activity or a parent state change, poll while a child or a background task still reads as working, drop on leave.
// The shell (cockpitshell AgentStreams) is its one caller, over the roster on every surface. Safe to mount in more
// than one place at once: refreshSubagents is seq-guarded and dropSubagents only clears ids this caller tracked.

import { useAtomValue } from "jotai";
import { useEffect, useRef } from "react";
import { lastActivityByIdAtom } from "./livetranscript";
import {
    backgroundRunningIds,
    statusChangedIds,
    WORKING_CHILD_POLL_MS,
    workingChildIds,
    type StatusTrackable,
} from "./subagentrefresh";
import {
    backgroundTasksByIdAtom,
    dropSubagents,
    refreshSubagents,
    scheduleSubagents,
    subagentsByIdAtom,
} from "./subagentsstore";

type Trackable = StatusTrackable & { transcriptPath?: string };

// pure: the ids to read on entering tracking: new ids, and tracked ids whose transcript path changed (a launch
// whose path arrives after it entered)
export function enterRefreshes(tracked: Map<string, string | undefined>, agents: Trackable[]): string[] {
    return agents.filter((a) => !tracked.has(a.id) || tracked.get(a.id) !== a.transcriptPath).map((a) => a.id);
}

export function useSubagentTracking(agents: Trackable[]): void {
    const lastActivity = useAtomValue(lastActivityByIdAtom);
    const subs = useAtomValue(subagentsByIdAtom);
    const bg = useAtomValue(backgroundTasksByIdAtom);
    const trackedRef = useRef<Map<string, string | undefined>>(new Map());
    const statusRef = useRef<Map<string, string>>(new Map());
    const agentsRef = useRef(agents);
    agentsRef.current = agents;
    const enterKey = agents.map((a) => `${a.id}=${a.transcriptPath ?? ""}`).join(",");
    useEffect(() => {
        const byId = new Map(agents.map((a) => [a.id, a]));
        for (const id of enterRefreshes(trackedRef.current, agents)) {
            const a = byId.get(id)!;
            void refreshSubagents(a.id, a.transcriptPath);
        }
        for (const id of trackedRef.current.keys()) {
            if (!byId.has(id)) {
                dropSubagents(id);
            }
        }
        trackedRef.current = new Map(agents.map((a) => [a.id, a.transcriptPath]));
    }, [enterKey]);
    useEffect(() => {
        for (const a of agents) {
            if (lastActivity[a.id]) {
                scheduleSubagents(a.id, a.transcriptPath);
            }
        }
    }, [lastActivity]);
    // an agent the shell does not stream (idle past its grace, not focused) stamps no activity, so its sidebar hears
    // of such a parent only through its state
    useEffect(() => {
        const changed = new Set(statusChangedIds(statusRef.current, agents));
        for (const a of agents) {
            if (changed.has(a.id)) {
                scheduleSubagents(a.id, a.transcriptPath);
            }
        }
    });
    const pollKey = [...new Set([...workingChildIds(agents, subs), ...backgroundRunningIds(agents, bg)])].join(",");
    useEffect(() => {
        if (!pollKey) {
            return;
        }
        const ids = new Set(pollKey.split(","));
        const timer = setInterval(() => {
            for (const a of agentsRef.current) {
                if (ids.has(a.id)) {
                    void refreshSubagents(a.id, a.transcriptPath);
                }
            }
        }, WORKING_CHILD_POLL_MS);
        return () => clearInterval(timer);
    }, [pollKey]);
}
