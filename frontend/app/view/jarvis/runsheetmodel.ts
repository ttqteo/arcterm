// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The run sheet as data (docs/prototype/run-sheet.dc.html). The sheet used to carry two authorities on one
// run: RunHeader's pill read run.status and DagOverview's strip read the digest's health, so a run whose
// tasks had all finished read EXECUTING above "done · 4/4". Everything the sheet says about where a run
// stands — the verb, the meter, the meta line and next: — is derived here from one read, so none of them
// can disagree with another.
//
// A degraded read says what it cannot see. It never falls back to the run's launch snapshot, and a stale
// digest's figures are dated rather than presented as current.

import type { AgentVM } from "../agents/agentsviewmodel";
import { canResume, currentPhaseIndex, isTerminal, leadWorker } from "../agents/runmodel";
import {
    cleanupOnly,
    firstLine,
    formatElapsed,
    lastUpdatedText,
    nextStepText,
    planShapeText,
    reportChips,
    taskBriefs,
    waitingText,
    type DigestState,
    type TaskBrief,
} from "../orchestrate/dagdigest";
import type { TaskWorkerView } from "../orchestrate/taskcorrelate";
import { workerSortKey } from "../orchestrate/workertasksort";
import {
    routeLabel,
    runMachine,
    workersLabel,
    type LinkedGroupRead,
    type RunSettingsDraft,
    type RunSettingsPanelState,
} from "./runsettings";

// status tones, mapped onto @theme utilities by the view
export type SheetTone =
    | "success"
    | "success-soft"
    | "warning"
    | "warning-soft"
    | "error"
    | "error-soft"
    | "muted"
    | "faint"
    | "accent";

export type SheetMeta = { text: string; tone: SheetTone };

// The bar under the verb: the shared task strip (runstrip.ts), drawn from the live group. A stale read keeps the
// held digest's dated done/total instead: per-task colours would present old figures as current.
export type SheetBar = { kind: "strip" } | { kind: "stale"; done: number; total: number };

const STRIP: SheetBar = { kind: "strip" };

export type SheetStatus = {
    verb: string;
    sub: string;
    tone: SheetTone;
    pulse: boolean;
    meter: SheetBar | null;
    meta: SheetMeta[];
    // null when the sheet has no next move to state: a finished run, or a quick run with no scheduler
    next: string | null;
    // the digest read failed and can be retried from the meta line
    retry: boolean;
};

export type SheetDagRead = {
    digest: DigestState;
    group: TaskGroup | null;
    groupRead: LinkedGroupRead;
};

export type SheetRead = {
    run: Run;
    nowMs: number;
    // null when the run links no task graph
    dag: SheetDagRead | null;
    // the dag children's questions that are the human's to answer (userOwnedAsks); a question the lead
    // holds is not one, and counting it would say "waiting on you" about a run that is not
    userAsks: DagAskItem[];
    // the run's own worker — the lead, or a quick run's one worker — is asking the human
    workerAsking: boolean;
    survivors: number;
};

// Which runs the sheet draws. Slice 5c deleted the plan gate, adaptive orchestration and pipeline mode, but
// runs stored before it stay readable: they render through RunBody's pipeline rail and orchestrator body as
// before, rather than through states this sheet no longer has.
export function sheetRoute(run: Run): "sheet" | "legacy" {
    if (run.status === "awaiting-review" || run.plangatepending) {
        return "legacy";
    }
    if (run.mode === "orchestrator") {
        return runMachine(run) === "engine" ? "sheet" : "legacy";
    }
    return (run.mode || "quick") === "quick" ? "sheet" : "legacy";
}

// The task graph a run's status is read from. Only an orchestrator owns one: a task's worker is a quick run
// that carries its parent's dagoref, and reading the graph there would print the whole plan on one task.
export function runGraphRef(run: Run): string | null {
    return run.mode === "orchestrator" && (run.dagoref ?? "") !== "" ? run.dagoref : null;
}

