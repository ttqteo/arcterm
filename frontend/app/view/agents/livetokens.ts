// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Pure: when a live agent's token total, shown on its Active row as an ended session's is on its Conversations row, is
// read again. A total moves only when a turn ends, so it is read when an agent is first seen with a transcript, when a
// turn ends (it leaves "working"), and when it starts writing another transcript (/clear, a resume). No React.

import type { AgentState, AgentVM } from "./agentsviewmodel";

export interface TokenWatch {
    path: string;
    state: AgentState;
}

export function watchOf(agents: AgentVM[]): Map<string, TokenWatch> {
    const out = new Map<string, TokenWatch>();
    for (const a of agents) {
        if (a.transcriptPath) {
            out.set(a.id, { path: a.transcriptPath, state: a.state });
        }
    }
    return out;
}

export function tokenReloads(prev: ReadonlyMap<string, TokenWatch>, agents: AgentVM[]): string[] {
    const out: string[] = [];
    for (const a of agents) {
        if (!a.transcriptPath) {
            continue;
        }
        const was = prev.get(a.id);
        if (was == null || was.path !== a.transcriptPath || (was.state === "working" && a.state !== "working")) {
            out.push(a.id);
        }
    }
    return out;
}
