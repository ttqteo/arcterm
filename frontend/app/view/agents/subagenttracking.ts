// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Load each agent's disk-backed subagents into subagentsByIdAtom: refresh on enter, debounce on parent
// transcript activity or a parent state change, poll while a child still reads as working, drop on leave.
// Extracted from agenttree so the cockpit grid and the Runs surface populate the store the same way instead of
// each copying the effect. Safe to mount on more than one surface at once: refreshSubagents is seq-guarded and
// dropSubagents only clears ids this caller tracked.

import { useAtomValue } from "jotai";
import { useEffect, useRef } from "react";
import { lastActivityByIdAtom } from "./livetranscript";
import { statusChangedIds, WORKING_CHILD_POLL_MS, workingChildIds, type StatusTrackable } from "./subagentrefresh";
import { dropSubagents, refreshSubagents, scheduleSubagents, subagentsByIdAtom } from "./subagentsstore";

type Trackable = StatusTrackable & { transcriptPath?: string };

export function useSubagentTracking(agents: Trackable[]): void {
    const lastActivity = useAtomValue(lastActivityByIdAtom);
    const subs = useAtomValue(subagentsByIdAtom);
    const trackedRef = useRef<Set<string>>(new Set());
    const statusRef = useRef<Map<string, string>>(new Map());
    const agentsRef = useRef(agents);
    agentsRef.current = agents;
    const idsKey = agents.map((a) => a.id).join(",");
    useEffect(() => {
        const now = new Set(agents.map((a) => a.id));
        for (const a of agents) {
            if (!trackedRef.current.has(a.id)) {
                void refreshSubagents(a.id, a.transcriptPath);
            }
        }
        for (const id of trackedRef.current) {
            if (!now.has(id)) {
                dropSubagents(id);
            }
        }
        trackedRef.current = now;
    }, [idsKey]);
    useEffect(() => {
        for (const a of agents) {
            if (lastActivity[a.id]) {
                scheduleSubagents(a.id, a.transcriptPath);
            }
        }
    }, [lastActivity]);
    // the Agent surface streams no transcript, so its sidebar hears of a parent only through its state
    useEffect(() => {
        const changed = new Set(statusChangedIds(statusRef.current, agents));
        for (const a of agents) {
            if (changed.has(a.id)) {
                scheduleSubagents(a.id, a.transcriptPath);
            }
        }
    });
    const pollKey = workingChildIds(agents, subs).join(",");
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