// skipped counts as finished: a run that skipped a task and landed the rest has nothing left to dispatch,
// and a meter stuck one short would contradict the Landing verb beside it.
const FINISHED_TASK_STATES = new Set(["done", "skipped"]);

function finishedCount(group: TaskGroup): number {
    return group.tasks.filter((t) => FINISHED_TASK_STATES.has(t.state)).length;
}

function plural(n: number, word: string): string {
    return `${n} ${word}${n === 1 ? "" : "s"}`;
}

function since(nowMs: number, ts: number): string {
    return formatElapsed(Math.max(0, nowMs - ts));
}

export function sheetStatus(read: SheetRead): SheetStatus {
    switch (read.run.status) {
        case "done":
            return doneStatus(read);
        case "cancelled":
            return cancelledStatus(read);
        case "blocked":
            return blockedStatus(read);
    }
    return read.dag == null ? undaggedStatus(read) : daggedStatus(read, read.dag);
}

function doneStatus(read: SheetRead): SheetStatus {
    const { run, nowMs } = read;
    const group = read.dag?.group ?? null;
    const report = read.dag?.digest.digest?.report;
    const wallMs = run.evidence?.durationms || (run.completedts ? run.completedts - run.createdts : 0);
    const parts: string[] = [];
    if (group != null) {
        parts.push(plural(group.tasks.length, "task"), `${plural(report?.commits?.length ?? 0, "commit")} landed`);
    }
    if (wallMs > 0) {
        parts.push(formatElapsed(wallMs));
    }
    const meta: SheetMeta[] = [];
    if (run.completedts) {
        meta.push({ text: `finished ${since(nowMs, run.completedts)} ago`, tone: "muted" });
    }
    if (report?.workerms) {
        meta.push({ text: `workers ${formatElapsed(report.workerms)}`, tone: "muted" });
    }
    meta.push(
        run.evidence ? { text: "evidence sealed", tone: "success" } : { text: "sealing evidence", tone: "muted" }
    );
    return {
        verb: "Done",
        sub: parts.length > 0 ? parts.join(", ") : "the run finished",
        tone: "success",
        pulse: false,
        meter: group != null ? STRIP : null,
        meta,
        next: null,
        retry: false,
    };
}

function cancelledStatus(read: SheetRead): SheetStatus {
    const { run, nowMs, survivors } = read;
    const group = read.dag?.group ?? null;
    const sub =
        survivors > 0
            ? `${plural(survivors, "worker")} still running`
            : group != null
              ? `stopped after ${finishedCount(group)} of ${plural(group.tasks.length, "task")}`
              : "stopped before it finished";
    const meta: SheetMeta[] = [];
    if (run.completedts) {
        meta.push({ text: `cancelled ${since(nowMs, run.completedts)} ago`, tone: "error" });
    }
    if (survivors > 0) {
        meta.push({ text: plural(survivors, "survivor"), tone: "error" });
    }
    return {
        verb: "Cancelled",
        sub,
        tone: "error",
        pulse: false,
        meter: group != null ? STRIP : null,
        meta,
        next: group != null ? "nothing — the scheduler stopped dispatching" : null,
        retry: false,
    };
}

// A blocked run's worker died: the app restarted under it, or its process exited. Its phase recorded when it
// stopped, so the meta says how long it ran and how long ago it stopped, rather than an elapsed time that kept
// counting for a run nothing is running. What to do next is the sheet's to say: the dock offers Resume when the
// run can be resumed, and Cancel either way.
function blockedStatus(read: SheetRead): SheetStatus {
    const { run, nowMs } = read;
    const orch = run.mode === "orchestrator";
    const who = orch ? "lead" : "worker";
    const phaseIdx = currentPhaseIndex(run);
    const stoppedTs = run.phases?.[phaseIdx]?.donets ?? 0;
    const meta: SheetMeta[] =
        stoppedTs > 0
            ? [
                  { text: `ran ${since(stoppedTs, run.createdts)}`, tone: "muted" },
                  { text: `stopped ${since(nowMs, stoppedTs)} ago`, tone: "error-soft" },
              ]
            : [{ text: `${since(nowMs, run.createdts)} since launch`, tone: "muted" }];
    const resumable = canResume(run, phaseIdx);
    return {
        verb: "Blocked",
        sub:
            orch && runGraphRef(run) == null
                ? "the lead stopped before it submitted a plan"
                : `the ${who} is no longer running`,
        tone: "error",
        pulse: false,
        meter: null,
        meta,
        next: resumable
            ? `resume the ${who} in its own session to pick up where it stopped, or cancel the run`
            : "cancel the run and start a new one: this one cannot be resumed",
        retry: false,
    };
}

