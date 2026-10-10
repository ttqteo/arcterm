// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Pure: the session that started a run with `wsh runs start`, as the run's header and run sheet name it. The run
// keeps that session's tab and transcript; the tab finds it while it lives, the transcript once it has ended. A run
// started from the cockpit has neither. No React, no Wave runtime.

import type { AgentVM } from "./agentsviewmodel";
import { sessionSelection } from "./sessionsruns";

export type RunOrigin =
    | { kind: "live"; tabId: string; name: string }
    // where opening it lands, as showSession takes it
    | { kind: "ended"; name: string; sel: string; member?: string }
    // its tab is closed and Conversation History has no session by its transcript
    | { kind: "gone" };

export function runOrigin(
    run: Pick<Run, "origintabid" | "origintranscript"> | undefined,
    roster: readonly Pick<AgentVM, "id" | "name">[],
    archive: readonly SessionActivity[] | null
): RunOrigin | null {
    if (!run?.origintabid) {
        return null;
    }
    const agent = roster.find((a) => a.id === run.origintabid);
    if (agent != null) {
        return { kind: "live", tabId: agent.id, name: agent.name };
    }
    const session = run.origintranscript ? archive?.find((s) => s.transcriptpath === run.origintranscript) : undefined;
    if (session == null) {
        return { kind: "gone" };
    }
    return { kind: "ended", name: session.task || "an untitled session", ...sessionSelection(session) };
}
