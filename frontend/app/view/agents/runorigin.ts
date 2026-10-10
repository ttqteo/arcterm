// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Pure: the session that started a run with `wsh runs start`, as the run's header and run sheet name it, and the
// other way round, the runs a session started, as its header lists them. The run keeps that session's tab and
// transcript; the tab finds it while it lives, the transcript once it has ended. A run started from the cockpit has
// neither. No React, no Wave runtime.

import type { AgentVM } from "./agentsviewmodel";
import { isTerminal } from "./runmodel";
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

// runsStartedBy is every run this session started, the ones still going first, then the newest. The tab outlives its
// session, so a run whose origin transcript is another session's was started by an earlier one in the same tab.
export function runsStartedBy(agent: Pick<AgentVM, "id" | "transcriptPath">, runs: readonly Run[]): Run[] {
    return runs
        .filter(
            (r) =>
                r.origintabid === agent.id &&
                (!r.origintranscript || !agent.transcriptPath || r.origintranscript === agent.transcriptPath)
        )
        .sort(
            (a, b) =>
                Number(isTerminal(a.status)) - Number(isTerminal(b.status)) || (b.createdts ?? 0) - (a.createdts ?? 0)
        );
}

// startedRunsText is what the header says for them: one run by its goal, several by how many and how many still go
export function startedRunsText(runs: readonly Pick<Run, "goal" | "status">[]): string {
    if (runs.length === 1) {
        return runs[0].goal?.trim().split("\n")[0] || "an untitled run";
    }
    const active = runs.filter((r) => !isTerminal(r.status)).length;
    return active > 0 ? `${runs.length} runs, ${active} active` : `${runs.length} runs`;
}