// A run with no task graph: an orchestrator whose lead has not submitted its plan yet, or a quick run,
// which never has one.
function undaggedStatus(read: SheetRead): SheetStatus {
    const { run, nowMs, workerAsking } = read;
    const elapsed: SheetMeta = { text: `${since(nowMs, run.createdts)} elapsed`, tone: "muted" };
    const quiet = { meter: null, retry: false };
    if (run.mode === "orchestrator") {
        const meta: SheetMeta[] = [elapsed, { text: "no plan yet", tone: "muted" }];
        if (workerAsking) {
            return {
                ...quiet,
                verb: "Waiting on you",
                sub: "the lead asked you a question",
                tone: "warning",
                pulse: true,
                meta,
                next: "the lead continues once you answer",
            };
        }
        return {
            ...quiet,
            verb: "Planning",
            sub: "the lead is writing the plan",
            tone: "muted",
            pulse: true,
            meta,
            next: "the engine dispatches the plan once the lead submits it",
        };
    }
    const meta: SheetMeta[] = [elapsed, { text: "1 worker", tone: "muted" }];
    if (workerAsking) {
        return {
            ...quiet,
            verb: "Waiting on you",
            sub: "the worker asked you a question",
            tone: "warning",
            pulse: true,
            meta,
            next: null,
        };
    }
    if (run.status === "planning") {
        return {
            ...quiet,
            verb: "Starting",
            sub: "the worker is starting",
            tone: "muted",
            pulse: true,
            meta,
            next: null,
        };
    }
    return { ...quiet, verb: "Executing", sub: "one worker, no plan", tone: "success", pulse: true, meta, next: null };
}

