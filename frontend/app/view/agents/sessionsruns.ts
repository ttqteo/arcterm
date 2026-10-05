// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Pure run grouping for Conversation History. A session an orchestrator run launched (the backend stamps its
// run, task and role) folds into one entry for that run; the entry lists the lead, every task of the run's
// dag and its stage sessions, and surfaces only the members that need you. No React, no Wave runtime.

import { formatAge, type AgentVM } from "./agentsviewmodel";
import { runTitle, stageLabel, unmetDeps } from "./runlineage";
import { runComplete } from "./runmodel";
import type { LiveSession } from "./sessionsarchivestore";

export const LEAD_MEMBER = "lead";

// the sessions that judge the whole dag, in the order they run; each is its own member, keyed by its role
const STAGE_ROLES = ["plan-reviewer", "verifier"];

export interface RunSessions {
    runId: string;
    channelId: string;
    lead: LiveSession[]; // newest first
    tasks: Record<string, LiveSession[]>; // by task id, newest first
    stages: Record<string, LiveSession[]>; // by stage role, newest first
    sessions: LiveSession[];
    live: boolean;
    lastactivets: number;
}

export type SessionsItem = { kind: "run"; run: RunSessions } | { kind: "solo"; session: LiveSession };

export function sessionKey(s: Pick<SessionActivity, "runtime" | "id">): string {
    return `${s.runtime}:${s.id}`;
}

export function runSelKey(runId: string): string {
    return `run:${runId}`;
}

export function runIdOfSel(sel: string): string | undefined {
    return sel.startsWith("run:") ? sel.slice(4) : undefined;
}

const newestFirst = (a: LiveSession, b: LiveSession) => b.lastactivets - a.lastactivets;

// groupRunSessions folds each run's sessions into one entry and leaves every other session on its own.
export function groupRunSessions(list: LiveSession[]): { runs: RunSessions[]; solos: LiveSession[] } {
    const byRun = new Map<string, RunSessions>();
    const solos: LiveSession[] = [];
    for (const s of list) {
        if (!s.runid) {
            solos.push(s);
            continue;
        }
        let run = byRun.get(s.runid);
        if (run == null) {
            run = {
                runId: s.runid,
                channelId: s.channelid ?? "",
                lead: [],
                tasks: {},
                stages: {},
                sessions: [],
                live: false,
                lastactivets: 0,
            };
            byRun.set(s.runid, run);
        }
        run.channelId ||= s.channelid ?? "";
        run.sessions.push(s);
        run.live ||= s.live;
        run.lastactivets = Math.max(run.lastactivets, s.lastactivets);
        if (s.role === "lead") {
            run.lead.push(s);
        } else if (STAGE_ROLES.includes(s.role)) {
            (run.stages[s.role] ??= []).push(s);
        } else if (s.taskid) {
            (run.tasks[s.taskid] ??= []).push(s);
        }
    }
    for (const run of byRun.values()) {
        run.lead.sort(newestFirst);
        for (const list of [...Object.values(run.tasks), ...Object.values(run.stages)]) {
            list.sort(newestFirst);
        }
    }
    return { runs: [...byRun.values()], solos };
}

// memberSession is the session a member row opens: a live one first so Jump reaches it, then the newest
// worker (a finished reviewer is newer, but the work is the worker's), then whatever is newest.
export function memberSession(sessions: LiveSession[] | undefined): LiveSession | undefined {
    if (!sessions?.length) {
        return undefined;
    }
    return sessions.find((s) => s.live) ?? sessions.find((s) => s.role !== "review") ?? sessions[0];
}

export type StatusKey = "running" | "asking" | "review" | "idle" | "pending" | "done" | "failed" | "muted";

export interface Status {
    key: StatusKey;
    text: string;
}

const FAILED_TEXT: Record<string, string> = {
    failed: "failed",
    stalled: "stalled",
    "review-failed": "review failed",
    "blocked-merge": "merge blocked",
    "verify-failed": "verify failed",
};

export function taskNum(taskId: string): string {
    return taskId.replace(/^t-/, "");
}

export function taskStatus(task: TaskNode, dag: TaskGroup | undefined, digest: DagStatusDigest | undefined): Status {
    const wait = digest?.tasks?.find((t) => t.taskid === task.id)?.waitreason;
    if (wait === "ask") {
        return { key: "asking", text: "asking" };
    }
    if (wait === "lead-ask") {
        return { key: "running", text: "asked the lead" };
    }
    if (FAILED_TEXT[task.state]) {
        return { key: "failed", text: FAILED_TEXT[task.state] };
    }
    switch (task.state) {
        case "running":
            return { key: "running", text: "running" };
        case "reviewing":
            return { key: "review", text: "in review" };
        case "verifying":
            return { key: "review", text: "verifying" };
        case "done":
            return { key: "done", text: task.merged ? "landed" : "done" };
        case "pending":
        case "ready": {
            const waits = unmetDeps(dag, task) ?? [];
            return { key: "pending", text: waits.length > 0 ? `waits on ${waits.map(taskNum).join(", ")}` : "queued" };
        }
        default:
            return { key: "muted", text: task.state };
    }
}

