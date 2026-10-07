// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Pure lineage for the Agent surface: which roster agents lead an orchestrator run and which work a task
// under one. Read from the run a tab was spawned for (jarvis:runoref) and that run's dag, with the
// engine's digest for what only it knows: lanes and who holds a question. No React, no Wave runtime.

import { modelLabel } from "@/app/view/agents/session-models/sessionviewmodel";
import { formatAgeShort, projectOf, type AgentVM } from "./agentsviewmodel";

// a stage session judges the whole run rather than one task: its plan reviewer, its final verifier
export type RunRole =
    | { kind: "lead"; runId: string }
    | { kind: "worker"; leadRunId: string; taskId: string }
    | { kind: "stage"; leadRunId: string; stageRole: string };

// RunInfo is one orchestrator run as the tree and header show it, keyed by the lead's run id.
export interface RunInfo {
    runId: string;
    channelId: string;
    title: string;
    // the lead's project, or the run's checkout for a run with no lead in the roster
    project: string;
    // whether the run has ever had a lead session, so a run with none in the roster can say which it is
    leadStarted?: boolean;
    // the tab of the session that started the run with `wsh runs start`, which the tree lists it under
    originId?: string;
    // the run's own status, the only truth for a run that has no dag to measure progress against
    status?: string;
    // the run's own wave/<runId> tree, when its lanes land there instead of the checkout
    landPath?: string;
    // where the run's branch stands on its way back into its base, once the run is done
    land?: RunLand;
    dag?: TaskGroup;
    digest?: DagStatusDigest;
}

export interface Lineage {
    roles: Record<string, RunRole>; // by agent id
    runs: Record<string, RunInfo>; // by lead run id
}

export const NO_LINEAGE: Lineage = { roles: {}, runs: {} };

// runRoleOf is an agent's part in a run. A dag's owning run is its lead's, a run the engine started for a stage
// is that stage's, and any other run holding the dag is a task's child run. An orchestrator run with no dag yet,
// or whose dag has not loaded, is a lead.
// Anything else is a plain agent: a Quick run, or a child the engine no longer links that carries no task id.
export function runRoleOf(run: Run | undefined, dag: TaskGroup | undefined, stampedTaskId?: string): RunRole | null {
    if (run == null) {
        return null;
    }
    if (run.dagoref && dag != null) {
        if (dag.runid === run.oid) {
            return { kind: "lead", runId: run.oid };
        }
        if (run.stagerole) {
            return { kind: "stage", leadRunId: dag.runid, stageRole: run.stagerole };
        }
        const tasks = dag.tasks ?? [];
        // a task's reviewer works that task too, so it nests under the lead beside the worker it follows. the
        // engine unlinks a run once it is over (a verdict applied, a retry dispatched) while its tab can live on,
        // and a relaunch leaves such a tab for good; the task id stamped on it at spawn still places it
        const task =
            tasks.find((t) => t.runid === run.oid || t.reviewrunid === run.oid) ??
            (stampedTaskId ? tasks.find((t) => t.id === stampedTaskId) : undefined);
        return task ? { kind: "worker", leadRunId: dag.runid, taskId: task.id } : null;
    }
    return run.mode === "orchestrator" ? { kind: "lead", runId: run.oid } : null;
}

// holdsTask reports whether agent's run is the one taskId currently points at, its worker or its reviewer, rather
// than a tab left from an earlier attempt or a finished review.
export function holdsTask(run: RunInfo, taskId: string, agent: Pick<AgentVM, "runId">): boolean {
    const task = run.dag?.tasks?.find((t) => t.id === taskId);
    return task != null && agent.runId != null && (task.runid === agent.runId || task.reviewrunid === agent.runId);
}

// leadAgentOf finds the roster agent leading runId, if it is in the roster.
export function leadAgentOf<T extends { id: string }>(lineage: Lineage, agents: T[], runId: string): T | undefined {
    return agents.find((a) => {
        const role = lineage.roles[a.id];
        return role?.kind === "lead" && role.runId === runId;
    });
}

// agentProject is the project an agent is shown under. A worker's or stage session's own is an engine tree, so
// it reads its lead's, else its run's checkout.
export function agentProject(lineage: Lineage, agents: AgentVM[], agent: AgentVM): string {
    const role = lineage.roles[agent.id];
    if (role == null || role.kind === "lead") {
        return projectOf(agent);
    }
    const lead = leadAgentOf(lineage, agents, role.leadRunId);
    return lead ? projectOf(lead) : (lineage.runs[role.leadRunId]?.project ?? "");
}

// taskAgentOf finds the roster agent working taskId of runId, if it is in the roster: the task's current one
// before a tab an earlier run left on it.
export function taskAgentOf<T extends { id: string; runId?: string }>(
    lineage: Lineage,
    agents: T[],
    runId: string,
    taskId: string
): T | undefined {
    const onTask = agents.filter((a) => {
        const role = lineage.roles[a.id];
        return role?.kind === "worker" && role.leadRunId === runId && role.taskId === taskId;
    });
    const run = lineage.runs[runId];
    return (run && onTask.find((a) => holdsTask(run, taskId, a))) ?? onTask[0];
}

