// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Load each agent's disk-backed subagents into subagentsByIdAtom: refresh on enter, debounce on parent
// transcript activity, drop on leave. Extracted from agenttree so the cockpit grid and the Runs surface
// populate the store the same way instead of each copying the effect. Safe to mount on more than one
// surface at once: refreshSubagents is seq-guarded and dropSubagents only clears ids this caller tracked.

import { useAtomValue } from "jotai";
import { useEffect, useRef } from "react";
import { lastActivityByIdAtom } from "./livetranscript";
import { dropSubagents, refreshSubagents, scheduleSubagents } from "./subagentsstore";

type Trackable = { id: string; transcriptPath?: string };

export function useSubagentTracking(agents: Trackable[]): void {
    const lastActivity = useAtomValue(lastActivityByIdAtom);
    const trackedRef = useRef<Set<string>>(new Set());
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
}