function daggedStatus(read: SheetRead, dag: SheetDagRead): SheetStatus {
    const { run, nowMs } = read;
    const state = dag.digest;
    const digest = state.digest;
    const elapsed: SheetMeta = {
        text: `${formatElapsed(digest?.durations?.elapsedms || Math.max(0, nowMs - run.createdts))} elapsed`,
        tone: "muted",
    };
    if (dag.groupRead === "loading" || (dag.groupRead === "ready" && digest == null && state.loading)) {
        return {
            verb: "Executing",
            sub: "reading the task graph…",
            tone: "muted",
            pulse: true,
            meter: null,
            meta: [elapsed],
            next: null,
            retry: false,
        };
    }
    if (dag.groupRead !== "ready" || dag.group == null || digest == null) {
        return {
            verb: "Executing",
            sub: "the run is live, but its task graph could not be read",
            tone: "error",
            pulse: false,
            meter: null,
            meta: [elapsed, { text: "dag unavailable", tone: "error" }],
            next: "unknown",
            // only a failed digest read can be retried from here; a missing group is not coming back
            retry: dag.groupRead === "ready" && dag.group != null,
        };
    }
    const group = dag.group;
    if (state.stale && state.error != null && !state.loading) {
        const age = state.lastUpdatedTs != null ? since(nowMs, state.lastUpdatedTs) : null;
        const meta: SheetMeta[] = age != null ? [{ text: `as of ${age} ago`, tone: "warning" }] : [];
        meta.push({ text: "refresh failed", tone: "warning" });
        return {
            verb: "Status is stale",
            sub:
                age != null
                    ? `the last status read failed; these figures are ${age} old`
                    : "the last status read failed",
            tone: "muted",
            pulse: false,
            // the held digest's own figures, not the live group's: the meter is dated with everything else
            meter: { kind: "stale", done: digest.counts.done, total: digest.counts.total },
            meta,
            next: "unknown — the engine's next move could not be read",
            retry: true,
        };
    }

    const total = group.tasks.length;
    const finished = finishedCount(group);
    const briefs = taskBriefs(group);
    const meta: SheetMeta[] = [elapsed];
    for (const chip of reportChips(digest.report)) {
        meta.push({ text: chip, tone: chip === "unverified" ? "warning" : "muted" });
    }
    if (digest.counts.attention > 0) {
        meta.push({ text: `attention ${digest.counts.attention}`, tone: "warning" });
    }
    if (digest.counts.mergeready > 0) {
        meta.push({ text: `merge ${digest.counts.mergeready}`, tone: "warning" });
    }
    // a digest held while its successor loads is the previous version: say so rather than "updated 1s ago"
    const updated = state.stale ? "refreshing" : lastUpdatedText(state, nowMs);
    if (updated != null) {
        meta.push({ text: updated, tone: "muted" });
    }
    const meter = STRIP;
    const next = nextStepText(digest.next, briefs);
    const running = digest.counts.running;

    if (read.userAsks.length > 0 || read.workerAsking) {
        return {
            verb: "Waiting on you",
            sub: askSub(read, briefs),
            tone: "warning",
            pulse: true,
            meter,
            meta,
            next,
            retry: false,
        };
    }
    if (digest.next.kind === "terminal" && digest.next.terminalstatus === "done") {
        return {
            verb: "Landing",
            sub: `all ${plural(total, "task")} done, nothing left to dispatch`,
            tone: "warning",
            pulse: true,
            meter,
            meta,
            next: "nothing to dispatch — the lead is finishing the run",
            retry: false,
        };
    }
    if (cleanupOnly(digest)) {
        const left = (digest.tasks ?? []).filter((td) => td.humanactions?.[0] === "retry-cleanup").length;
        return {
            verb: "Cleanup failed",
            sub: `${plural(left, "worktree")} could not be removed`,
            tone: "warning",
            pulse: false,
            meter,
            meta,
            next,
            retry: false,
        };
    }
    if (digest.next.kind === "human-action") {
        const needing = digest.counts.attention || (digest.next.taskids?.length ?? 0);
        const needs = `${plural(needing, "task")} need${needing === 1 ? "s" : ""} you`;
        return {
            verb: running > 0 ? "Executing" : "Waiting on you",
            sub: running > 0 ? `${finished} of ${total} done · ${needs}` : `${needs}; nothing else is running`,
            tone: "warning",
            pulse: true,
            meter,
            meta,
            next,
            retry: false,
        };
    }
    return {
        verb: "Executing",
        sub:
            `${finished} of ${plural(total, "task")} done` + (running > 0 ? `, ${plural(running, "worker")} live` : ""),
        tone: "success",
        pulse: true,
        meter,
        meta,
        next,
        retry: false,
    };
}

function askSub(read: SheetRead, briefs: Map<string, TaskBrief>): string {
    const asks = read.userAsks;
    if (asks.length === 0) {
        return "the lead asked you a question";
    }
    if (asks.length > 1) {
        return `${plural(asks.length, "question")} waiting on you`;
    }
    const ask = asks[0];
    const label = briefs.get(ask.taskid)?.label || ask.taskid;
    return `${label}'s worker asked a question ${since(read.nowMs, ask.ts)} ago`;
}

