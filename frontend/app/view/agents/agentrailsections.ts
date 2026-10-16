// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The Agent details rail's sections: which show, in what order, with which counts. A plan waiting for review first,
// then the session block (its context and spend, opening on its token usage and facts), then attention (needs you),
// then the lists the agent holds (ideas from a brainstorm, subagents, changed files, artifacts, uploads, servers,
// background tasks), and its run. The tab strip counts, in one fixed order (planRailStats), only the lists a click can
// act on: an empty one would crowd the strip past the rail's 300px and clip its last icons. The body lists the ones
// with something in them. Plain terminals are not an agent's: the Agent tree lists them in a section of its own.
// Rendered by agentdetailsrail.tsx. A plain terminal has no rail.

import type { RailSectionHeader } from "@/app/element/railsections";
import type { BackgroundTaskStatus } from "./transcriptprojection";

// the lists the tab strip counts, in its order
export type AgentRailStatId = "ideas" | "subagents" | "files" | "artifacts" | "uploads" | "servers" | "bgtasks";

export type AgentRailSectionId = "plan" | "subagent" | "status" | "needs" | AgentRailStatId | "run";

export interface AgentRailInput {
    inSubagent: boolean; // a subagent's interior is open in place of the parent
    // the rows of the agent's Plan to review: its initiative's proposed chunks, and ones just decided that stay for Undo
    proposed: number;
    needsYou: number; // the lead's asks owned by the user
    ideas: number; // the session's ideas not dropped (ideasmodel.ts)
    ideasFresh: number; // of those, the ones added since the user last marked the list read
    // the user asked for the Add an idea box (the capture shortcut with nothing selected) on a session with no ideas yet:
    // the section is listed, open, so the box exists. The strip still counts none.
    ideasRequested?: boolean;
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
    fresh?: boolean; // Ideas only: some of them are new, so the count carries a dot
    newCount?: number; // Ideas only: how many, for the count's tooltip
}

export function planRailStats(i: AgentRailInput): AgentRailStat[] {
    if (i.inSubagent) {
        return [];
    }
    const all: AgentRailStat[] = [
        { id: "ideas", count: i.ideas, fresh: i.ideasFresh > 0, newCount: i.ideasFresh },
        { id: "subagents", count: i.subagents },
        i.filesSwitchable ? { id: "files", count: i.files, switchable: true } : { id: "files", count: i.files },
        { id: "artifacts", count: i.artifacts },
        { id: "uploads", count: i.uploads },
        { id: "servers", count: i.servers },
        { id: "bgtasks", count: i.bgTasks },
    ];
    return all.filter((s) => railStatAction(s) != null);
}

// railStatAction is what a strip count does when clicked: open its section, which the body lists exactly when this is
// "open"; attach files, for an empty Uploads, whose section would hold only the Attach button; or nothing
export function railStatAction(s: AgentRailStat): "open" | "attach" | null {
    if (s.count !== 0 || s.switchable) {
        return "open";
    }
    return s.id === "uploads" ? "attach" : null;
}

// railStatClick is what a strip count's "open" does to its section: close it when it is open and its header row is on
// the rail's screen, else open it and bring it into view; closing one scrolled out of sight would look like nothing
// happened. head is undefined while Overview is not showing the section.
export function railStatClick(
    open: boolean,
    head: { top: number; bottom: number } | undefined,
    view: { top: number; bottom: number }
): "close" | "open" {
    return open && head != null && head.top >= view.top && head.bottom <= view.bottom ? "close" : "open";
}

export function planAgentRail(i: AgentRailInput): AgentRailSectionPlan[] {
    const out: AgentRailSectionPlan[] = [];
    // a plan waiting on the person is the first thing the rail shows; it draws its own heading and does not collapse
    if (!i.inSubagent && i.proposed > 0) {
        out.push({ id: "plan" });
    }
    if (i.inSubagent) {
        out.push({ id: "subagent" });
    }
    out.push({ id: "status" });
    if (!i.inSubagent && i.needsYou > 0) {
        out.push({ id: "needs" });
    }
    const stats = planRailStats(i);
    if (!i.inSubagent && i.ideasRequested && !stats.some((s) => s.id === "ideas")) {
        out.push({ id: "ideas", header: { defaultOpen: true } });
    }
    for (const s of stats) {
        if (railStatAction(s) === "open") {
            const header: RailSectionHeader = s.count == null ? {} : { count: s.count };
            // Ideas waits closed: its count and dot say something is there, and the click opens it
            out.push({ id: s.id, header: s.id === "ideas" ? { ...header, defaultOpen: false } : header });
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

// a running task of a live session with a command and a terminal block to find its process in can be stopped
export function bgTaskStoppable(task: { status: BackgroundTaskStatus; command?: string }, live: boolean): boolean {
    return task.status === "running" && live && (task.command ?? "") !== "";
}

/** Pure: what to tell the user after stopping a background task, or null when the row turning "stopped" says it. */
export function bgTaskStopNote(r: { outcome: string; error?: string }, label: string): string | null {
    switch (r.outcome) {
        case "killed":
            return null;
        case "gone":
            return `"${label}" had already ended.`;
        case "failed":
            // the OS text ends in its own period
            return `Could not stop "${label}"${r.error ? `: ${r.error.replace(/\.$/, "")}` : ""}.`;
        default:
            return `Not stopped: "${label}" is not a process of this agent's tab.`;
    }
}
