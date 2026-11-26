// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// A project's Overview (agentcenter.ts' `project` mode), as data: its agents that ask, what in it is at work (its
// runs grouped, as the Agent tree groups them), what finished unread, and the History rows (ended sessions, councils,
// runs and judge pairs of the last 7 days, a session's runs, councils and pairs nested under it) with the words the
// header and the rows read. Pure; projectoverview.tsx draws it.

import type { OpenTarget } from "@/app/view/jarvis/address";
import { shortTabId } from "./agentrowmodel";
import { formatTokens, projectOf, sortAgents, type AgentVM } from "./agentsviewmodel";
import { groupRunAgents, runningAgents, UNGROUPED_PROJECT } from "./agenttreemodel";
import { normProjectPath } from "./channelderive";
import { placeUnderSessions } from "./historyplace";
import { prettyModel } from "./modellabel";
import { pairStateWords } from "./pairreadmodel";
import { NO_LINEAGE, roleRunId, type Lineage, type RunInfo } from "./runlineage";
import { runtimeMeta } from "./runtimemeta";
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
    idle: AgentVM[]; // its plain agents at rest, awake or asleep (no part in a run: the run's own view has those)
}

// a run's workers and stage sessions have a worktree for their project, so the Agent tree puts a run where its lead
// stands (its worktree project when it started there), or where the run is when it has no lead in the roster; the run's
// members follow. Everything else goes by its own project. `order` is the Agent tree's saved order: a run with two
// leads, neither the current one, is led by the first in it (groupRunAgents), so the Overview names the tree's lead.
export function overviewRows(
    agents: readonly AgentVM[],
    terminals: readonly AgentVM[],
    project: string,
    lineage: Lineage = NO_LINEAGE,
    order: readonly string[] = []
): OverviewRows {
    const rank = new Map(order.map((id, i) => [id, i] as const));
    const roster = agents
        .filter((a) => a.kind !== "terminal")
        .sort((x, y) => (rank.get(x.id) ?? Number.POSITIVE_INFINITY) - (rank.get(y.id) ?? Number.POSITIVE_INFINITY));
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
        idle: mine.filter((a) => a.state === "idle" && runOf(a) == null),
    };
}

// the Now column's Idle block: the project's open agents that neither ask, work nor wait to be read (Finished has
// those), awake ones first, each kind newest first. Without it an agent asleep in its tab shows nowhere on the page:
// History lists ended sessions only.
export function restingRows(rows: OverviewRows, finished: readonly AgentVM[]): AgentVM[] {
    const read = new Set(finished.map((a) => a.id));
    const at = (a: AgentVM) => a.sleeping?.since ?? a.idleSince ?? a.stateSince ?? 0;
    return rows.idle
        .filter((a) => !read.has(a.id))
        .sort((x, y) => Number(x.sleeping != null) - Number(y.sleeping != null) || at(y) - at(x));
}

