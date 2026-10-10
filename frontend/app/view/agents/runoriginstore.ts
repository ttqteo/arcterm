// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// The session a run was started from, read for the agent header and the run sheet, and the one way to open it.

import { openTarget } from "@/app/view/jarvis/openref";
import { fireAndForget } from "@/util/util";
import { useAtomValue } from "jotai";
import { useEffect } from "react";
import { showSession } from "./agentcenter";
import type { AgentsViewModel } from "./agents";
import { runOrigin, type RunOrigin } from "./runorigin";
import { loadSessionsArchive, sessionsArchiveAtom } from "./sessionsarchivestore";

export function useRunOrigin(model: AgentsViewModel, run: Run | undefined): RunOrigin | null {
    const roster = useAtomValue(model.agentsAtom);
    const archive = useAtomValue(sessionsArchiveAtom);
    const origin = runOrigin(run, roster, archive);
    // an ended session is found in Conversation History, which may not have been scanned yet
    const scan = origin?.kind === "gone" && archive == null;
    useEffect(() => {
        if (scan) {
            fireAndForget(loadSessionsArchive);
        }
    }, [scan]);
    return origin;
}

// openRunOrigin goes to the session: its terminal while it lives, its transcript once it has ended
export function openRunOrigin(model: AgentsViewModel, origin: RunOrigin): void {
    if (origin.kind === "live") {
        fireAndForget(() => openTarget(model, { kind: "agent", tabId: origin.tabId }));
    } else if (origin.kind === "ended") {
        showSession(model, origin.sel, origin.member);
    }
}