// The launcher face's reading. "New run" can open the launcher while a run is still live in the project,
// so "Nothing running" is only said when it is true.
export function launcherReading(runs: Run[], nowMs: number): { verb: string; sub: string } {
    const live = runs.filter((r) => r.status !== "done" && r.status !== "cancelled" && r.status !== "failed").length;
    if (live > 0) {
        return { verb: "New run", sub: `${plural(live, "run")} still live in this project` };
    }
    const lastEnded = Math.max(0, ...runs.map((r) => r.completedts ?? 0));
    return {
        verb: "Nothing running",
        sub: lastEnded > 0 ? `last run ended ${since(nowMs, lastEnded)} ago` : "no run in this project yet",
    };
}

// What the tasks heading says beside its label.
export function taskSectionMeta(run: Run, digest: DagStatusDigest | undefined): string {
    if (run.mode !== "orchestrator") {
        return "none — a quick run has no graph";
    }
    if (runGraphRef(run) == null) {
        return run.status === "blocked" ? "none — no plan was submitted" : "not decided yet";
    }
    return planShapeText(digest?.shape) ?? "";
}

// --- task rows ---------------------------------------------------------------------------------------

// Exception-first, with the graph's own order as the tie-break so rows only move when their bucket changes.
export function orderedTasks(
    group: TaskGroup,
    digest: DagStatusDigest | undefined
): { task: TaskNode; td: DagTaskDigest | undefined }[] {
    const byId = new Map((digest?.tasks ?? []).map((td) => [td.taskid, td]));
    return group.tasks
        .map((task, i) => ({ task, td: byId.get(task.id), i }))
        .sort((a, b) => sortKey(a.task, a.td) - sortKey(b.task, b.td) || a.i - b.i)
        .map(({ task, td }) => ({ task, td }));
}

function sortKey(task: TaskNode, td: DagTaskDigest | undefined): number {
    return workerSortKey(
        td ?? { taskid: task.id, waitreason: "", mergestate: "not-required", cleanupstate: "clear" },
        task
    );
}

export type SheetRowAction = "open-agent" | "open-child-run" | "open-dag-task" | null;

export type SheetRow = {
    taskId: string;
    label: string;
    meta: string;
    metaTone: SheetTone;
    state: string;
    stateTone: SheetTone;
    action: SheetRowAction;
};

export type SheetRowInput = {
    task: TaskNode;
    td: DagTaskDigest | undefined;
    worker: TaskWorkerView;
    briefs: Map<string, TaskBrief>;
    lanes: string[][] | undefined;
    durations: DagTaskDuration[] | undefined;
    // the recovery line (recoveryText), or null when the task has no failure history
    recovery: string | null;
    // who holds the task's open question, when it has one
    askOwner: "user" | "lead" | null;
    nowMs: number;
    // set when the digest is stale: every figure on the row is dated with it
    asOf: string | null;
};

function shortRun(runId: string): string {
    return `child run ${runId.slice(0, 4)}`;
}

function laneOf(taskId: string, lanes: string[][] | undefined): number | null {
    const idx = (lanes ?? []).findIndex((lane) => lane.includes(taskId));
    return idx >= 0 ? idx + 1 : null;
}

// One task as one row. Failure text is the row's own state column plus one meta line, never extra lines
// stacked above the task; and the action is the one that still works for the worker's actual state.
export function taskRow(input: SheetRowInput): SheetRow {
    const row = liveTaskRow(input);
    if (input.asOf == null) {
        return row;
    }
    return {
        ...row,
        meta: row.meta ? `${input.asOf} · ${row.meta}` : input.asOf,
        metaTone: "muted",
        state: row.state === "running" ? "running?" : row.state,
        stateTone: "muted",
    };
}

