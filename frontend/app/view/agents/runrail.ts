// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Pure: what the details rail's Run section (for a lead) and Task section (for a worker) say about an
// orchestrator run. Read from the dag, the engine's digest and the run's event rows; no React.

import { formatAgeShort } from "./agentsviewmodel";
import { ASK_OWNER_USER } from "./childaskmodel";
import { laneLabel, workerAsk } from "./runlineage";
import { eventText } from "./runtimeline";

// LaneState is where a lane's task in play stands; it picks the lane row's dot and the colour of its state text.
export type LaneState = "done" | "working" | "asking" | "lead" | "pending" | "failed" | "muted";

export interface LaneRow {
    key: string;
    // the task in play, which a click on the row lands on
    taskId: string;
    name: string;
    // what came before it in the lane, and for a lane not started yet what it waits on
    hist: string;
    state: LaneState;
    text: string;
}

const FINISHED = new Set(["done", "skipped", "cancelled"]);
const NOT_STARTED = new Set(["pending", "ready"]);
const FAILING = new Set(["stalled", "failed", "verify-failed", "blocked-merge", "review-failed"]);

// COMMIT_CHARS is how much of a landed commit's hash a line shows, as git's short form does.
const COMMIT_CHARS = 7;

function landedCommit(digest: DagStatusDigest | undefined, taskId: string): string | undefined {
    return digest?.report?.commits?.find((c) => c.taskid === taskId)?.commit.slice(0, COMMIT_CHARS);
}

function outcome(task: TaskNode): string {
    return task.merged ? "landed" : task.state;
}

// endedLine is the banner over a done task's transcript: what the task came to, and that its session is over.
export function endedLine(task: TaskNode, digest: DagStatusDigest | undefined): string {
    const name = task.label ? `${task.id} · ${task.label}` : task.id;
    const commit = landedCommit(digest, task.id);
    const result = task.merged ? (commit ? `landed on main as ${commit}` : "landed on main") : task.state;
    return `${name} ${result} · session ended`;
}

function taskName(task: TaskNode): string {
    return task.label ? `${task.id} · ${task.label}` : task.id;
}

function runningFor(task: TaskNode, now: number): string {
    return task.firstactivity ? formatAgeShort(now - task.firstactivity) : task.state;
}

// segmentState is one task's slot in the Run section's progress bar.
function segmentState(task: TaskNode, digest: DagStatusDigest | undefined): LaneState {
    if (task.state === "done") {
        return "done";
    }
    if (FINISHED.has(task.state)) {
        return "muted";
    }
    if (NOT_STARTED.has(task.state)) {
        return "pending";
    }
    if (FAILING.has(task.state)) {
        return "failed";
    }
    return workerAsk(digest, task.id)?.owner === "you" ? "asking" : "working";
}

// thenTask names the first task not started yet: what the run moves on to once whatever holds it is settled.
export function thenTask(dag: TaskGroup | undefined): string | undefined {
    const t = (dag?.tasks ?? []).find((x) => NOT_STARTED.has(x.state));
    return t ? taskName(t) : undefined;
}

// runSegments is the Run section's progress bar: one slot per task, in plan order.
export function runSegments(dag: TaskGroup | undefined, digest: DagStatusDigest | undefined): LaneState[] {
    return (dag?.tasks ?? []).map((t) => segmentState(t, digest));
}

function laneRow(key: string, tasks: TaskNode[], byId: Map<string, TaskNode>, digest?: DagStatusDigest): LaneRow {
    const i = tasks.findIndex((t) => !FINISHED.has(t.state));
    const current = i === -1 ? tasks[tasks.length - 1] : tasks[i];
    const row = { key, taskId: current.id, name: taskName(current) };
    if (i === -1) {
        const done = current.state === "done";
        return {
            ...row,
            hist: landedCommit(digest, current.id) ?? "",
            state: done ? "done" : "muted",
            text: outcome(current),
        };
    }
    const prior = i > 0 ? `${tasks[i - 1].id} ${outcome(tasks[i - 1])}` : "";
    if (NOT_STARTED.has(current.state)) {
        const waits = (current.deps ?? []).filter((d) => byId.get(d)?.state !== "done");
        const hist = [prior, waits.length > 0 ? `waits on ${waits.join(", ")}` : ""].filter(Boolean).join(" · ");
        return { ...row, hist, state: "pending", text: "queued" };
    }
    if (FAILING.has(current.state)) {
        return { ...row, hist: prior, state: "failed", text: current.state };
    }
    const ask = workerAsk(digest, current.id);
    if (ask?.owner === "lead") {
        return { ...row, hist: prior, state: "lead", text: "lead" };
    }
    if (ask?.owner === "you") {
        return { ...row, hist: prior, state: "asking", text: "asks you" };
    }
    return { ...row, hist: prior, state: "working", text: "working" };
}

