// Copyright 2026, Command Line Inc.
//
// Pure: how a run's lifecycle events read as rows — title, text, detail payload, time label and tone.

// --- row rendering helpers (pure; the view maps them to DOM) ---

// KIND_TITLE renders each event kind as a human sentence; a kind outside the map (older rows or a
// future kind) falls back to the raw kind string rather than blanking the row.
const KIND_TITLE: Record<string, string> = {
    "run-created": "Run created",
    "phase-started": "Phase started",
    "phase-complete": "Phase complete",
    "phase-held": "Held for review",
    "gate-approved": "Gate approved",
    "gate-sent-back": "Gate sent back",
    triage: "Triage",
    "child-created": "Child run created",
    "child-done": "Child done",
    "child-cancelled": "Child cancelled",
    "run-cancelled": "Run cancelled",
    "evidence-sealed": "Evidence sealed",
    "task-spawned": "Task spawned",
    "task-first-activity": "Task produced its first output",
    "task-stalled": "Task stalled",
    "task-suspect": "Task may be stuck",
    "task-retried": "Task retried",
    "dag-blocked": "DAG blocked",
    "dag-done": "DAG complete",
    "task-done": "Task done",
    "task-failed": "Task failed",
    "dag-cancelled": "DAG cancelled",
    "dag-gate-open": "Gate awaiting release",
    "child-ask": "Child asked a question",
    "child-answered": "Child answered",
    "child-ask-cleared": "Question cleared",
    "task-merge-started": "Merge started",
    "task-merge-blocked": "Merge blocked",
    "task-merge-failed": "Merge refused",
    "task-merge-continued": "Merge continued",
    "task-merged": "Task merged",
    "task-cleanup-pending": "Cleanup pending",
    "task-cleanup-completed": "Cleanup complete",
    "task-cleanup-failed": "Cleanup failed",
    "task-forwarded": "Handed to you",
    "lead-woken": "Lead woken",
    "lead-launched": "Lead started",
    "lead-wake-failed": "Lead wake failed",
    "lead-revived": "Lead taking wakes again",
    "engine-stuck": "Engine stuck",
    "lead-exited": "Lead exited",
    "worker-exited": "Worker exited",
    interrupted: "Interrupted by restart",
    "worker-resumed": "Worker resumed",
    "task-told": "You told a worker",
    "task-verify-started": "Verify started",
    "task-verify-passed": "Verify passed",
    "task-verify-failed": "Verify failed",
    "dag-plan-gated": "Plan awaiting your approval",
    "dag-plan-approved": "Plan approved",
    "dag-plan-sent-back": "Plan sent back",
    "merge-held": "Merges held",
    "task-review-started": "Review started",
    "task-review-passed": "Review passed",
    "task-review-failed": "Review failed",
    "review-overruled": "Lead overruled the review",
    "task-amended": "Lead amended a task",
    "task-lead-told": "Lead told a worker",
    "land-held": "Land held",
    landed: "Run landed",
    "stage-session-started": "Judging session started",
    "plan-reviewed": "Plan reviewed",
};

// KIND_TONE stays inside the existing status tone utilities. No new colors: success = progress, warning =
// attention/stall, asking = review, muted = terminal/informational.
const KIND_TONE: Record<string, string> = {
    "run-created": "text-success",
    "phase-started": "text-success",
    "phase-complete": "text-success",
    "child-created": "text-success",
    "child-done": "text-success",
    "evidence-sealed": "text-success",
    "gate-approved": "text-success",
    "dag-plan-approved": "text-success",
    "task-spawned": "text-success",
    "dag-done": "text-success",
    "task-done": "text-success",
    "task-merged": "text-success",
    "task-cleanup-completed": "text-success",
    "child-answered": "text-success",
    "task-merge-continued": "text-success",
    "task-verify-passed": "text-success",
    "phase-held": "text-asking",
    "child-ask": "text-asking",
    "dag-gate-open": "text-asking",
    "dag-plan-gated": "text-asking",
    "task-forwarded": "text-asking",
    "gate-sent-back": "text-warning",
    "dag-plan-sent-back": "text-warning",
    triage: "text-warning",
    "task-stalled": "text-warning",
    "task-suspect": "text-warning",
    "dag-blocked": "text-warning",
    "task-retried": "text-warning",
    "task-failed": "text-warning",
    "task-merge-blocked": "text-warning",
    "task-merge-failed": "text-warning",
    "task-cleanup-failed": "text-warning",
    "lead-wake-failed": "text-warning",
    "engine-stuck": "text-warning",
    "lead-exited": "text-warning",
    "worker-exited": "text-warning",
    interrupted: "text-warning",
    "task-verify-failed": "text-warning",
    "merge-held": "text-warning",
    "task-review-passed": "text-success",
    "task-review-failed": "text-warning",
    "task-review-started": "text-muted",
    "review-overruled": "text-muted",
    "task-amended": "text-muted",
    "task-lead-told": "text-muted",
    "child-cancelled": "text-muted",
    "run-cancelled": "text-muted",
    "dag-cancelled": "text-muted",
    "child-ask-cleared": "text-muted",
    "task-merge-started": "text-muted",
    "task-first-activity": "text-muted",
    "task-cleanup-pending": "text-muted",
    "lead-woken": "text-muted",
    "lead-launched": "text-muted",
    "lead-revived": "text-muted",
    "task-told": "text-muted",
    "task-verify-started": "text-muted",
    "land-held": "text-warning",
    landed: "text-success",
    "stage-session-started": "text-muted",
    "plan-reviewed": "text-muted",
};