function liveTaskRow(input: SheetRowInput): SheetRow {
    const { task, td, worker } = input;
    const base = { taskId: task.id, label: task.label || task.id };
    const dispatched = worker.state === "dispatched";
    const workerAction: SheetRowAction = dispatched ? "open-agent" : task.runid ? "open-child-run" : null;

    if (td?.waitreason === "ask" || td?.waitreason === "lead-ask") {
        const age = td.askts ? ` · idle ${since(input.nowMs, td.askts)}` : "";
        // the digest says lead-ask for a question the lead holds; askOwner comes from the asks list, which can lag it
        const lead = td.waitreason === "lead-ask" || input.askOwner === "lead";
        return {
            ...base,
            meta: lead ? `asked the lead${age}` : `asked you${age}`,
            metaTone: "warning",
            state: "asking",
            stateTone: "warning",
            action: workerAction,
        };
    }
    switch (task.state) {
        case "running":
        case "verifying": {
            if (dispatched) {
                return {
                    ...base,
                    meta: worker.agent?.activity || (task.state === "verifying" ? "running Verify" : "working"),
                    metaTone: "success-soft",
                    state: task.state,
                    stateTone: "success",
                    action: "open-agent",
                };
            }
            // Verify runs in the project checkout after the engine reaped the lane's worker: no session is expected
            if (task.state === "verifying") {
                return {
                    ...base,
                    meta: "running Verify",
                    metaTone: "success-soft",
                    state: "verifying",
                    stateTone: "success",
                    action: "open-dag-task",
                };
            }
            if (task.runid) {
                return {
                    ...base,
                    meta: `${shortRun(task.runid)} · session closed, work continues`,
                    metaTone: "muted",
                    state: "no session",
                    stateTone: "muted",
                    action: "open-child-run",
                };
            }
            return {
                ...base,
                meta: "starting",
                metaTone: "muted",
                state: task.state,
                stateTone: "success",
                action: null,
            };
        }
        case "done": {
            const lane = laneOf(task.id, input.lanes);
            const runMs = input.durations?.find((d) => d.taskid === task.id)?.runms;
            const parts = [
                lane != null ? `lane ${lane}` : null,
                runMs ? formatElapsed(runMs) : null,
                task.runid ? shortRun(task.runid) : null,
            ].filter((p): p is string => p != null);
            return {
                ...base,
                meta: parts.join(" · "),
                metaTone: "muted",
                state: "done",
                stateTone: "success",
                action: workerAction,
            };
        }
        case "reviewing": {
            const round = (task.reviewround ?? 0) + 1;
            return {
                ...base,
                meta: round > 1 ? `review round ${round}` : "reviewer checking the commit",
                metaTone: "success-soft",
                state: "reviewing",
                stateTone: "success",
                action: "open-dag-task",
            };
        }
        case "review-failed":
            return {
                ...base,
                meta: firstLine(task.reviewnote) || "review failed",
                metaTone: "warning",
                state: "review failed",
                stateTone: "warning",
                action: "open-dag-task",
            };
        case "failed":
        case "stalled":
            return {
                ...base,
                meta: input.recovery ?? (task.lastfailurekind || task.state),
                metaTone: "error-soft",
                state: task.state,
                stateTone: "error",
                action: workerAction,
            };
        case "blocked-merge":
        case "verify-failed":
            return {
                ...base,
                meta: firstLine(task.state === "verify-failed" ? task.verifyerror : task.mergeerror) || "merge blocked",
                metaTone: "warning",
                state: task.state,
                stateTone: "warning",
                action: "open-dag-task",
            };
        case "pending":
        case "ready":
            return {
                ...base,
                meta: waitingText(td, input.briefs),
                metaTone: "muted",
                state: "queued",
                stateTone: "muted",
                action: null,
            };
        case "skipped":
            return {
                ...base,
                meta: "skipped by the lead",
                metaTone: "muted",
                state: "skipped",
                stateTone: "muted",
                action: null,
            };
        case "cancelled":
            return {
                ...base,
                meta: task.runid ? shortRun(task.runid) : "never dispatched",
                metaTone: "muted",
                state: "cancelled",
                stateTone: "muted",
                action: workerAction,
            };
    }
    return { ...base, meta: "", metaTone: "muted", state: task.state, stateTone: "muted", action: workerAction };
}

// --- the dock's config line -----------------------------------------------------------------------------

