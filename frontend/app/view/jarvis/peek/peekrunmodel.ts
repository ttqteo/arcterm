// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The run body of the avatar popup's item view (PeekRun.dc.html), as data. Every fact here is one the run sheet
// and the agent tree already derive; this module only arranges them: the header, one meta line, the goal, the
// phase strip, the unverified line and the task list. A quick run has no plan, so it has no strip and no list.

import { formatTokens } from "@/app/view/agents/agentsviewmodel";
import { shortModel } from "@/app/view/agents/modelname";
import { runProgress, runTitle } from "@/app/view/agents/runlineage";
import { isOrchestrator, runStatusView, type RunStatusTone } from "@/app/view/agents/runmodel";
import { summarizeUsage } from "@/app/view/agents/runusage";
import { formatElapsed } from "@/app/view/orchestrate/dagdigest";
import type { PeekFacts } from "../peekstore";

export type PeekTone = "done" | "running" | "warning" | "failed" | "pending";

export type PeekPhase = { label: string; state: string; tone: PeekTone };

export type PeekTaskRow = { id: string; title: string; mark: PeekTone; state: string; tokens: string };

export type PeekRunMeta = { text: string; runtime?: string; faint?: boolean };

export type PeekRunView = {
    title: string;
    status: { label: string; tone: RunStatusTone };
    meta: PeekRunMeta[];
    // null when the title already says all of it
    goal: string | null;
    // null for a quick run, which has no plan, review or final stage
    phases: PeekPhase[] | null;
    // what the final stage could not verify, only when it ended unverified
    unverified: string | null;
    tasks: PeekTaskRow[] | null;
    // the landed range and its size, when either is known
    commits: string | null;
};

export type PeekRunInput = {
    run: Run;
    // the run's live task graph; null before the lead submits a plan, and always for a quick run
    group: TaskGroup | null;
    usage: UsageRow[] | undefined;
    // the digest's landed commits, when the digest has been read
    commitCount: number | undefined;
    project: string;
    now: number;
};

const TERMINAL = new Set(["done", "cancelled", "failed", "blocked"]);

function plural(n: number, word: string): string {
    return `${n} ${word}${n === 1 ? "" : "s"}`;
}

function wallMs(run: Run, now: number): number {
    return run.evidence?.durationms || Math.max(0, (run.completedts || now) - run.createdts);
}

function leadLabel(run: Run): string {
    const runtime = run.runtime || "claude";
    return run.model ? `${runtime} ${shortModel(run.model)}` : runtime;
}

function runMeta(input: PeekRunInput): PeekRunMeta[] {
    const { run, usage, project, now } = input;
    const meta: PeekRunMeta[] = [{ text: isOrchestrator(run) ? "orchestrator" : "quick" }];
    if (project !== "") {
        meta.push({ text: project });
    }
    meta.push({ text: leadLabel(run), runtime: run.runtime || "claude" });
    meta.push({ text: formatElapsed(wallMs(run, now)) });
    const spent = summarizeUsage(usage);
    if (spent != null) {
        meta.push({ text: `${formatTokens(spent.total)} tok` });
    }
    meta.push({ text: `${formatElapsed(Math.max(0, now - (run.completedts || run.createdts)))} ago`, faint: true });
    return meta;
}

function planPhase(run: Run, group: TaskGroup | null): PeekPhase {
    if (group != null) {
        return { label: "Plan", state: "passed", tone: "done" };
    }
    if (TERMINAL.has(run.status)) {
        return { label: "Plan", state: "none", tone: "pending" };
    }
    return { label: "Plan", state: "writing", tone: "running" };
}

const REVIEW_TONE: Record<string, PeekTone> = {
    reviewing: "running",
    passed: "done",
    accepted: "done",
    failed: "failed",
};

function reviewPhase(group: TaskGroup | null): PeekPhase {
    const review = group?.planreview;
    if (review == null) {
        return { label: "Plan review", state: group != null ? "not run" : "waiting", tone: "pending" };
    }
    return { label: "Plan review", state: review.state, tone: REVIEW_TONE[review.state] ?? "pending" };
}

