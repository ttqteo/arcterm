// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// A project's Overview (agentcenter.ts' `project` mode), as data: its agents that ask, what in it is at work (its
// runs grouped, as the Agent tree groups them), what finished unread, and the History rows (ended sessions, councils
// and runs of the last 7 days, a session's runs and councils nested under it) with the words the header and the rows
// read. Pure; projectoverview.tsx draws it.

import { projectOf, sortAgents, type AgentVM } from "./agentsviewmodel";
import { groupRunAgents, runningAgents, UNGROUPED_PROJECT } from "./agenttreemodel";
import { normProjectPath } from "./channelderive";
import { NO_LINEAGE, roleRunId, type Lineage, type RunInfo } from "./runlineage";
import type { LiveSession } from "./sessionsarchivestore";
import { sessionKey } from "./sessionsruns";

export interface RunRow {
    run: RunInfo;
    lead?: AgentVM; // the run's lead, when it is in the roster
    working: number; // its members the Agent tree counts as running, the lead included
    total: number; // its members in the roster, the lead included
}

export interface OverviewRows {
    asking: AgentVM[]; // the project's agents asking, a run's members included, longest-blocked first
    working: AgentVM[]; // its plain agents at work (no part in a run)
    terminals: AgentVM[]; // its terminals running a command
    runs: RunRow[]; // its runs with a member at work, one row each
}

// a run's workers and stage sessions have a worktree for their project, so the Agent tree puts a run where its lead
// stands (its worktree project when it started there), or where the run is when it has no lead in the roster; the run's
// members follow. Everything else goes by its own project.
export function overviewRows(
    agents: readonly AgentVM[],
    terminals: readonly AgentVM[],
    project: string,
    lineage: Lineage = NO_LINEAGE
): OverviewRows {
    const roster = agents.filter((a) => a.kind !== "terminal");
    const groups = groupRunAgents(roster, lineage);
    // the run an agent is part of; a second lead of one run is a plain agent, as in the tree
    const runOf = (a: AgentVM): RunInfo | undefined => {
        const role = lineage.roles[a.id];
        if (role == null || (role.kind === "lead" && groups.leads.get(role.runId) !== a)) {
            return undefined;
        }
        return lineage.runs[roleRunId(role)];
    };
    const runProject = (run: RunInfo) => {
        const lead = groups.leads.get(run.runId);
        return (lead != null ? projectOf(lead) : run.project) || UNGROUPED_PROJECT;
    };
    const mine = sortAgents(
        roster.filter((a) => {
            const run = runOf(a);
            return run != null ? runProject(run) === project : projectOf(a) === project;
        })
    );
    const byRun = new Map<string, { run: RunInfo; total: number }>();
    for (const a of mine) {
        const run = runOf(a);
        if (run != null) {
            byRun.set(run.runId, { run, total: (byRun.get(run.runId)?.total ?? 0) + 1 });
        }
    }
    const runs: RunRow[] = [];
    for (const { run, total } of byRun.values()) {
        const lead = groups.leads.get(run.runId);
        const working =
            runningAgents(run, groups.workers.get(run.runId) ?? new Map(), groups.stages.get(run.runId) ?? []).length +
            (lead?.state === "working" ? 1 : 0);
        if (working > 0) {
            runs.push({ run, lead, working, total });
        }
    }
    return {
        asking: mine.filter((a) => a.state === "asking"),
        working: mine.filter((a) => a.state === "working" && runOf(a) == null),
        terminals: terminals.filter((t) => t.running === true && projectOf(t) === project),
        runs,
    };
}

