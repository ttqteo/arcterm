// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Pure view-model logic for the Agent surface's left tree. No React, no Wave runtime imports.
// Produces group headers, agent rows, and each orchestrator run's workers nested under its lead; subagent
// children are read from per-block atoms in the component (they're ephemeral and keyed by block ORef), so
// they stay out of this pure helper.

import { projectOf, type AgentVM } from "./agentsviewmodel";
import { endedWorkerId, holdsTask, NO_LINEAGE, workerAsk, type Lineage, type RunInfo } from "./runlineage";

export const UNGROUPED_PROJECT = "ungrouped";

export type AgentTreeRow =
    | { kind: "group"; project: string; count: number; attn: number }
    | { kind: "parent"; agent: AgentVM; project: string }
    // an orchestrator lead; `live` counts its workers that are not done
    | { kind: "lead"; agent: AgentVM; project: string; run: RunInfo; open: boolean; live: number }
    // a run whose workers are in the roster but whose lead is not: a plan-path run before its first lead
    | { kind: "run"; project: string; run: RunInfo; open: boolean; live: number }
    // a task's worker; a done task whose session is gone has no agent. `extras` counts the task's other tabs (its
    // reviewer, an earlier attempt), listed as `nested` rows beneath it while `extrasOpen`
    | {
          kind: "worker";
          agent?: AgentVM;
          project: string;
          run: RunInfo;
          task: TaskNode;
          nested?: boolean;
          extras?: number;
          extrasOpen?: boolean;
      }
    // a session the engine started to judge the whole run: its plan reviewer, its final verifier. `outcome` is its
    // verdict once it has one
    | { kind: "stage"; agent: AgentVM; project: string; run: RunInfo; stageRole: string; outcome?: StageOutcome }
    // the fold of what finished: `count` done tasks and `stages` stage sessions with a verdict
    | { kind: "done"; project: string; run: RunInfo; count: number; stages: number; open: boolean }
    | { kind: "queued"; project: string; run: RunInfo; count: number; open: boolean };

// TreeFolds is what the human folded: runs whose workers are hidden, runs whose done or queued tasks are listed,
// and tasks (by taskFoldKey) whose other tabs are listed. A done fold is keyed to how many tasks were done when it
// opened, so the next landing closes it: left open, every landing would push the run's live workers further down.
export interface TreeFolds {
    collapsed: ReadonlySet<string>;
    doneOpen: ReadonlyMap<string, number>;
    queuedOpen: ReadonlySet<string>;
    extrasOpen: ReadonlySet<string>;
}

const NO_FOLDS: TreeFolds = { collapsed: new Set(), doneOpen: new Map(), queuedOpen: new Set(), extrasOpen: new Set() };

export function taskFoldKey(runId: string, taskId: string): string {
    return `${runId}:${taskId}`;
}

// splitTaskTabs picks the tab a task's row stands for, its worker, and leaves the rest to nest beneath it. With no
// worker tab left, a done task's row is its ended worker's transcript, so every tab nests; otherwise the first stands in.
function splitTaskTabs(task: TaskNode, agents: AgentVM[]): { primary?: AgentVM; extras: AgentVM[] } {
    const i = agents.findIndex((a) => a.runId != null && a.runId === task.runid);
    if (i >= 0) {
        return { primary: agents[i], extras: agents.filter((_, j) => j !== i) };
    }
    if (task.state === "done") {
        return { primary: undefined, extras: agents };
    }
    const [primary, ...extras] = agents;
    return { primary, extras };
}

type TopItem =
    | { kind: "parent"; agent: AgentVM; project: string }
    | { kind: "lead"; agent: AgentVM; project: string; run: RunInfo }
    | { kind: "run"; project: string; run: RunInfo };

// A worker waits on the human only when the human holds its question; one asking its lead does not. With
// no digest yet, asking is the only signal there is.
export function workerNeedsYou(run: RunInfo, taskId: string, agent: AgentVM | undefined): boolean {
    if (run.digest == null) {
        return agent?.state === "asking";
    }
    return workerAsk(run.digest, taskId)?.owner === "you";
}

const QUEUED = new Set(["pending", "ready"]);
// settled without landing: nothing more happens to it, so with no tab left it has no row
const DROPPED = new Set(["skipped", "cancelled"]);

type StageAgent = { agent: AgentVM; stageRole: string };

export type StageOutcome = "passed" | "accepted" | "failed" | "unverified";

const PLAN_REVIEW_OUTCOMES: Record<string, StageOutcome> = { passed: "passed", accepted: "accepted", failed: "failed" };
const FINAL_OUTCOMES: Record<string, StageOutcome> = { passed: "passed", unverified: "unverified", failed: "failed" };

/** Pure: a stage session's verdict, or undefined while it is still judging. The dag keeps only the current
 *  round, so a session from an earlier round reads as failed: a stage gets another round only after one fails.
 *  A session the engine replaced within a round is stopped with its tab, so it has no row to misread. */
