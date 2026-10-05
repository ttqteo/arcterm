// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The Agent details rail's sections: which show, in what order, with which counts. Attention first (needs you,
// subagents, changed files, background tasks), then what the agent did (tools), its run, and the facts last,
// closed by default. Counted sections stay listed at 0 so the rail keeps one shape from agent to agent.
// Rendered by agentdetailsrail.tsx.

import type { RailSectionHeader } from "@/app/element/railsections";
import type { BackgroundTaskStatus } from "./transcriptprojection";

export type AgentRailSectionId =
    | "subagent"
    | "needs"
    | "subagents"
    | "files"
    | "bgtasks"
    | "tools"
    | "run"
    | "details"
    | "usage";

export interface AgentRailInput {
    inSubagent: boolean; // a subagent's interior is open in place of the parent
    needsYou: number; // the lead's asks owned by the user
    subagents: number;
    files: number | null; // null: not known (loading, or not a git repo)
    bgTasks: number;
    tools: number;
    hasRun: boolean; // the agent leads or works a run
}

export interface AgentRailSectionPlan {
    id: AgentRailSectionId;
    header?: RailSectionHeader; // absent: the section draws its own heading and does not collapse
}

export function planAgentRail(i: AgentRailInput): AgentRailSectionPlan[] {
    const out: AgentRailSectionPlan[] = [];
    if (i.inSubagent) {
        out.push({ id: "subagent" });
    } else {
        if (i.needsYou > 0) {
            out.push({ id: "needs" });
        }
        out.push({ id: "subagents", header: { count: i.subagents } });
        out.push({ id: "files", header: i.files == null ? {} : { count: i.files } });
        out.push({ id: "bgtasks", header: { count: i.bgTasks } });
    }
    out.push({ id: "tools", header: { count: i.tools } });
    if (!i.inSubagent && i.hasRun) {
        out.push({ id: "run" });
    }
    out.push({ id: "details", header: { defaultOpen: false } });
    out.push({ id: "usage", header: { defaultOpen: false } });
    return out;
}

export type BgTaskLabel = BackgroundTaskStatus | "unknown";

// a task the transcript never resolved is only known to be running while its session is
export function bgTaskStatusLabel(status: BackgroundTaskStatus, live: boolean): BgTaskLabel {
    return status === "running" && !live ? "unknown" : status;
}