// the Running block's agent count: the plain agents at work and every run's members at work, as the tree folder's
// badge counts them
export function runningCount(rows: OverviewRows): number {
    return rows.working.length + rows.runs.reduce((n, r) => n + r.working, 0);
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

// nothing waits, nothing runs and nothing finished unread: the page says so in one line instead of drawing empty blocks
export function isQuiet(rows: OverviewRows, waiting: number, finished = 0): boolean {
    return (
        waiting === 0 &&
        finished === 0 &&
        rows.asking.length === 0 &&
        rows.working.length === 0 &&
        rows.terminals.length === 0 &&
        rows.runs.length === 0
    );
}

// the header's change count, its adds and dels drawn beside it; null (no repo, not read yet) says nothing
export function changesLabel(stats: { files: number } | null): string {
    if (stats == null) {
        return "";
    }
    return stats.files === 0 ? "no uncommitted changes" : `${stats.files} ${stats.files === 1 ? "file" : "files"}`;
}

// History looks back this far; older is Conversation History's
export const HISTORY_WINDOW_MS = 7 * 86_400_000;

const hasText = (text: string, q: string) => q === "" || text.toLowerCase().includes(q.toLowerCase());
const samePath = (a: string, b: string) => normProjectPath(a).toLowerCase() === normProjectPath(b).toLowerCase();

// the project's agents that finished a turn you have not looked at, and wait on nothing: the newest first
export function finishedRows(
    agents: readonly AgentVM[],
    project: string,
    unread: ReadonlyMap<string, number>
): AgentVM[] {
    return agents
        .filter(
            (a) =>
                a.kind !== "terminal" &&
                projectOf(a) === project &&
                a.state !== "asking" &&
                a.state !== "working" &&
                (unread.get(a.id) ?? 0) > 0
        )
        .sort((x, y) => (y.idleSince ?? y.stateSince ?? 0) - (x.idleSince ?? x.stateSince ?? 0));
}

// the project's ended sessions in the window, newest first; a run's worker is left to its run, a live one to Now
export function projectSessions(
    sessions: readonly LiveSession[] | null,
    path: string,
    now: number,
    q: string
): LiveSession[] {
    return (sessions ?? [])
        .filter(
            (s) =>
                !s.live &&
                !s.runid &&
                samePath(s.projectpath, path) &&
                s.lastactivets >= now - HISTORY_WINDOW_MS &&
                hasText(s.task, q)
        )
        .sort((a, b) => b.lastactivets - a.lastactivets);
}

// ts orders the list and reads as the row's age; since decides the window (a run by when it was created)
export type HistoryItem =
    | {
          kind: "council";
          key: string;
          title: string;
          line: string;
          warn: string;
          ts: number;
          since: number;
          councilId: string;
      }
    | {
          kind: "run";
          key: string;
          title: string;
          line: string;
          warn: string;
          ts: number;
          since: number;
          channelId: string;
          runId: string;
      };

const COUNCIL_STATE: Record<string, string> = {
    running: "Running",
    "awaiting-you": "Waiting on you",
    done: "Done",
    "not-run": "Not started",
    stopped: "Stopped",
    failed: "Failed",
    queued: "Queued",
};

const RUN_STATUS: Record<string, string> = {
    planning: "Planning",
    "awaiting-review": "Awaiting review",
    executing: "Running",
    blocked: "Blocked",
    done: "Done",
    cancelled: "Cancelled",
};

function councilItem(c: Council): HistoryItem {
    const answer = c.summary?.answer?.trim();
    const n = c.experts?.length ?? 0;
    const state = answer ? `Answer: ${answer}` : (COUNCIL_STATE[c.state] ?? c.state);
    return {
        kind: "council",
        key: `council:${c.id}`,
        title: c.question?.trim() || c.feature,
        line: `${state} · ${n} ${n === 1 ? "expert" : "experts"}`,
        warn: "",
        ts: c.updated,
        since: c.updated,
        councilId: c.id,
    };
}

// what Needs you's "Run to confirm" counts (unverifiedItem, pkg/jarvis/attention.go): on a done run not yet
// acknowledged, the verifier's unverified reasons and the land's notes
function unverifiedCount(r: Run): number {
    if (r.status !== "done" || r.verificationackts) {
        return 0;
    }
    const v = r.evidence?.verification;
    return (v?.state === "unverified" ? (v.reasons?.length ?? 0) : 0) + (r.land?.notes?.length ?? 0);
}

function runItem(r: Run): HistoryItem {
    const land = r.land?.state;
    const line =
        land === "landed"
            ? `Landed on ${r.basebranch || "its base"}`
            : land === "held"
              ? "Land held"
              : (RUN_STATUS[r.status] ?? r.status);
    const unverified = unverifiedCount(r);
    return {
        kind: "run",
        key: `run:${r.id}`,
        title: r.goal.trim().split("\n")[0] || "Orchestrator run",
        line,
        warn: unverified > 0 ? `${unverified} not verified` : "",
        ts: r.completedts || r.createdts,
        since: r.createdts,
        channelId: r.channeloid ?? "",
        runId: r.id,
    };
}

// a transcript path as the two sides spell it: a run records the one its origin session was handed, a session the one
// the archive scanned
const normPath = (p: string) => p.replace(/\\/g, "/").toLowerCase();

// what the column draws, top to bottom: a session, a run or a council; a nested one sits under its session (parent
// is that session's row key), the rest are top-level
export type HistoryRow =
    | { kind: "session"; key: string; session: LiveSession; ts: number; nested: false }
    | (HistoryItem & { nested: boolean; parent?: string });

// the line of a run or council that no session started: the cockpit started it, when it names no origin at all
const COCKPIT_PREFIX = "Started from the cockpit, not a session · ";

// a run the engine launched for another run (a worker, a reviewer, a stage session) is that run's, never a row
const isChildRun = (r: Run) => !!r.taskid || !!r.stagerole || !!r.parentleadoref;

// the project's ended sessions in the window, each followed by the runs and councils it started (newest first), and
// the runs and councils no listed session started, placed among the sessions by time. A run belongs to the session
// whose transcript it was started from, a council to the session whose id it carries; one whose session is older than
// the window, still live or unnamed is top-level. A session stays for a query when its title or a child's matches (its
// children all show then); a top-level run or council, when its own title does.
export function historyRows(
    sessions: readonly LiveSession[] | null,
    councils: readonly Council[] | null,
    runs: readonly Run[] | null,
    path: string,
    now: number,
    q: string
): HistoryRow[] {
    const listed = projectSessions(sessions, path, now, "");
    const byTranscript = new Map<string, LiveSession>();
    const byId = new Map<string, LiveSession>();
    for (const s of listed) {
        if (s.transcriptpath) {
            byTranscript.set(normPath(s.transcriptpath), s);
        }
        byId.set(s.id, s);
    }
    const children = new Map<string, HistoryItem[]>();
    const loose: HistoryItem[] = [];
    const place = (item: HistoryItem, owner: LiveSession | undefined, named: boolean) => {
        if (owner == null) {
            loose.push(named ? item : { ...item, line: COCKPIT_PREFIX + item.line });
            return;
        }
        const key = sessionKey(owner);
        children.set(key, [...(children.get(key) ?? []), item]);
    };
    const inWindow = (i: HistoryItem) => i.since >= now - HISTORY_WINDOW_MS;
    for (const c of councils ?? []) {
        const item = councilItem(c);
        if (inWindow(item)) {
            place(item, c.sessionid ? byId.get(c.sessionid) : undefined, !!c.sessionid);
        }
    }
    for (const r of runs ?? []) {
        const item = runItem(r);
        if (!isChildRun(r) && inWindow(item)) {
            const origin = r.origintranscript ? normPath(r.origintranscript) : "";
            place(item, origin !== "" ? byTranscript.get(origin) : undefined, origin !== "");
        }
    }
    const top: HistoryRow[] = [];
    for (const s of listed) {
        const key = sessionKey(s);
        const mine = (children.get(key) ?? []).sort((a, b) => b.ts - a.ts);
        if (hasText(s.task, q) || mine.some((i) => hasText(i.title, q))) {
            top.push({ kind: "session", key, session: s, ts: s.lastactivets, nested: false });
            for (const item of mine) {
                top.push({ ...item, nested: true, parent: key });
            }
        }
    }
    // the sessions and the loose rows merge by time; a session's children ride along with it
    const groups: HistoryRow[][] = [];
    for (const row of top) {
        if (row.kind === "session") {
            groups.push([row]);
        } else {
            groups[groups.length - 1].push(row);
        }
    }
    for (const item of loose) {
        if (hasText(item.title, q)) {
            groups.push([{ ...item, nested: false }]);
        }
    }
    return groups.sort((a, b) => b[0].ts - a[0].ts).flat();
}