export function stageOutcome(
    run: RunInfo,
    stageRole: string,
    agentRunId: string | undefined
): StageOutcome | undefined {
    const stage =
        stageRole === "plan-reviewer"
            ? { cur: run.dag?.planreview, runId: run.dag?.planreview?.runid, outcomes: PLAN_REVIEW_OUTCOMES }
            : { cur: run.dag?.final, runId: run.dag?.final?.verifierrunid, outcomes: FINAL_OUTCOMES };
    if (stage.cur == null || agentRunId == null) {
        return undefined;
    }
    if (stage.runId !== agentRunId) {
        return stage.cur.round > 1 ? "failed" : undefined;
    }
    return stage.outcomes[stage.cur.state];
}

// stageSubline is a stage row's second line: its verdict and age. the row's title already names the role.
export function stageSubline(outcome: StageOutcome | undefined, age: string): string {
    return [outcome, age].filter(Boolean).join(" · ");
}

// history order: a plan review came before any task, a final verification after every one, and within a stage an
// earlier round (failed) before the current one
const stageRank = (s: StageAgent & { outcome?: StageOutcome }) =>
    (s.stageRole === "plan-reviewer" ? 0 : 2) + (s.outcome === "failed" ? 0 : 1);

function runRows(
    item: Extract<TopItem, { kind: "lead" | "run" }>,
    workers: Map<string, AgentVM[]>,
    stages: StageAgent[],
    folds: TreeFolds,
    focusId: string | undefined
): { rows: AgentTreeRow[]; members: number; attn: number } {
    const { run, project } = item;
    const tasks = run.dag?.tasks ?? [];
    // a task past its worker is still under way: verifying its merge, or failed and waiting on a judgment. Cleanup
    // reaps its worker's tab with the tree, so it keeps its row with no agent
    const live = tasks.filter(
        (t) => t.state !== "done" && (workers.has(t.id) || !(QUEUED.has(t.state) || DROPPED.has(t.state)))
    );
    const done = tasks.filter((t) => t.state === "done");
    // tasks not dispatched yet have no session to open, so they fold away until asked for
    const queued = tasks.filter((t) => QUEUED.has(t.state) && !workers.has(t.id));
    const open = !folds.collapsed.has(run.runId);
    const judged = stages
        .map((s) => ({ ...s, outcome: stageOutcome(run, s.stageRole, s.agent.runId) }))
        .sort((a, b) => stageRank(a) - stageRank(b));
    const judging = judged.filter((s) => s.outcome == null);
    const finished = judged.filter((s) => s.outcome != null);
    const busy = live.length + judging.length;
    const head: AgentTreeRow =
        item.kind === "lead"
            ? { kind: "lead", agent: item.agent, project, run, open, live: busy }
            : { kind: "run", project, run, open, live: busy };
    const rows: AgentTreeRow[] = [head];
    // a task's row is its worker's; its reviewer and any tab an earlier attempt left fold beneath it, opening on
    // their own when one of them asks
    const pushTask = (task: TaskNode) => {
        const { primary, extras } = splitTaskTabs(task, workers.get(task.id) ?? []);
        const extrasOpen =
            extras.length > 0 &&
            (folds.extrasOpen.has(taskFoldKey(run.runId, task.id)) || extras.some((a) => a.state === "asking"));
        rows.push({ kind: "worker", agent: primary, project, run, task, extras: extras.length, extrasOpen });
        if (extrasOpen) {
            for (const agent of extras) {
                rows.push({ kind: "worker", agent, project, run, task, nested: true });
            }
        }
    };
    const pushStage = ({ agent, stageRole, outcome }: (typeof judged)[number]) =>
        rows.push({ kind: "stage", agent, project, run, stageRole, outcome });
    if (open) {
        // oldest first: what finished, what is running, what is still to come
        if (done.length > 0 || finished.length > 0) {
            // the worker being read keeps its fold open, or a landing would pull its row out from under it
            const doneOpen =
                folds.doneOpen.get(run.runId) === done.length ||
                done.some((t) => endedWorkerId(run.runId, t.id) === focusId);
            rows.push({ kind: "done", project, run, count: done.length, stages: finished.length, open: doneOpen });
            if (doneOpen) {
                finished.filter((s) => s.stageRole === "plan-reviewer").forEach(pushStage);
                done.forEach(pushTask);
                finished.filter((s) => s.stageRole !== "plan-reviewer").forEach(pushStage);
            }
        }
        live.forEach(pushTask);
        // a stage still judging is what the run is doing now, so it sits between what finished and what is to come
        judging.forEach(pushStage);
        if (queued.length > 0) {
            const queuedOpen = folds.queuedOpen.has(run.runId);
            rows.push({ kind: "queued", project, run, count: queued.length, open: queuedOpen });
            if (queuedOpen) {
                queued.forEach(pushTask);
            }
        }
    }
    const attn = live.filter((t) => workerNeedsYou(run, t.id, workers.get(t.id)?.[0])).length;
    const agents = live.filter((t) => workers.has(t.id)).length + judging.length;
    return { rows, members: agents, attn };
}