// roleRunId is the run an agent's role belongs to, keyed by its lead's run id.
export function roleRunId(role: RunRole): string {
    return role.kind === "lead" ? role.runId : role.leadRunId;
}

// runAgentsOf is every roster tab a run still holds: its lead, its tasks' tabs and its stage sessions.
export function runAgentsOf<T extends { id: string }>(lineage: Lineage, agents: T[], runId: string): T[] {
    return agents.filter((a) => {
        const role = lineage.roles[a.id];
        return role != null && roleRunId(role) === runId;
    });
}

// leadRunTabIds is every tab of the run agentId leads, its own included, when the run holds any besides the lead:
// closing the lead alone would leave those nested under a lead-less run row. Undefined for anything else.
export function leadRunTabIds<T extends { id: string }>(
    lineage: Lineage,
    agents: T[],
    agentId: string
): string[] | undefined {
    const role = lineage.roles[agentId];
    if (role?.kind !== "lead") {
        return undefined;
    }
    const ids = runAgentsOf(lineage, agents, role.runId).map((a) => a.id);
    return ids.length > 1 ? ids : undefined;
}

const ENDED_WORKER_PREFIX = "ended:";

// endedWorkerId is what a done task's worker is focused by. Its session has ended, so the surface reads it back
// from its transcript, whether or not its tab is still in the roster.
export function endedWorkerId(runId: string, taskId: string): string {
    return `${ENDED_WORKER_PREFIX}${runId}:${taskId}`;
}

export function isEndedWorkerId(id: string): boolean {
    return id.startsWith(ENDED_WORKER_PREFIX);
}

// workerEnded reports a task whose worker has finished for good: the task is done, or its work merged and is
// being verified, which reaps the worker's tab with its tree.
export function workerEnded(task: TaskNode): boolean {
    return task.state === "done" || task.merged === true;
}

// endedRoles gives each task of the runs in view whose worker ended a worker role under its ended id, so the
// header and the rail place an ended worker as they place a live one.
export function endedRoles(runs: Record<string, RunInfo>): Record<string, RunRole> {
    const roles: Record<string, RunRole> = {};
    for (const run of Object.values(runs)) {
        for (const task of run.dag?.tasks ?? []) {
            if (workerEnded(task)) {
                roles[endedWorkerId(run.runId, task.id)] = { kind: "worker", leadRunId: run.runId, taskId: task.id };
            }
        }
    }
    return roles;
}

// endedWorkerVM is a done task's worker as the Agent surface shows it, from the child run the task last ran:
// idle since that run completed, and read from the transcript its session wrote.
export function endedWorkerVM(runId: string, task: TaskNode, child: Run | undefined, transcriptPath?: string): AgentVM {
    return {
        id: endedWorkerId(runId, task.id),
        name: task.label || task.id,
        task: task.label ?? "",
        state: "idle",
        agent: child?.runtime || undefined,
        model: modelLabel(child?.model),
        idleSince: child?.completedts,
        transcriptPath: transcriptPath || undefined,
        runId: task.runid,
    };
}

// runTitle names a run by its plan's title, else the first line of its goal.
export function runTitle(run: Run | undefined, dag: TaskGroup | undefined): string {
    const title = dag?.title?.trim();
    if (title) {
        return title;
    }
    return run?.goal?.trim().split("\n")[0] || "Orchestrator run";
}

// laneLabel is the letter a task's lane goes by, in the plan order the digest lists lanes in.
export function laneLabel(digest: DagStatusDigest | undefined, taskId: string): string | undefined {
    const i = (digest?.lanes ?? []).findIndex((lane) => lane.includes(taskId));
    if (i < 0) {
        return undefined;
    }
    return i < 26 ? String.fromCharCode(65 + i) : String(i + 1);
}

export type WorkerAsk = { owner: "lead"; deadline?: number } | { owner: "you" };

// workerAsk says who holds a task's open question, if it has one.
export function workerAsk(digest: DagStatusDigest | undefined, taskId: string): WorkerAsk | undefined {
    const td = digest?.tasks?.find((t) => t.taskid === taskId);
    if (td?.waitreason === "lead-ask") {
        return { owner: "lead", deadline: td.askdeadline };
    }
    if (td?.waitreason === "ask") {
        return { owner: "you" };
    }
    return undefined;
}

export function formatLeft(ms: number): string {
    return ms < 60_000 ? "<1m left" : `${Math.floor(ms / 60_000)}m left`;
}

export interface WorkerLine {
    taskId: string;
    lane?: string;
    age: string;
    ask?: WorkerAsk;
    // a finished task's outcome ("landed" / "done")
    outcome?: string;
    // a task that has not started: the dependencies it still waits on (empty = just queued)
    waits?: string[];
    // a task past or beside its worker's turn: verifying, reviewing, failed
    state?: string;
}