// The run's configuration as one printed line, the way the dock shows it until the dials are asked for. Only
// an editable run has a line — every other run gets a note in the same slot. A draft the scheduler refused
// (or that never left the panel) is printed with "not saved", so a collapsed panel still tells the truth.
export function configLine(run: Run, draft: RunSettingsDraft, notSaved: boolean): string {
    if (notSaved) {
        return `engine · orchestrator · parallelism ${draft.parallelism} — not saved`;
    }
    return [
        "engine",
        "orchestrator",
        `lead ${[run.runtime || "claude", run.model || "default"].join("/")}`,
        // a run launched before widths were resolved at launch stores 0: the engine picks at submit
        draft.parallelism > 0 ? `parallelism ${draft.parallelism}` : "parallelism set at submit",
        `workers ${workersLabel(draft)}`,
        // only when set, so a run that never chose one prints the line it always did
        ...(draft.reviewerRoute != null ? [`reviewers ${routeLabel(draft.reviewerRoute)}`] : []),
    ].join(" · ");
}

export type ConfigNote = { title: string; body: string; tone: SheetTone; pulse: boolean };

// What the dock says where the dials would be when there are none to offer. Null means the panel is
// editable, and the printed line with its Adjust control takes the slot.
export function configNote(run: Run, state: RunSettingsPanelState): ConfigNote | null {
    switch (state.kind) {
        case "editable":
            return null;
        case "missing":
            return { title: "This run is no longer available.", body: "", tone: "faint", pulse: false };
        case "loading":
            return {
                title: "Reading this run's plan…",
                body: "The engine owns these settings once a plan exists, so they are read live rather than guessed from what the run launched with.",
                tone: "muted",
                pulse: true,
            };
        case "unavailable":
            return {
                title:
                    state.reason === "error"
                        ? "This run's plan could not be read."
                        : "This run's plan is no longer available.",
                body: "The engine owns these settings once a plan exists, so no controls are offered over a value the scheduler may not be honouring.",
                tone: "error",
                pulse: false,
            };
    }
    return { title: `Settings are fixed: ${state.reason}.`, body: readonlyBody(run), tone: "faint", pulse: false };
}

function readonlyBody(run: Run): string {
    // only a finished orchestrator carries its configuration forward; its dock has the button this names
    if (run.status === "done" && run.mode === "orchestrator") {
        return "Save its configuration as this project's defaults to launch the next run the same way.";
    }
    if (run.status === "cancelled") {
        return "Lowering parallelism would not reach workers that are already running.";
    }
    if (run.mode === "orchestrator") {
        return "";
    }
    return `Parallelism and a worker route only exist for an orchestrator. Its route was fixed at launch: ${[
        run.runtime || "claude",
        run.model || "default",
    ].join(" · ")}.`;
}

// the final stage's running states: its commands, then its verifier. A human can end any of them.
const RUNNING_FINAL_STATES = new Set(["checking", "final", "verifying"]);

export function finalStageEndable(group: TaskGroup | null): boolean {
    return group != null && group.status !== "cancelled" && RUNNING_FINAL_STATES.has(group.final?.state ?? "");
}

// the dock's Open lead: a live orchestrator's lead, whose terminal the Agent surface shows
export function sheetLead(run: Run, agents: AgentVM[]): AgentVM | undefined {
    return run.mode === "orchestrator" && !isTerminal(run.status) ? leadWorker(run, agents) : undefined;
}

// a done run's body: its filed report, else the sealed evidence (design L508, L539)
export function doneBody(run: Pick<Run, "status" | "report">): "report" | "evidence" | null {
    if (run.status !== "done") {
        return null;
    }
    return (run.report ?? "").trim() !== "" ? "report" : "evidence";
}

// both bodies link the repository diff; evidence still sealing shows a placeholder without one
export function doneBodyHasDiff(run: Pick<Run, "status" | "report" | "evidence">): boolean {
    const body = doneBody(run);
    return body === "report" || (body === "evidence" && run.evidence != null);
}
