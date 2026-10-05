// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The sidebar's ended sessions come from a 30-day scan over four runtimes' transcript folders (GetSessionsActivity), so it
// never runs at boot: AgentSurface is mounted from the first render, and the scan waits for the Agent surface to be showing
// and for a first paint. It re-runs on each arrival and when an agent leaves the roster (its session just ended), within the
// gaps scanDue allows. No timer: nothing here polls.

import { fireAndForget } from "@/util/util";
import { useEffect, useRef } from "react";
import { agentExited, scanDue, type ScanReason } from "./agentsidebarmodel";
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
    const ids = useRef<Set<string>>(new Set(agents.map((a) => a.id)));
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

    // an agent exited: the transcript it was writing is now an ended session
    const idsKey = agents.map((a) => a.id).join(",");
    useEffect(() => {
        const next = new Set(agents.map((a) => a.id));
        const exited = agentExited(ids.current, next);
        ids.current = next;
        if (exited && onAgentSurface) {
            scan("exit");
        }
    }, [idsKey]);
}