// workerSubtext is a worker row's second line, led by its task id since the row's title is the task's label:
// what it came to, what it waits on, whose turn its question is, what state it is in, else its lane and age.
export function workerSubtext(w: WorkerLine): string {
    const lane = w.lane ? `lane ${w.lane}` : "";
    let tail: string[];
    if (w.outcome) {
        tail = [lane, w.outcome];
    } else if (w.waits) {
        tail = [lane, w.waits.length > 0 ? `waits on ${w.waits.join(", ")}` : "queued"];
    } else if (w.ask?.owner === "lead") {
        tail = ["asked the lead", w.age];
    } else if (w.ask?.owner === "you") {
        tail = ["asks you", w.age];
    } else if (w.state) {
        // the state leads: the lane is what truncation should cut
        tail = [w.state, lane];
    } else {
        tail = [lane, w.age];
    }
    return [w.taskId, ...tail].filter(Boolean).join(" · ");
}

// states a worker row already says on its own: queued, running and done
const PLAIN_STATES = new Set(["pending", "ready", "running", "done"]);

// taskStateLabel names a task's state when its worker row would not show it, with how long a Verify has run.
export function taskStateLabel(task: TaskNode, now: number): string | undefined {
    if (PLAIN_STATES.has(task.state)) {
        return undefined;
    }
    const label = task.state.replace(/-/g, " ");
    return task.state === "verifying" && task.verifystartedts
        ? `${label} ${formatAgeShort(now - task.verifystartedts)}`
        : label;
}

const STAGE_LABELS: Record<string, string> = { "plan-reviewer": "Plan review", verifier: "Final verification" };

// stageLabel is what a stage session's row is titled.
export function stageLabel(stageRole: string): string {
    return STAGE_LABELS[stageRole] ?? stageRole;
}

const NOT_STARTED = new Set(["pending", "ready"]);

// unmetDeps is what a not-started task still waits on, or undefined once it has started.
export function unmetDeps(dag: TaskGroup | undefined, task: TaskNode): string[] | undefined {
    if (!NOT_STARTED.has(task.state)) {
        return undefined;
    }
    const byId = new Map((dag?.tasks ?? []).map((t) => [t.id, t] as const));
    return (task.deps ?? []).filter((d) => byId.get(d)?.state !== "done");
}

// runProgress counts a run's finished tasks: done or skipped, out of every task in the plan.
/** Pure: the run has ended, by its dag's status or, before a dag exists, its own. */
export function runFinished(run: Pick<RunInfo, "dag" | "status">): boolean {
    const status = run.dag?.status ?? run.status;
    return status === "done" || status === "cancelled";
}

export function runProgress(dag: TaskGroup | undefined): { done: number; total: number } {
    const tasks = dag?.tasks ?? [];
    return { done: tasks.filter((t) => t.state === "done" || t.state === "skipped").length, total: tasks.length };
}

// leadStandingBy reports a lead sitting at its prompt while its run's plan executes: between wakes it only waits
// for the engine, and the roster's folding of waiting into working would read that as busy.
export function leadStandingBy(agent: Pick<AgentVM, "atPrompt">, run: RunInfo): boolean {
    const status = run.dag?.status;
    return agent.atPrompt === true && run.dag != null && status !== "done" && status !== "cancelled";
}

// states in which the engine has a session or command at work: tasks.state, planreview.state, final.state
const TASK_IN_FLIGHT = new Set(["running", "reviewing", "verifying"]);
const PLAN_REVIEW_IN_FLIGHT = "reviewing";
const FINAL_IN_FLIGHT = new Set(["checking", "final", "verifying"]);

// final.step: the plan command the final stage is running
const FINAL_STEP_LABELS: Record<string, string> = {
    tree: "preparing the tree",
    check: "running Check",
    verify: "running Verify",
    final: "running Final",
};

/** Pure: what a running final stage is doing, or undefined when it is not running. With no Final command the
 *  verifier works alongside Check and Verify, so both show. */
export function finalStageActivity(final: FinalStage | undefined): string | undefined {
    if (final?.state === "verifying") {
        return "verifier reviewing";
    }
    if (final?.state !== "checking" && final?.state !== "final") {
        return undefined;
    }
    const step = FINAL_STEP_LABELS[final.step ?? ""] ?? "starting";
    return final.state === "checking" && final.verifierrunid ? `${step} · verifier alongside` : step;
}

/** Pure: the plan's own command behind the final stage's running step, so the label stays generic and the
 *  detail is whatever this project runs. */
export function finalStepCommand(group: Pick<TaskGroup, "check" | "verify" | "finalcmd" | "final">): string {
    switch (group.final?.step) {
        case "check":
            return group.check ?? "";
        case "verify":
            return group.verify ?? "";
        case "final":
            return group.finalcmd ?? "";
        default:
            return "";
    }
}

// runEngineBusy reports the engine at work on a run while its lead may be idle: a worker or reviewer on a task, a
// merge under Verify, the plan's review, or the final stage. A task waiting on a judgment does not count.
export function runEngineBusy(run: RunInfo): boolean {
    const dag = run.dag;
    if (dag == null) {
        return false;
    }
    return (
        (dag.tasks ?? []).some((t) => TASK_IN_FLIGHT.has(t.state)) ||
        dag.planreview?.state === PLAN_REVIEW_IN_FLIGHT ||
        FINAL_IN_FLIGHT.has(dag.final?.state ?? "")
    );
}
