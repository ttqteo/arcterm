// Copyright 2026, Command Line Inc.
//
// Pure: group a run's lifecycle events into the hybrid timeline — cross-cutting events under a RUN
// group, phase-scoped events under their phase group — plus a 3-event collapsed preview (newest
// first). Grouping does not depend on live state; the store in runeventstore.ts feeds it.

export const RUN_GROUP_ID = "run";
export const PREVIEW_COUNT = 3;

export interface RunTimelineGroup {
    id: string; // RUN_GROUP_ID or "phase-<index+1>"
    title: string; // "RUN" or "PHASE N · <kind>"
    events: RunEvent[];
}

// kinds that render under the RUN group — everything not phase-scoped. A kind missing here and
// carrying no phaseidx renders only in the collapsed preview, so every dag lifecycle kind belongs.
const RUN_GROUP_KINDS = new Set([
    "run-created",
    "triage",
    "child-created",
    "child-done",
    "child-cancelled",
    "run-cancelled",
    "evidence-sealed",
    "task-spawned",
    "task-first-activity",
    "task-stalled",
    "task-suspect",
    "task-retried",
    "dag-blocked",
    "dag-done",
    "task-done",
    "task-failed",
    "dag-cancelled",
    "dag-gate-open",
    "child-ask",
    "child-answered",
    "child-ask-cleared",
    "task-merge-started",
    "task-merge-blocked",
    "task-merge-failed",
    "task-merge-continued",
    "task-merged",
    "task-cleanup-pending",
    "task-cleanup-completed",
    "task-cleanup-failed",
    "task-forwarded",
    "lead-woken",
    "lead-launched",
    "lead-wake-failed",
    "lead-revived",
    "engine-stuck",
    "lead-exited",
    "worker-exited",
    "interrupted",
    "worker-resumed",
    "task-told",
    "task-verify-started",
    "task-verify-passed",
    "task-verify-failed",
    "dag-plan-gated",
    "dag-plan-approved",
    "dag-plan-sent-back",
    "merge-held",
    "task-review-started",
    "task-review-passed",
    "task-review-failed",
    "review-overruled",
    "task-amended",
    "task-lead-told",
]);

export function buildRunTimeline(run: Run, events: RunEvent[]): { groups: RunTimelineGroup[]; preview: RunEvent[] } {
    if (events.length === 0) {
        return { groups: [], preview: [] };
    }
    const sorted = [...events].sort((a, b) => b.ts - a.ts);
    const groups: RunTimelineGroup[] = [];
    const runEvents = sorted.filter((e) => RUN_GROUP_KINDS.has(e.kind));
    if (runEvents.length > 0) {
        groups.push({ id: RUN_GROUP_ID, title: "RUN", events: runEvents });
    }
    (run.phases ?? []).forEach((_, i) => {
        const phaseEvents = sorted.filter((e) => e.phaseidx === i);
        if (phaseEvents.length > 0) {
            groups.push({
                id: `phase-${i + 1}`,
                title: `PHASE ${i + 1} · ${(run.phases?.[i].kind ?? "").toUpperCase()}`,
                events: phaseEvents,
            });
        }
    });
    return { groups, preview: sorted.slice(0, PREVIEW_COUNT) };
}
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

// KIND_TONE stays inside the EXISTING status/phase tone utilities (the same token classes
// TONE_CLASS / PHASE_TONE_CLASS in runbody.tsx use). No new colors: success = progress, warning =
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

export function eventTitle(event: RunEvent): string {
    if (event.kind === "stage-session-started") {
        return STAGE_ROLE_TITLE[detailOf<{ role?: string }>(event)?.role ?? ""] ?? eventKindTitle(event.kind);
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

export type PlanReviewPick = { taskid: string; model: string; reason: string };

// planReviewPicks reads the model picks a plan review's verdict applied, as its timeline row lists them; a malformed
// entry is dropped rather than shown half-read.
export function planReviewPicks(detail: unknown): PlanReviewPick[] {
    const d = detailOf<{ picks?: unknown }>({ detail } as RunEvent);
    if (!Array.isArray(d?.picks)) {
        return [];
    }
    const out: PlanReviewPick[] = [];
    for (const p of d.picks as { taskid?: unknown; model?: unknown; reason?: unknown }[]) {
        if (typeof p?.taskid === "string" && typeof p.model === "string") {
            out.push({ taskid: p.taskid, model: p.model, reason: typeof p.reason === "string" ? p.reason : "" });
        }
    }
    return out;
}

// artifactsOf extracts the reported artifact list (completed/held detail rows), for the row's
// inline "open first artifact" link.
export function artifactsOf(event: RunEvent): string[] {
    const detail = detailOf<{ artifacts?: string[] }>(event);
    return Array.isArray(detail?.artifacts) ? detail!.artifacts! : [];
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

// --- click dispatch (pure decision, applied by the view) ---

export type TimelineClick =
    | { kind: "select-child"; childRunId: string }
    | { kind: "open-dag"; taskId: string }
    | { kind: "focus-phase"; phaseIdx: number }
    | { kind: "open-diff" }
    | { kind: "none" };

export function clickTargetFor(event: RunEvent): TimelineClick {
    const detail = detailOf<{ childrunid?: string; taskid?: string }>(event);
    switch (event.kind) {
        case "child-done":
        case "child-cancelled":
            return detail?.childrunid ? { kind: "select-child", childRunId: detail.childrunid } : { kind: "none" };
        case "task-stalled":
        case "task-suspect":
        case "dag-blocked":
            return { kind: "open-dag", taskId: detail?.taskid ?? "" };
        // phase-held, gate-approved and gate-sent-back are rows only a run stored before slice 5c can
        // carry. They scroll to the phase they name like any other phase row; the verbs that resolved
        // them are gone.
        case "phase-started":
        case "phase-complete":
        case "phase-held":
        case "gate-approved":
        case "gate-sent-back":
            return event.phaseidx != null ? { kind: "focus-phase", phaseIdx: event.phaseidx } : { kind: "none" };
        case "evidence-sealed":
            return { kind: "open-diff" };
        default:
            return { kind: "none" };
    }
}

// joinWorkspacePath joins the run's project path with a workspace-relative artifact path the worker
// reported (the completion surface's open verb does the same join — the rule the routes through
// os.path at the backend too).
export function joinWorkspacePath(projectPath: string, rel: string): string {
    const sep = projectPath.includes("\\") ? "\\" : "/";
    return rel.match(/^([/\\]|[a-zA-Z]:)/) ? rel : `${projectPath}${sep}${rel}`;
}
