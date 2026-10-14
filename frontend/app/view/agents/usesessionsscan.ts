// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The sidebar's ended sessions come from a 30-day scan over four runtimes' transcript folders (GetSessionsActivity), so it
// never runs at boot: AgentSurface is mounted from the first render, and the scan waits for the Agent surface to be showing
// and for a first paint. It re-runs on each arrival and when an agent leaves the roster (its session just ended), within the
// gaps scanDue allows (rosterSessionKeys: a tab that stays while its session ends counts). No interval: nothing here polls.

import { fireAndForget } from "@/util/util";
import { useEffect, useRef } from "react";
import { agentExited, rosterSessionKeys, scanDue, type ScanReason } from "./agentsidebarmodel";
import type { AgentVM } from "./agentsviewmodel";
import { loadSessionsArchive } from "./sessionsarchivestore";

// after the frame that mounted or revealed the surface has painted
function afterPaint(run: () => void): () => void {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const raf = requestAnimationFrame(() => {
        timer = setTimeout(run, 0);
    });
    return () => {
        cancelAnimationFrame(raf);
        if (timer !== undefined) {
            clearTimeout(timer);
        }
    };
}

export function useSessionsScan(onAgentSurface: boolean, agents: AgentVM[]): void {
    const lastAt = useRef(0);
    // the roster's tabs and transcripts as of the last render, seeded on the first (a lazy init: a ref's initial value is
    // built every render)
    const keys = useRef<Set<string> | null>(null);
    if (keys.current == null) {
        keys.current = rosterSessionKeys(agents);
    }
    // the scan waiting for its frame. It is cancelled only by being replaced or by unmounting, never by an effect re-running:
    // a roster change in the frame after an exit must not drop that exit's scan
    const pending = useRef<() => void>(() => {});
    useEffect(() => () => pending.current(), []);
    // the gap runs from when a scan started, not from when one was scheduled
    const scan = (reason: ScanReason) => {
        if (!scanDue(lastAt.current, Date.now(), reason)) {
            return;
        }
        pending.current();
        pending.current = afterPaint(() => {
            lastAt.current = Date.now();
            fireAndForget(loadSessionsArchive);
        });
    };

    // arriving on the surface (including the first render, when it is the startup surface)
    useEffect(() => {
        if (onAgentSurface) {
            scan("enter");
        }
    }, [onAgentSurface]);

    // an agent exited, or its tab moved on to another session: the transcript it was writing is now an ended session
    const rosterKey = [...rosterSessionKeys(agents)].join(",");
    useEffect(() => {
        const next = rosterSessionKeys(agents);
        const exited = agentExited(keys.current, next);
        keys.current = next;
        if (exited && onAgentSurface) {
            scan("exit");
        }
    }, [rosterKey]);
}
