// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// A project's Overview (agentcenter.ts' `project` mode), as data: its agents that ask, what in it is at work, and the
// words the header and the rows read. Pure; projectoverview.tsx draws it.

import { projectOf, sortAgents, type AgentVM } from "./agentsviewmodel";

export interface OverviewRows {
    asking: AgentVM[]; // the project's agents asking, longest-blocked first
    working: AgentVM[]; // its agents at work; a lead counts, its run being its agent
    terminals: AgentVM[]; // its terminals running a command
}

export function overviewRows(agents: readonly AgentVM[], terminals: readonly AgentVM[], project: string): OverviewRows {
    const mine = sortAgents(agents.filter((a) => a.kind !== "terminal" && projectOf(a) === project));
    return {
        asking: mine.filter((a) => a.state === "asking"),
        working: mine.filter((a) => a.state === "working"),
        terminals: terminals.filter((t) => t.running === true && projectOf(t) === project),
    };
}

// what an asking agent asks, or why it waits when its ask carries no question
export function askLine(a: AgentVM): string {
    return a.ask?.questions?.[0]?.question ?? a.activity ?? "";
}

// what an agent is doing now; a terminal's name is already the command it runs, so its row says only what it is
export function doingLine(a: AgentVM): string {
    if (a.kind === "terminal") {
        return "terminal";
    }
    return a.activity || a.task || "";
}

// nothing waits and nothing runs: the page says so in one line instead of drawing two empty blocks
export function isQuiet(rows: OverviewRows, waiting: number): boolean {
    return waiting === 0 && rows.asking.length === 0 && rows.working.length === 0 && rows.terminals.length === 0;
}

// the header's change count, its adds and dels drawn beside it; null (no repo, not read yet) says nothing
export function changesLabel(stats: { files: number } | null): string {
    if (stats == null) {
        return "";
    }
    return stats.files === 0 ? "no uncommitted changes" : `${stats.files} ${stats.files === 1 ? "file" : "files"}`;
}