// laneRows is the Run section's lane list: one row per lane naming its task in play and where that task stands.
export function laneRows(dag: TaskGroup | undefined, digest: DagStatusDigest | undefined): LaneRow[] {
    const byId = new Map((dag?.tasks ?? []).map((t) => [t.id, t] as const));
    return (digest?.lanes ?? []).flatMap((ids) => {
        const tasks = ids.map((id) => byId.get(id)).filter((t): t is TaskNode => t != null);
        return tasks.length === 0 ? [] : [laneRow(laneLabel(digest, ids[0])!, tasks, byId, digest)];
    });
}

export interface TaskFacts {
    lane?: string;
    laneText?: string;
    depends: string;
    // "Attempt" while the task is in play, "Result" once it is finished
    resultLabel: "Attempt" | "Result";
    result: string;
    landed: boolean;
}

// taskFacts is the Task section's rows for one worker's task.
export function taskFacts(
    dag: TaskGroup | undefined,
    digest: DagStatusDigest | undefined,
    taskId: string,
    now: number
): TaskFacts | undefined {
    const task = dag?.tasks?.find((t) => t.id === taskId);
    if (task == null) {
        return undefined;
    }
    const byId = new Map((dag?.tasks ?? []).map((t) => [t.id, t] as const));
    const lane = laneLabel(digest, taskId);
    const laneIds = digest?.lanes?.find((l) => l.includes(taskId));
    const depends =
        (task.deps ?? [])
            .map((d) => {
                const dep = byId.get(d);
                return `${d} · ${dep?.merged ? "landed" : (dep?.state ?? "unknown")}`;
            })
            .join(", ") || "none";
    const facts: TaskFacts = {
        lane,
        laneText: lane && laneIds ? `${lane} · ${laneIds.join(" → ")}` : undefined,
        depends,
        resultLabel: "Attempt",
        result: "",
        landed: false,
    };
    if (FINISHED.has(task.state)) {
        const commit = landedCommit(digest, taskId);
        const landed = task.merged === true;
        return {
            ...facts,
            resultLabel: "Result",
            result: landed ? ["landed", commit].filter(Boolean).join(" ") : task.state,
            landed,
        };
    }
    // Attempts counts consecutive failures of one kind, so the attempt in play is one past it
    return { ...facts, result: `${(task.attempts ?? 0) + 1} · ${runningFor(task, now)}` };
}

// runElapsedMs is how long the run has gone: the digest's settled figure once it has ended, else a clock
// read from the dag's start, so it keeps moving between digest loads.
export function runElapsedMs(dag: TaskGroup | undefined, digest: DagStatusDigest | undefined, now: number): number {
    if (digest?.next?.kind === "terminal") {
        return digest.durations?.elapsedms ?? 0;
    }
    return dag?.createdts ? Math.max(0, now - dag.createdts) : 0;
}

// questionOrder puts the questions waiting on the human first, then the lead's, each oldest first.
export function questionOrder(asks: DagAskItem[]): DagAskItem[] {
    const yours = (a: DagAskItem) => (a.owner === ASK_OWNER_USER ? 0 : 1);
    return [...asks].sort((a, b) => yours(a) - yours(b) || a.ts - b.ts);
}

const DAG_FINALIZING = "finalizing";

// verifyingHeadline is the Run status line while the final stage runs. A question waiting on the human still
// wins, so it yields; every other status keeps the line it had.
export function verifyingHeadline(
    dagStatus: string | undefined,
    waitingOnYou: boolean,
    next: string
): { text: string; tone: string; tail: string } | undefined {
    if (dagStatus !== DAG_FINALIZING || waitingOnYou) {
        return undefined;
    }
    return { text: "Verifying", tone: "text-working", tail: next ? `· ${next}` : "" };
}

export const RUN_LOG_LINES = 3;

// runLog is the newest few rows of the run's timeline, newest first.
export function runLog(events: RunEvent[], n = RUN_LOG_LINES): { id: string; ts: number; text: string }[] {
    return [...events]
        .sort((a, b) => b.ts - a.ts)
        .slice(0, n)
        .map((e) => ({ id: e.id, ts: e.ts, text: eventText(e) }));
}
