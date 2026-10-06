// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Pure: what the agent peek body says. No React, and no terminal: the peek shows the agent's facts and leaves the
// terminal to the Agent surface.

import { filesSummary } from "@/app/view/agents/agentrailmodel";
import type { AgentVM } from "@/app/view/agents/agentsviewmodel";
import { focusForAgent } from "@/app/view/agents/focusfor";
import type { GitChange } from "@/app/view/agents/gitstatus";
import type { PeekFacts } from "../peekstore";

export type GridRow = { label: string; value: string; mono: boolean };

type GridInput = { project?: string; branch?: string; cwd?: string; model?: string; session?: string };

// mockup order; a value nobody knows is left out rather than printed
const GRID: { key: keyof GridInput; label: string; mono: boolean }[] = [
    { key: "project", label: "project", mono: false },
    { key: "branch", label: "branch", mono: false },
    { key: "cwd", label: "cwd", mono: false },
    { key: "model", label: "model", mono: false },
    { key: "session", label: "session", mono: true },
];

export function agentGridRows(input: GridInput): GridRow[] {
    return GRID.flatMap(({ key, label, mono }) => {
        const value = input[key];
        return value ? [{ label, value, mono }] : [];
    });
}

export function changedFilesSummary(files: GitChange[]): string {
    return filesSummary(files);
}

// the pi control-channel id when there is one, else the transcript's file name, which is the session's id
export function sessionLabel(agent: Pick<AgentVM, "sessionId" | "transcriptPath">): string | undefined {
    if (agent.sessionId) {
        return agent.sessionId;
    }
    const file = agent.transcriptPath?.split(/[\\/]/).pop();
    return file ? file.replace(/\.jsonl$/, "") : undefined;
}

export function agentPeekFacts(agent: AgentVM | undefined): PeekFacts {
    return agent == null ? { gone: true, focus: null } : { gone: false, focus: focusForAgent(agent) };
}
