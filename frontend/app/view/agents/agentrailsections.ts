// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The Agent details rail's sections: which show, in what order, with which counts. The session block first (its
// context and spend, opening on its token usage and facts), then attention (needs you), then the lists the agent holds
// (subagents, changed files, artifacts, uploads, servers, background tasks), and its run. Every list is counted in the
// tab strip in one fixed order (planRailStats), empty or not, so the rail keeps one shape from agent to agent; the body
// lists only the ones with something in them. Plain terminals are not an agent's: the Agent tree lists them in a
// section of its own.
// Rendered by agentdetailsrail.tsx. A plain terminal has no rail.

import type { RailSectionHeader } from "@/app/element/railsections";
import type { BackgroundTaskStatus } from "./transcriptprojection";

// the lists the tab strip counts, in its order
export type AgentRailStatId = "subagents" | "files" | "artifacts" | "uploads" | "servers" | "bgtasks";

export type AgentRailSectionId = "subagent" | "status" | "needs" | AgentRailStatId | "run";

export interface AgentRailInput {
    inSubagent: boolean; // a subagent's interior is open in place of the parent
    needsYou: number; // the lead's asks owned by the user
    subagents: number;
    files: number | null; // null: not known (loading, or not a git repo)
    // Files changed can switch between the session's changes and the whole branch's, so it lists even while the one
    // shown is empty: the other may not be
    filesSwitchable?: boolean;
    artifacts: number; // the agent's canvas boards
    uploads: number; // files attached to the agent (paste, drop, Attach)
    servers: number; // listening processes in the agent's project
    bgTasks: number;
    hasRun: boolean; // the agent leads or works a run
}

export interface AgentRailSectionPlan {
    id: AgentRailSectionId;
    header?: RailSectionHeader; // absent: the section draws its own heading and does not collapse
}

export interface AgentRailStat {
    id: AgentRailStatId;
    count: number | null; // null: not known (files loading, or not a git repo)
    switchable?: boolean; // an empty list that has another view to switch to still opens (Files changed's branch)
}

export function planRailStats(i: AgentRailInput): AgentRailStat[] {
    if (i.inSubagent) {
        return [];
    }
    return [
        { id: "subagents", count: i.subagents },
        i.filesSwitchable ? { id: "files", count: i.files, switchable: true } : { id: "files", count: i.files },
        { id: "artifacts", count: i.artifacts },
        { id: "uploads", count: i.uploads },
        { id: "servers", count: i.servers },
        { id: "bgtasks", count: i.bgTasks },
    ];
}

// railStatAction is what a strip count does when clicked: open its section, which the body lists exactly when this is
// "open"; attach files, for an empty Uploads, whose section would hold only the Attach button; or nothing
export function railStatAction(s: AgentRailStat): "open" | "attach" | null {
    if (s.count !== 0 || s.switchable) {
        return "open";
    }
    return s.id === "uploads" ? "attach" : null;
}

export function planAgentRail(i: AgentRailInput): AgentRailSectionPlan[] {
    const out: AgentRailSectionPlan[] = [];
    if (i.inSubagent) {
        out.push({ id: "subagent" });
    }
    out.push({ id: "status" });
    if (!i.inSubagent && i.needsYou > 0) {
        out.push({ id: "needs" });
    }
    for (const s of planRailStats(i)) {
        if (railStatAction(s) === "open") {
            out.push({ id: s.id, header: s.count == null ? {} : { count: s.count } });
        }
    }
    if (!i.inSubagent && i.hasRun) {
        out.push({ id: "run" });
    }
    return out;
}

export type BgTaskLabel = BackgroundTaskStatus | "unknown";

// a task the transcript never resolved is only known to be running while its session is
export function bgTaskStatusLabel(status: BackgroundTaskStatus, live: boolean): BgTaskLabel {
    return status === "running" && !live ? "unknown" : status;
}
