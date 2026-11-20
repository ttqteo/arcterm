// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The Agent details rail's sections: which show, in what order, with which counts. The session block first (its context
// and spend, opening on its token usage and facts), then attention (needs you),
// then the Verify tile when the agent ran a scenario or changed a watched UI file, then the lists the agent holds (subagents, changed files, artifacts, uploads, servers, background tasks), and its
// run. The tab strip counts, in one fixed order (planRailStats), only the lists a click can
// act on: an empty one would crowd the strip past the rail's 300px and clip its last icons. The body lists the ones
// with something in them. Plain terminals are not an agent's: the Agent tree lists them in a section of its own.
// Rendered by agentdetailsrail.tsx. A plain terminal has no rail.

import type { RailSectionHeader } from "@/app/element/railsections";
import { stepElapsed } from "./chatsteps";
import type { BackgroundTaskStatus } from "./transcriptprojection";
import type { VerifyTileVM } from "./verifymodel";

// the counts the tab strip draws, in its order. Verify is the odd one: not a list but the agent's scenario results (the tile
// after Needs you, railverify.tsx), so its stat carries the tile's own strip figures in place of a count
export type AgentRailStatId = "subagents" | "files" | "artifacts" | "uploads" | "servers" | "bgtasks" | "verify";

export type AgentRailSectionId = "subagent" | "status" | "needs" | AgentRailStatId | "run";

// what the strip draws for Verify: the tile's own strip (verifymodel.ts), never null once there is a tile
export type RailVerifyStrip = NonNullable<VerifyTileVM["strip"]>;

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
    // the Verify tile's strip (verifyTile(...).strip); null or absent: the agent has no tile, so neither the tile nor its count
    verify?: VerifyTileVM["strip"];
}

export interface AgentRailSectionPlan {
    id: AgentRailSectionId;
    header?: RailSectionHeader; // absent: the section draws its own heading and does not collapse
}

export interface AgentRailStat {
    id: AgentRailStatId;
    count: number | null; // null: not known (files loading, or not a git repo); always null for Verify
    switchable?: boolean; // an empty list that has another view to switch to still opens (Files changed's branch)
    verify?: RailVerifyStrip; // Verify only: the icon's tone and the label ("2", "!") in place of a count
}

export function planRailStats(i: AgentRailInput): AgentRailStat[] {
    if (i.inSubagent) {
        return [];
    }
    const all: AgentRailStat[] = [
        { id: "subagents", count: i.subagents },
        i.filesSwitchable ? { id: "files", count: i.files, switchable: true } : { id: "files", count: i.files },
        { id: "artifacts", count: i.artifacts },
        { id: "uploads", count: i.uploads },
        { id: "servers", count: i.servers },
        { id: "bgtasks", count: i.bgTasks },
    ];
    // Verify's count comes last, after Background tasks; with no tile there is nothing to count
    if (i.verify != null) {
        all.push({ id: "verify", count: null, verify: i.verify });
    }
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
    if (i.inSubagent) {
        out.push({ id: "subagent" });
    }
    out.push({ id: "status" });
    if (!i.inSubagent && i.needsYou > 0) {
        out.push({ id: "needs" });
    }
    // the Verify tile is drawn like the session block, not as a folded section: it cannot scroll out of sight under the
    // lists, and it draws its own heading. Its strip count is the last of the stats, so it is left out of the loop below
    if (!i.inSubagent && i.verify != null) {
        out.push({ id: "verify" });
    }
    for (const s of planRailStats(i)) {
        if (s.id !== "verify" && railStatAction(s) === "open") {
            const header: RailSectionHeader = s.count == null ? {} : { count: s.count };
            out.push({ id: s.id, header });
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

/** Pure: the Background tasks section's two groups, newest first in each, as Claude Desktop's panel has them: Running,
 *  and Finished, which takes a task a session that is gone left running (bgTaskStatusLabel's unknown: nothing runs it). */
export function bgTaskGroups<T extends { status: BackgroundTaskStatus }>(
    tasks: readonly T[],
    live: boolean
): { running: T[]; finished: T[] } {
    const newest = [...tasks].reverse();
    return {
        running: newest.filter((t) => bgTaskStatusLabel(t.status, live) === "running"),
        finished: newest.filter((t) => bgTaskStatusLabel(t.status, live) !== "running"),
    };
}

/** Pure: how long a task ran ("2m 7s"), a running one up to `now`; "" when its start is not known. */
export function bgTaskElapsed(task: { startMs?: number; endMs?: number }, now: number): string {
    if (task.startMs == null) {
        return "";
    }
    return stepElapsed((task.endMs ?? now) - task.startMs);
}

/** Pure: the session a background task belongs to is live, as the details rail and the Agent tree's task peek both read
 *  it: it has a terminal block to find the task's process in, and it is not an ended worker shown from its record (the
 *  rail's ended worker; for the peek, an agent gone from the roster). */
export function bgSessionLive(blockId: string | undefined, ended: boolean): boolean {
    return blockId != null && !ended;
}

// a running task of a live session (bgSessionLive) with a command can be stopped
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