// the member keys a run's needs-you rows are drawn for
export function needsYou(status: Status): boolean {
    return status.key === "asking" || status.key === "failed";
}

export interface RunMember {
    key: string; // LEAD_MEMBER, a task id or a stage role
    num: string;
    label: string;
    status: Status;
    session?: LiveSession;
    // the task's child run, for a member whose session the scan has not picked up yet
    childRunId?: string;
    tokens: number;
    durationMs: number;
    waitsOn?: string[];
}

export interface RunView {
    runId: string;
    title: string;
    project: string;
    plan: string;
    // the lead's runtime, for the run's glyph
    runtime: string;
    live: boolean;
    head: Status;
    // nothing left to happen: the plan done, the lead finished and the run landed (the Agents tree's green check)
    complete: boolean;
    segs: StatusKey[];
    landed: number;
    total: number;
    members: RunMember[];
    needs: RunMember[];
    ask?: { member: string; num: string; text: string };
    tokens: number;
    startedts: number;
    lastactivets: number;
}

export interface RunViewInput {
    group: RunSessions;
    run?: Run;
    dag?: TaskGroup;
    digest?: DagStatusDigest;
    // the lead's roster agent, when live: whether it sits at its prompt
    leadAtPrompt?: boolean;
    now: number;
}

function basename(path: string | undefined): string {
    return (path ?? "").split(/[\\/]/).filter(Boolean).pop() ?? "";
}

const sum = (list: LiveSession[] | undefined, f: (s: LiveSession) => number) =>
    (list ?? []).reduce((n, s) => n + f(s), 0);

function leadStatus(input: RunViewInput): Status {
    const lead = memberSession(input.group.lead);
    if (lead?.live) {
        if (lead.needsAttention) {
            return { key: "asking", text: "asking" };
        }
        const dagOpen = input.dag != null && input.dag.status !== "done" && input.dag.status !== "cancelled";
        return input.leadAtPrompt && dagOpen
            ? { key: "idle", text: "waiting on engine" }
            : { key: "running", text: "working" };
    }
    return lead ? { key: "done", text: "done" } : { key: "pending", text: "no session" };
}

const STAGE_VERDICTS: Record<string, Status> = {
    passed: { key: "done", text: "passed" },
    failed: { key: "failed", text: "failed" },
    // the review failed and the lead went ahead anyway
    accepted: { key: "muted", text: "accepted" },
    unverified: { key: "muted", text: "unverified" },
};

// stageStatus reads the dag's current round of a stage: the round its newest session judged
function stageStatus(role: string, session: LiveSession | undefined, dag: TaskGroup | undefined): Status {
    if (session?.live) {
        return { key: "review", text: role === "verifier" ? "verifying" : "reviewing" };
    }
    const state = (role === "verifier" ? dag?.final : dag?.planreview)?.state;
    return STAGE_VERDICTS[state] ?? { key: "done", text: "done" };
}

function headStatus(
    members: RunMember[],
    live: boolean,
    dag: TaskGroup | undefined,
    lastactivets: number,
    now: number
): Status {
    const count = (k: StatusKey) => members.filter((m) => m.status.key === k).length;
    const asking = count("asking");
    if (asking > 0) {
        return { key: "asking", text: `${asking} asking` };
    }
    const failed = count("failed");
    if (failed > 0) {
        return { key: "failed", text: `${failed} need${failed === 1 ? "s" : ""} you` };
    }
    const running = members.filter(
        (m) => m.key !== LEAD_MEMBER && (m.status.key === "running" || m.status.key === "review")
    ).length;
    if (running > 0) {
        return { key: "running", text: `${running} running` };
    }
    if (dag?.status === "cancelled") {
        return { key: "muted", text: "cancelled" };
    }
    if (live) {
        return { key: "running", text: dag ? "working" : "planning" };
    }
    return { key: "done", text: formatAge(now - lastactivets) };
}