export function eventKindTitle(kind: string): string {
    return KIND_TITLE[kind] ?? kind;
}

// a stage session is the plan reviewer or the final verifier, and only its detail says which
const STAGE_ROLE_TITLE: Record<string, string> = {
    "plan-reviewer": "Plan reviewer started",
    verifier: "Final verifier started",
};

// PLAN_REVIEW_LENS_TITLE names each plan reviewer by its lens: the one map the graph, timeline and tree read.
export const PLAN_REVIEW_LENS_TITLE: Record<string, string> = {
    full: "Full review",
    spec: "Spec coverage",
    order: "Task order and files",
    tests: "Tests and commands",
    final: "Final coverage",
    followup: "Round-2 follow-up",
};

export function planReviewLensTitle(lens: string): string {
    return PLAN_REVIEW_LENS_TITLE[lens] ?? lens;
}

export function eventTitle(event: RunEvent): string {
    if (event.kind === "stage-session-started") {
        const d = detailOf<{ role?: string; lens?: string }>(event);
        const title = STAGE_ROLE_TITLE[d?.role ?? ""] ?? eventKindTitle(event.kind);
        return d?.lens ? `${title} · ${planReviewLensTitle(d.lens)}` : title;
    }
    return eventKindTitle(event.kind);
}

// eventText is one row as every timeline says it: its title, naming the task it is about and what was asked or told.
export function eventText(event: RunEvent): string {
    const d = detailOf<{
        taskid?: string;
        by?: string;
        note?: string;
        question?: string;
        text?: string;
        held?: number;
        reason?: string;
    }>(event);
    const task = d?.taskid ?? "";
    switch (event.kind) {
        case "task-forwarded":
            return d?.by === "human"
                ? `you took ${task} over from the lead`
                : [`${task} handed to you`, d?.note].filter(Boolean).join(" · ");
        case "child-ask":
            return [`${task} asked`, d?.question].filter(Boolean).join(" · ");
        case "child-answered":
            return `${task} answered`;
        case "task-told":
            return [`you told ${task}`, d?.text?.replace(/\s+/g, " ")].filter(Boolean).join(" · ");
        case "task-lead-told":
            return [`lead told ${task}`, d?.text?.replace(/\s+/g, " ")].filter(Boolean).join(" · ");
        case "task-amended":
            return [`lead amended ${task}`, d?.text?.replace(/\s+/g, " ")].filter(Boolean).join(" · ");
        case "task-review-passed":
        case "task-review-failed":
            return [`${eventTitle(event)} · ${task}`, d?.note?.replace(/\s+/g, " ")].filter(Boolean).join(" · ");
        case "merge-held":
            return [`${d?.held ?? 0} merge(s) held`, d?.reason].filter(Boolean).join(" · ");
        default:
            return task ? `${eventTitle(event)} · ${task}` : eventTitle(event);
    }
}

// detailOf parses the row's JSON detail payload; undefined on malformed data (a row render must
// never throw over a telemetry blob).
export function detailOf<T>(event: RunEvent): T | undefined {
    if (event.detail == null) {
        return undefined;
    }
    if (typeof event.detail === "object") {
        return event.detail as unknown as T;
    }
    try {
        return JSON.parse(event.detail as string) as T;
    } catch {
        return undefined;
    }
}

export type PlanReviewReviewerRow = { lens: string; state: string; text: string };

// planReviewReviewers reads each reviewer's verdict from a plan review's timeline row; a malformed entry is dropped
// rather than shown half-read.
export function planReviewReviewers(detail: unknown): PlanReviewReviewerRow[] {
    const d = detailOf<{ reviewers?: unknown }>({ detail } as RunEvent);
    if (!Array.isArray(d?.reviewers)) {
        return [];
    }
    const out: PlanReviewReviewerRow[] = [];
    for (const r of d.reviewers as { lens?: unknown; state?: unknown; text?: unknown }[]) {
        if (typeof r?.lens === "string" && typeof r.state === "string") {
            out.push({ lens: r.lens, state: r.state, text: typeof r.text === "string" ? r.text : "" });
        }
    }
    return out;
}

export function tsLabel(ts: number): string {
    const d = new Date(ts);
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    return `${hh}:${mm}`;
}

export function toneFor(kind: string): string {
    return KIND_TONE[kind] ?? "text-muted";
}