// an Idle row's line: what the agent was on, after "asleep" when its process is gone
export function restingLine(a: AgentVM): string {
    const doing = doingLine(a);
    return a.sleeping == null ? doing : doing ? `asleep · ${doing}` : "asleep";
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

// a session of the project active in the window; a run's worker is left to its run
const inProjectWindow = (s: LiveSession, path: string, now: number) =>
    !s.runid && samePath(s.projectpath, path) && s.lastactivets >= now - HISTORY_WINDOW_MS;

// the project's ended sessions in the window, newest first; a live one is left to Now
export function projectSessions(
    sessions: readonly LiveSession[] | null,
    path: string,
    now: number,
    q: string
): LiveSession[] {
    return (sessions ?? [])
        .filter((s) => !s.live && inProjectWindow(s, path, now) && hasText(s.task, q))
        .sort((a, b) => b.lastactivets - a.lastactivets);
}

// the Activity footer's "N sessions": every session active in the window, a live one (working, idle or asleep in its
// tab) included, since the footer's tokens count its days too. History lists only the ended ones.
export function activeSessionCount(sessions: readonly LiveSession[], path: string, now: number): number {
    return sessions.filter((s) => inProjectWindow(s, path, now)).length;
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
          /** what the row shows when it unfolds, before Open council takes the person to it */
          peek: CouncilPeek;
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
      }
    | {
          kind: "pair";
          key: string;
          title: string;
          line: string;
          warn: string;
          ts: number;
          since: number;
          pairId: string;
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

// A History council row unfolded: the question it was asked, its answer, its error, and its ranked directions (the
// first PEEK_DIRECTIONS; `more` counts the rest). Every field may be empty: a council that never ran has only its
// question, and one asked no question only its feature, which the row's title already shows.
export interface CouncilPeek {
    question: string;
    answer: string;
    error: string;
    directions: { rank: number; title: string }[];
    more: number;
}

const PEEK_DIRECTIONS = 3;

export function councilPeek(c: Council): CouncilPeek {
    const ranked = [...(c.summary?.directions ?? [])].sort((a, b) => a.rank - b.rank);
    return {
        question: c.question?.trim() ?? "",
        answer: c.summary?.answer?.trim() ?? "",
        error: c.error?.trim() ?? "",
        directions: ranked.slice(0, PEEK_DIRECTIONS).map((d) => ({ rank: d.rank, title: d.title.trim() })),
        more: Math.max(0, ranked.length - PEEK_DIRECTIONS),
    };
}

function councilItem(c: Council): HistoryItem {
    const answer = c.summary?.answer?.trim();
    const n = c.experts?.length ?? 0;
    const state = answer ? `Answer: ${answer}` : (COUNCIL_STATE[c.state] ?? c.state);
    return {
        kind: "council",
        key: `council:${c.id}`,
        // its feature, as the Agent tree's row names it, so the two read as one council
        title: c.feature.trim() || c.question?.trim() || "(untitled council)",
        line: `${state} · ${n} ${n === 1 ? "expert" : "experts"}`,
        warn: "",
        ts: c.updated,
        since: c.updated,
        councilId: c.id,
        peek: councilPeek(c),
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

// the goal a brainstorm's run starts with (runPrefill, brainstormmodel.ts): "Build <title> as specified in <path>."
const SPEC_GOAL = /^(.+?) as specified in (.+?)\.?$/;

// a run's row title and the spec file it names, if any: the absolute spec path would take the whole row
export function runHeadline(goal: string): { title: string; spec: string } {
    const first = goal.trim().split("\n")[0];
    const m = SPEC_GOAL.exec(first);
    if (m == null) {
        return { title: first || "Orchestrator run", spec: "" };
    }
    return { title: m[1], spec: m[2].split(/[\\/]/).pop() ?? "" };
}

function runItem(r: Run): HistoryItem {
    const land = r.land?.state;
    const state =
        land === "landed"
            ? `Landed on ${r.basebranch || "its base"}`
            : land === "held"
              ? "Land held"
              : (RUN_STATUS[r.status] ?? r.status);
    const { title, spec } = runHeadline(r.goal);
    const line = spec ? `${state} · ${spec}` : state;
    const unverified = unverifiedCount(r);
    return {
        kind: "run",
        key: `run:${r.id}`,
        title,
        line,
        warn: unverified > 0 ? `${unverified} not verified` : "",
        ts: r.completedts || r.createdts,
        since: r.createdts,
        channelId: r.channeloid ?? "",
        runId: r.id,
    };
}

// A pair's row: titled by its judge (the working agent is the session it sits under, or the row's own line says no
// session started it), worded by the state words every surface uses (pairreadmodel.ts). It is placed by the session its
// working agent worked in, and listed by its last save: a pair has no start time of its own in the list read.
function pairItem(p: PairInfo): HistoryItem {
    const judges = p.judges ?? [];
    return {
        kind: "pair",
        key: `pair:${p.id}`,
        title:
            judges.length === 1 ? `Pair with judge ${shortTabId(judges[0].tab)}` : `Pair with ${judges.length} judges`,
        line: pairStateWords(p),
        warn: "",
        ts: p.updatedts,
        since: p.updatedts,
        pairId: p.id,
    };
}

// what a row opens through the router (openref.ts): a council by its id (a council's own click unfolds it first, its Open
// council opens it), a pair by its id (Agent's centre while it is live, else Library's read-only view), a run by its
// channel's sheet, or by itself when it has no channel
export function historyTarget(item: HistoryItem): OpenTarget {
    switch (item.kind) {
        case "council":
            return { kind: "council", councilId: item.councilId };
        case "pair":
            return { kind: "pair", pairId: item.pairId };
        case "run":
            return item.channelId !== ""
                ? { kind: "channel", channelId: item.channelId, runId: item.runId }
                : { kind: "run", runId: item.runId };
    }
}

// what the column draws, top to bottom: a session, a run, a council or a pair; a nested one sits under its session (parent
// is that session's row key), the rest are top-level
export type HistoryRow =
    | { kind: "session"; key: string; session: LiveSession; ts: number; nested: false }
    | (HistoryItem & { nested: boolean; parent?: string });

// the line of a run, council or pair that no session started: the cockpit started it, when it names no origin at all
const COCKPIT_PREFIX = "Started from the cockpit, not a session · ";

// a run the engine launched for another run (a worker, a reviewer, a stage session) is that run's, never a row
const isChildRun = (r: Run) => !!r.taskid || !!r.stagerole || !!r.parentleadoref;

// the project's ended sessions in the window, each followed by the runs, councils and pairs it started (newest first), and
// the runs, councils and pairs no listed session started, placed among the sessions by time. A run belongs to the session
// whose transcript it was started from, a council to the session whose id it carries, a pair to the session its working
// agent worked in (`worker.session`; a pair saved before ids were kept has none); one whose session is older than the
// window, still live or unnamed is top-level. A session stays for a query when its title or a child's matches (its
// children all show then); a top-level run, council or pair, when its own title does. `pairs` is the project's pair
// history in every state (pairstore.ts); null while it is unread, which lists none.
export function historyRows(
    sessions: readonly LiveSession[] | null,
    councils: readonly Council[] | null,
    runs: readonly Run[] | null,
    path: string,
    now: number,
    q: string,
    pairs: readonly PairInfo[] | null = null
): HistoryRow[] {
    const listed = projectSessions(sessions, path, now, "");
    const inWindow = (i: HistoryItem) => i.since >= now - HISTORY_WINDOW_MS;
    const placing: { item: HistoryItem; sessionId?: string; transcript?: string }[] = [];
    for (const c of councils ?? []) {
        const item = councilItem(c);
        if (inWindow(item)) {
            placing.push({ item, sessionId: c.sessionid });
        }
    }
    for (const r of runs ?? []) {
        const item = runItem(r);
        if (!isChildRun(r) && inWindow(item)) {
            placing.push({ item, transcript: r.origintranscript });
        }
    }
    for (const p of pairs ?? []) {
        const item = pairItem(p);
        if (inWindow(item)) {
            placing.push({ item, sessionId: p.worker.session });
        }
    }
    const { owned, loose: unplaced } = placeUnderSessions(listed, placing);
    const loose = unplaced.map(({ item, named }) => (named ? item : { ...item, line: COCKPIT_PREFIX + item.line }));
    const top: HistoryRow[] = [];
    for (const s of listed) {
        const key = sessionKey(s);
        const mine = (owned.get(key)?.items ?? []).sort((a, b) => b.ts - a.ts);
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

// History draws this many top-level rows at first, and as many more each time its foot scrolls into view
export const HISTORY_PAGE = 15;

// the rows down to `frontier`, the oldest session read while older pages are unread (null: all are read): a run,
// council or pair older than it waits for the sessions of its time, which may own it. A top-level row takes its nested ones along
export function rowsUntil(rows: readonly HistoryRow[], frontier: number | null): HistoryRow[] {
    if (frontier == null) {
        return rows as HistoryRow[];
    }
    const end = rows.findIndex((r) => !r.nested && r.ts < frontier);
    return end < 0 ? (rows as HistoryRow[]) : rows.slice(0, end);
}

// History's heading count: the ended sessions read in the window, "+" while older pages are unread. A failed sessions
// read has no count to give, as while loading (its error row says so), so null leaves it out
export function historyCountLabel(count: number, more: boolean, failed: boolean): string | null {
    if (failed) {
        return null;
    }
    return `${count}${more ? "+" : ""} ${count === 1 && !more ? "session" : "sessions"}`;
}

// the first `limit` top-level rows, each with the rows nested under it, so a page never ends between a session and its
// runs, councils and pairs
export function firstRows(rows: readonly HistoryRow[], limit: number): HistoryRow[] {
    let top = 0;
    let end = 0;
    for (; end < rows.length; end++) {
        if (!rows[end].nested) {
            if (top === limit) {
                break;
            }
            top++;
        }
    }
    return rows.slice(0, end);
}

// whether rows[i] is the last of its session's nested rows, where History's tree line turns into its └; a session's
// nested rows follow it together (historyRows, firstRows), so the next row is either a sibling or a new top-level row
export function isLastChild(rows: readonly HistoryRow[], i: number): boolean {
    return rows[i].nested && !rows[i + 1]?.nested;
}

// A History session row's second line: its branch, runtime, model and tokens, each only when known.
export function historySessionLine(s: Pick<LiveSession, "branch" | "runtime" | "model" | "tokenstotal">): string {
    return [
        s.branch,
        runtimeMeta(s.runtime).label,
        s.model ? prettyModel(s.model) : "",
        `${formatTokens(s.tokenstotal)} tokens`,
    ]
        .filter(Boolean)
        .join(" · ");
}
