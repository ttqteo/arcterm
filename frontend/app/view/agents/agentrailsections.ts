// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The Agent details rail's sections: which show, in what order, with which counts. Attention first (needs you,
// subagents, changed files), then what the agent holds (artifacts, uploads, background tasks, terminals), then what
// it did (tools), its run, and the facts last, closed by default. Counted sections stay listed at 0 so the rail
// keeps one shape from agent to agent. Rendered by agentdetailsrail.tsx; a focused terminal's rail is
// planTerminalRail, rendered by terminalsrail.tsx.

import type { RailSectionHeader } from "@/app/element/railsections";
import type { BackgroundTaskStatus } from "./transcriptprojection";

export type AgentRailSectionId =
    | "subagent"
    | "needs"
    | "subagents"
    | "files"
    | "artifacts"
    | "uploads"
    | "bgtasks"
    | "terminals"
    | "tools"
    | "run"
    | "details"
    | "usage";

export interface AgentRailInput {
    inSubagent: boolean; // a subagent's interior is open in place of the parent
    needsYou: number; // the lead's asks owned by the user
    subagents: number;
    files: number | null; // null: not known (loading, or not a git repo)
    artifacts: number; // the agent's canvas boards
    uploads: number; // files attached to the agent (paste, drop, Attach)
    bgTasks: number;
    terminals: number; // plain terminals the rail lists: the agent's project's, or all of them on request
    terminalsOther: number; // plain terminals that belong to another project
    tools: number;
    hasRun: boolean; // the agent leads or works a run
}

export interface AgentRailSectionPlan {
    id: AgentRailSectionId;
    header?: RailSectionHeader; // absent: the section draws its own heading and does not collapse
}

// Uploads is the one counted section whose empty state carries an action (Attach), so it stays openable at 0;
// it starts closed until it has something in it
function uploadsHeader(uploads: number): RailSectionHeader {
    return { count: uploads, emptyOpenable: true, defaultOpen: uploads > 0 };
}

// Terminals goes inert at 0 like any counted section, unless other projects have terminals: its empty state then
// offers to show them
function terminalsHeader(terminals: number, other: number): RailSectionHeader {
    return terminals === 0 && other > 0 ? { count: terminals, emptyOpenable: true } : { count: terminals };
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
        out.push({ id: "artifacts", header: { count: i.artifacts } });
        out.push({ id: "uploads", header: uploadsHeader(i.uploads) });
        out.push({ id: "bgtasks", header: { count: i.bgTasks } });
        out.push({ id: "terminals", header: terminalsHeader(i.terminals, i.terminalsOther) });
    }
    out.push({ id: "tools", header: { count: i.tools } });
    if (!i.inSubagent && i.hasRun) {
        out.push({ id: "run" });
    }
    out.push({ id: "details", header: { defaultOpen: false } });
    out.push({ id: "usage", header: { defaultOpen: false } });
    return out;
}

// A focused terminal has no tools, files, run or usage of its own: its rail is the list that gets you to another
// terminal, so the Terminals section is all of it
export function planTerminalRail(i: { terminals: number; terminalsOther: number }): AgentRailSectionPlan[] {
    return [{ id: "terminals", header: terminalsHeader(i.terminals, i.terminalsOther) }];
}

export type BgTaskLabel = BackgroundTaskStatus | "unknown";

// a task the transcript never resolved is only known to be running while its session is
export function bgTaskStatusLabel(status: BackgroundTaskStatus, live: boolean): BgTaskLabel {
    return status === "running" && !live ? "unknown" : status;
}