/** Pure: roster + anchored order -> [group, ...rows] per project. Projects appear in the first-seen order
 *  of `order`; top-level rows within a group follow `order` (ids absent from `order` sort last). A run's
 *  workers follow its lead in plan order, and a run with no lead in the roster takes the place of its first
 *  worker. `count` is the group's visible agents, done workers aside; `attn` is how many wait on the human. */
export function buildAgentTree(
    agents: AgentVM[],
    order: string[],
    lineage: Lineage = NO_LINEAGE,
    folds: TreeFolds = NO_FOLDS,
    focusId?: string
): AgentTreeRow[] {
    const rank = new Map(order.map((id, i) => [id, i] as const));
    const sorted = [...agents].sort(
        (a, b) => (rank.get(a.id) ?? Number.POSITIVE_INFINITY) - (rank.get(b.id) ?? Number.POSITIVE_INFINITY)
    );
    const leads = new Map<string, AgentVM>();
    const workers = new Map<string, Map<string, AgentVM[]>>();
    const stages = new Map<string, StageAgent[]>();
    for (const a of sorted) {
        const role = lineage.roles[a.id];
        if (role?.kind === "lead" && lineage.runs[role.runId] && !leads.has(role.runId)) {
            leads.set(role.runId, a);
        } else if (role?.kind === "stage" && lineage.runs[role.leadRunId]) {
            stages.set(role.leadRunId, [
                ...(stages.get(role.leadRunId) ?? []),
                { agent: a, stageRole: role.stageRole },
            ]);
        } else if (role?.kind === "worker" && lineage.runs[role.leadRunId]) {
            let byTask = workers.get(role.leadRunId);
            if (!byTask) {
                byTask = new Map();
                workers.set(role.leadRunId, byTask);
            }
            byTask.set(role.taskId, [...(byTask.get(role.taskId) ?? []), a]);
        }
    }
    // the task's current run leads its agents, so a tab left from an earlier attempt never takes its row
    for (const [runId, byTask] of workers) {
        const run = lineage.runs[runId];
        for (const [taskId, list] of byTask) {
            list.sort((a, b) => Number(holdsTask(run, taskId, b)) - Number(holdsTask(run, taskId, a)));
        }
    }

    const groups: { project: string; items: TopItem[] }[] = [];
    const byProject = new Map<string, TopItem[]>();
    const push = (item: TopItem) => {
        let items = byProject.get(item.project);
        if (!items) {
            items = [];
            byProject.set(item.project, items);
            groups.push({ project: item.project, items });
        }
        items.push(item);
    };
    const placedRuns = new Set<string>();
    for (const a of sorted) {
        const role = lineage.roles[a.id];
        if (role?.kind === "lead" && leads.get(role.runId) === a) {
            placedRuns.add(role.runId);
            push({ kind: "lead", agent: a, project: projectOf(a) || UNGROUPED_PROJECT, run: lineage.runs[role.runId] });
        } else if ((role?.kind === "worker" || role?.kind === "stage") && lineage.runs[role.leadRunId]) {
            if (leads.has(role.leadRunId) || placedRuns.has(role.leadRunId)) {
                continue;
            }
            placedRuns.add(role.leadRunId);
            const run = lineage.runs[role.leadRunId];
            push({ kind: "run", project: run.project || UNGROUPED_PROJECT, run });
        } else {
            push({ kind: "parent", agent: a, project: projectOf(a) || UNGROUPED_PROJECT });
        }
    }

    const rows: AgentTreeRow[] = [];
    for (const g of groups) {
        const body: AgentTreeRow[] = [];
        let count = 0;
        let attn = 0;
        for (const item of g.items) {
            if (item.kind === "parent") {
                body.push(item);
                count++;
                attn += item.agent.state === "asking" ? 1 : 0;
                continue;
            }
            const r = runRows(
                item,
                workers.get(item.run.runId) ?? new Map(),
                stages.get(item.run.runId) ?? [],
                folds,
                focusId
            );
            body.push(...r.rows);
            count += r.members + (item.kind === "lead" ? 1 : 0);
            attn += r.attn + (item.kind === "lead" && item.agent.state === "asking" ? 1 : 0);
        }
        rows.push({ kind: "group", project: g.project, count, attn }, ...body);
    }
    return rows;
}

/** Pure: the tree with each collapsed project's body rows removed. Its group row stays, carrying the count
 *  and attention of what it hides, so a collapsed project still says when an agent in it waits on you. */
export function foldCollapsedProjects(rows: AgentTreeRow[], collapsed: ReadonlySet<string>): AgentTreeRow[] {
    if (collapsed.size === 0) {
        return rows;
    }
    const out: AgentTreeRow[] = [];
    let hiding = false;
    for (const r of rows) {
        if (r.kind === "group") {
            hiding = collapsed.has(r.project);
            out.push(r);
        } else if (!hiding) {
            out.push(r);
        }
    }
    return out;
}