const ATTENTION_STATES = new Set(["review-failed", "blocked-merge", "verify-failed"]);
const FAILED_STATES = new Set(["failed", "stalled"]);

function tasksPhase(group: TaskGroup | null): PeekPhase {
    if (group == null) {
        return { label: "Tasks", state: "waiting", tone: "pending" };
    }
    const { done, total } = runProgress(group);
    const state = `${done} of ${total} landed`;
    if (total > 0 && done === total) {
        return { label: "Tasks", state, tone: "done" };
    }
    if (group.tasks.some((t) => FAILED_STATES.has(t.state))) {
        return { label: "Tasks", state, tone: "failed" };
    }
    if (group.tasks.some((t) => ATTENTION_STATES.has(t.state))) {
        return { label: "Tasks", state, tone: "warning" };
    }
    return { label: "Tasks", state, tone: "running" };
}

const FINAL_TONE: Record<string, PeekTone> = {
    checking: "running",
    final: "running",
    verifying: "running",
    passed: "done",
    unverified: "warning",
    failed: "failed",
};

function finalPhase(group: TaskGroup | null): PeekPhase {
    const state = group?.final?.state ?? "";
    if (state === "") {
        return { label: "Final", state: "waiting", tone: "pending" };
    }
    return { label: "Final", state, tone: FINAL_TONE[state] ?? "pending" };
}

function unverifiedLine(group: TaskGroup | null): string | null {
    const final = group?.final;
    if (final?.state !== "unverified") {
        return null;
    }
    const why = (final.unverified ?? []).map((s) => s.trim()).filter(Boolean);
    return why.length > 0 ? why.join(" ") : "the final stage did not say what it could not verify.";
}

function taskMark(state: string): PeekTone {
    if (state === "done") {
        return "done";
    }
    if (FAILED_STATES.has(state)) {
        return "failed";
    }
    if (ATTENTION_STATES.has(state)) {
        return "warning";
    }
    if (state === "running" || state === "verifying" || state === "reviewing") {
        return "running";
    }
    return "pending";
}

function taskRows(group: TaskGroup, usage: UsageRow[] | undefined): PeekTaskRow[] {
    return group.tasks.map((t) => {
        const spent = summarizeUsage(usage, t.id);
        return {
            id: t.id,
            title: t.label || t.id,
            mark: taskMark(t.state),
            state: t.state,
            tokens: spent != null ? formatTokens(spent.total) : "",
        };
    });
}

function commitLine(run: Run, count: number | undefined): string | null {
    const base = run.basecommit?.slice(0, 7) ?? "";
    const end = run.endcommit?.slice(0, 7) ?? "";
    const parts = [base !== "" && end !== "" ? `${base}..${end}` : null, count ? plural(count, "commit") : null];
    const line = parts.filter((p): p is string => p != null).join(" · ");
    return line !== "" ? line : null;
}

export function buildRunPeek(input: PeekRunInput): PeekRunView {
    const { run, usage, commitCount } = input;
    // a quick run carries its parent's dagoref when it works a task, so only an orchestrator reads a graph
    const orchestrated = isOrchestrator(run);
    const group = orchestrated ? input.group : null;
    const title = runTitle(run, group ?? undefined);
    const goal = run.goal?.trim() ?? "";
    return {
        title,
        status: runStatusView(run.status, run.land),
        meta: runMeta(input),
        goal: goal !== "" && goal !== title ? goal : null,
        phases: orchestrated ? [planPhase(run, group), reviewPhase(group), tasksPhase(group), finalPhase(group)] : null,
        unverified: unverifiedLine(group),
        tasks: group != null ? taskRows(group, usage) : null,
        commits: orchestrated ? commitLine(run, commitCount) : null,
    };
}

export function runPeekFacts(run: Run | undefined): PeekFacts {
    return { gone: run == null };
}
