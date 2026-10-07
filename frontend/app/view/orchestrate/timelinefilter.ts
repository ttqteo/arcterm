// Copyright 2026, Command Line Inc.
//
// Pure: what the lifecycle timeline rail shows and where a row goes when clicked. Kept out of the
// rail component so the filter set and the routing table are testable without a DOM, and so the run
// body's timeline and the DAG rail can never disagree about which kinds count as attention.

import { detailOf } from "../agents/runtimeline";

export type TimelineFilter = "all" | "task" | "attention";

export type TimelineLayout = "rail" | "drawer";

// TIMELINE_RAIL_MIN_PX: the DAG modal fills the window and the rail takes 300px of it. Below this
// the graph loses more room than a permanently-visible history is worth, so history collapses into a
// drawer and the live work keeps the space (spec 6.4).
export const TIMELINE_RAIL_MIN_PX = 1100;

export function timelineLayout(windowWidth: number): TimelineLayout {
    // a width of 0 is the unmeasured first frame, not the narrowest possible window
    return windowWidth > 0 && windowWidth < TIMELINE_RAIL_MIN_PX ? "drawer" : "rail";
}

// ATTENTION_KINDS is the exception set: a row here means the DAG is waiting on a human or has lost
// ground. Resolutions (child-answered, child-ask-cleared, task-merged) are deliberately absent —
// they are how attention ENDS, and listing them would keep a settled task in the filter forever.
export const ATTENTION_KINDS = new Set<string>([
    "task-review-failed",
    "child-ask",
    "dag-gate-open",
    "dag-plan-gated",
    "phase-held",
    "task-failed",
    "task-stalled",
    "dag-blocked",
    "task-merge-blocked",
    "task-merge-failed",
    "task-verify-failed",
    "task-cleanup-failed",
    "task-forwarded",
    "lead-wake-failed",
    "engine-stuck",
    "lead-exited",
    "interrupted",
    "merge-held",
]);

// taskIdOf reads the task a row belongs to; "" for a dag-level row (dag-done, evidence-sealed).
export function taskIdOf(event: RunEvent): string {
    return detailOf<{ taskid?: string }>(event)?.taskid ?? "";
}

// filterEvents narrows the rail. "task" with no selection yields nothing rather than falling back to
// everything: a filter that silently shows the opposite of what its label claims is worse than empty.
export function filterEvents(events: RunEvent[], filter: TimelineFilter, selectedTaskId?: string): RunEvent[] {
    switch (filter) {
        case "task":
            return selectedTaskId ? events.filter((e) => taskIdOf(e) === selectedTaskId) : [];
        case "attention":
            return events.filter((e) => ATTENTION_KINDS.has(e.kind));
        default:
            return events;
    }
}

export type TimelineTarget =
    | { kind: "worker"; taskId: string }
    | { kind: "dag-task"; taskId: string }
    | { kind: "gate"; taskId: string }
    | { kind: "merge"; taskId: string }
    | { kind: "child-run"; runId: string }
    | { kind: "evidence" }
    | { kind: "none" };

// TASK_TARGET_KINDS maps every task-scoped kind to the surface that best answers "what do I do about
// this row" — the worker for anything about the child's work, the gate for a halt awaiting release,
// the merge state for integration, the task itself for cleanup debt.
const TASK_TARGET_KINDS: Record<string, TimelineTarget["kind"]> = {
    "task-review-started": "worker",
    "task-lead-told": "worker",
    "task-review-passed": "dag-task",
    "task-review-failed": "dag-task",
    "review-overruled": "dag-task",
    "task-amended": "dag-task",
    "task-spawned": "worker",
    "task-first-activity": "worker",
    "task-done": "worker",
    "task-failed": "worker",
    "task-stalled": "worker",
    "task-suspect": "worker",
    "task-retried": "worker",
    "child-ask": "worker",
    "child-answered": "worker",
    "child-ask-cleared": "worker",
    "task-told": "worker",
    "dag-blocked": "gate",
    "dag-gate-open": "gate",
    "task-merge-started": "merge",
    "task-merge-blocked": "merge",
    "task-merge-continued": "merge",
    "task-merged": "merge",
    "task-verify-started": "merge",
    "task-verify-passed": "merge",
    "task-verify-failed": "merge",
    "task-cleanup-pending": "dag-task",
    "task-cleanup-completed": "dag-task",
    "task-cleanup-failed": "dag-task",
    "task-forwarded": "dag-task",
};

// eventClickTarget decides where a row navigates. A row whose detail lacks the id its target needs
// resolves to "none" — a click that lands nowhere is better than one that lands on the wrong task.
export function eventClickTarget(event: RunEvent): TimelineTarget {
    if (event.kind === "evidence-sealed") {
        return { kind: "evidence" };
    }
    if (event.kind === "child-done" || event.kind === "child-cancelled" || event.kind === "child-created") {
        const runId = detailOf<{ childrunid?: string }>(event)?.childrunid ?? "";
        return runId ? { kind: "child-run", runId } : { kind: "none" };
    }
    const target = TASK_TARGET_KINDS[event.kind];
    const taskId = taskIdOf(event);
    if (target == null || taskId === "") {
        return { kind: "none" };
    }
    return { kind: target, taskId } as TimelineTarget;
}