export function runView(input: RunViewInput): RunView {
    const { group, run, dag, digest, now } = input;
    const lead = memberSession(group.lead);
    const members: RunMember[] = [
        {
            key: LEAD_MEMBER,
            num: "",
            label: "Lead",
            status: leadStatus(input),
            session: lead,
            tokens: sum(group.lead, (s) => s.tokenstotal),
            durationMs: sum(group.lead, (s) => s.durationms),
        },
    ];
    // without its dag a run still lists the tasks its sessions worked
    const tasks: TaskNode[] =
        dag?.tasks ??
        Object.keys(group.tasks)
            .sort()
            .map((id) => ({ id, label: memberSession(group.tasks[id])?.task ?? id, state: "done" }) as TaskNode);
    for (const task of tasks) {
        const sessions = group.tasks[task.id];
        members.push({
            key: task.id,
            num: taskNum(task.id),
            label: task.label || task.id,
            status: taskStatus(task, dag, digest),
            session: memberSession(sessions),
            childRunId: task.runid || undefined,
            tokens: sum(sessions, (s) => s.tokenstotal),
            durationMs: sum(sessions, (s) => s.durationms),
            waitsOn: unmetDeps(dag, task)?.map(taskNum),
        });
    }
    // a stage session is listed, but the run's counts and needs-you rows are its tasks'
    const taskMembers = members.slice(1);
    const stageMembers: RunMember[] = STAGE_ROLES.filter((role) => group.stages[role]?.length).map((role) => {
        const sessions = group.stages[role];
        const session = memberSession(sessions);
        return {
            key: role,
            num: "",
            label: stageLabel(role),
            status: stageStatus(role, session, dag),
            session,
            tokens: sum(sessions, (s) => s.tokenstotal),
            durationMs: sum(sessions, (s) => s.durationms),
        };
    });
    const askTask = taskMembers.find((m) => m.status.key === "asking");
    const askText = askTask ? digest?.tasks?.find((t) => t.taskid === askTask.key)?.asksummary : undefined;
    return {
        runId: group.runId,
        title: run || dag ? runTitle(run, dag) : (lead?.task ?? "Orchestrator run"),
        project: basename(run?.projectpath) || lead?.projectname || "",
        plan: basename(dag?.planpath),
        runtime: run?.runtime || lead?.runtime || "claude",
        live: group.live,
        head: headStatus(members, group.live, dag, group.lastactivets, now),
        complete: runComplete({ dag, status: run?.status, land: run?.land }),
        segs: taskMembers.map((m) => m.status.key),
        landed: taskMembers.filter((m) => m.status.key === "done").length,
        total: taskMembers.length,
        members: [...members, ...stageMembers],
        needs: members.filter((m) => needsYou(m.status)),
        ask: askTask ? { member: askTask.key, num: askTask.num, text: askText || "" } : undefined,
        tokens: sum(group.sessions, (s) => s.tokenstotal),
        startedts: run?.createdts || Math.min(...group.sessions.map((s) => s.startedts || s.lastactivets)),
        lastactivets: group.lastactivets,
    };
}

// defaultMember is the member a run opens on: the task asking you, else the first that needs you, else the lead
export function defaultMember(view: RunView): string {
    return view.ask?.member ?? view.needs[0]?.key ?? LEAD_MEMBER;
}

// memberOfSession is where a session sits in its run, for a click that names a session (a feed event)
export function memberOfSession(s: Pick<SessionActivity, "role" | "taskid">): string {
    if (STAGE_ROLES.includes(s.role)) {
        return s.role;
    }
    return s.role === "lead" || !s.taskid ? LEAD_MEMBER : s.taskid;
}

// sessionSelection is where opening a session lands in the Agent surface: its run with it in view (Conversation
// History), else its own entry (the session pane)
export function sessionSelection(s: Pick<SessionActivity, "runtime" | "id" | "runid" | "role" | "taskid">): {
    sel: string;
    member?: string;
} {
    return s.runid ? { sel: runSelKey(s.runid), member: memberOfSession(s) } : { sel: sessionKey(s) };
}

// sessionPrimary is a session's one primary action: Jump to its live agent, else Resume it if it can be
export function sessionPrimary(s: Pick<LiveSession, "live" | "resumecommand">): "jump" | "resume" | null {
    if (s.live) {
        return "jump";
    }
    return s.resumecommand ? "resume" : null;
}

// sessionLabel names a session in the merged feed: its run and place in it, else its own task
export function sessionLabel(s: LiveSession, runTitles: Record<string, string>): string {
    const title = s.runid ? runTitles[s.runid] : undefined;
    if (title == null) {
        return s.task || "(untitled session)";
    }
    if (s.role === "lead") {
        return `${title} · lead`;
    }
    if (STAGE_ROLES.includes(s.role)) {
        return `${title} · ${stageLabel(s.role).toLowerCase()}`;
    }
    return s.taskid ? `${title} · task ${taskNum(s.taskid)}${s.role === "review" ? " review" : ""}` : title;
}

// rosterSession stands in for a live agent's session the scan has not picked up yet (it started after the
// surface loaded), so its member can still be read and jumped to.
export function rosterSession(agent: AgentVM): LiveSession {
    return {
        id: agent.id,
        runtime: agent.agent || "claude",
        projectpath: "",
        projectname: agent.project ?? "",
        branch: "",
        task: agent.task,
        model: agent.model ?? "",
        tokenstotal: 0,
        lastactivets: 0,
        resumecommand: "",
        transcriptpath: agent.transcriptPath ?? "",
        status: "running",
        startedts: 0,
        durationms: 0,
        events: [],
        live: true,
        liveId: agent.id,
        needsAttention: agent.state === "asking",
    };
}
