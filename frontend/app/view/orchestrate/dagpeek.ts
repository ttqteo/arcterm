// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// The DAG graph's peek as data: where it sits, what its bar offers, and what a node's card has no room for — the full title, the plan's
// description, and why the task is where it is. The worker's live activity line is not here; it needs the
// roster and renders beside these rows.

import { flip, hide, offset, shift, size, type Middleware, type Rect } from "@floating-ui/react";
import { firstLine, formatElapsed, verifyHeading, waitingText, type TaskBrief } from "./dagdigest";
import { dagActionRoute } from "./dagstore";

// the click-opened card beside the selected node, as Main.dc.html places it
export const PEEK_W_PX = 420;
export const PEEK_GAP_PX = 12;
export const PEEK_PAD_PX = 12;
export const PEEK_PLACEMENT = "right-start";
const PEEK_FALLBACK = "left-start";

// peekMiddleware keeps the card inside the graph pane: beside the node, on its left when the right has no room,
// shifted or capped so its bottom stays in the pane, and hidden while the node is panned out. The right padding
// is the controls column's strip, which the card must never cover.
export function peekMiddleware(boundary: Element | Rect, rightInsetPx: number): Middleware[] {
    const padding = { top: PEEK_PAD_PX, bottom: PEEK_PAD_PX, left: PEEK_PAD_PX, right: rightInsetPx };
    return [
        offset(PEEK_GAP_PX),
        flip({ boundary, padding, fallbackPlacements: [PEEK_FALLBACK] }),
        shift({ boundary, padding }),
        size({
            boundary,
            padding,
            apply({ availableHeight, elements }) {
                elements.floating.style.maxHeight = `${Math.max(0, availableHeight)}px`;
            },
        }),
        hide({ boundary }),
    ];
}

export type PeekAction = { action: string; label: string; primary: boolean; picker: boolean };

const ACTION_LABEL: Record<string, string> = {
    retry: "Retry",
    skip: "Skip",
    escalate: "Escalate…",
    approve: "Approve",
    sendback: "Send back",
    merge: "Merge",
    resolve: "Resolve",
};

// peekActions is the card's action bar: the engine's order with escalate last, the first one filled
export function peekActions(actions: string[]): PeekAction[] {
    const ordered = [...actions.filter((a) => a !== "escalate"), ...actions.filter((a) => a === "escalate")];
    return ordered.map((action, i) => ({
        action,
        label: ACTION_LABEL[action] ?? action.charAt(0).toUpperCase() + action.slice(1),
        primary: i === 0,
        picker: dagActionRoute(action) === "pick-route",
    }));
}

// nextSelection is a node click: it opens the card, moves it, or toggles it shut. The second click of a
// double-click never closes, so the double-click that opens the worker leaves the card open.
export function nextSelection(current: string | null, clicked: string, clickCount: number): string | null {
    if (clickCount > 1) return clicked;
    return current === clicked ? null : clicked;
}

export type PeekRow = { text: string; tone: "muted" | "warning" };
// what a task's Verify has to show: a heading, and the output tail the plan's command left behind
export type VerifySection = { heading: string; tail: string; tone: "muted" | "warning" };
export type TaskPeek = { title: string; description: string; rows: PeekRow[]; verify: VerifySection | null };

export function taskPeek(
    task: TaskNode,
    td: DagTaskDigest | undefined,
    briefs: Map<string, TaskBrief>,
    nowMs: number
): TaskPeek {
    const rows: PeekRow[] = [];
    if (td?.waitreason === "ask" || td?.waitreason === "lead-ask") {
        const who = td.waitreason === "ask" ? "you" : "the lead";
        rows.push({ text: `asked ${who}: ${td.asksummary || "a question"}`, tone: "warning" });
    }
    if (task.state === "pending" || task.state === "ready") {
        rows.push({ text: waitingText(td, briefs), tone: "muted" });
    }
    const activity = activityText(task, nowMs);
    if (activity) {
        rows.push({ text: activity, tone: "muted" });
    }
    if (task.lastfailurekind) {
        const attempt = (task.attempts ?? 0) > 1 ? ` · attempt ${task.attempts}` : "";
        rows.push({ text: `last failure: ${task.lastfailurekind}${attempt}`, tone: "warning" });
    }
    if (task.state === "reviewing") {
        const round = (task.reviewround ?? 0) + 1;
        rows.push({
            text: round > 1 ? `reviewer checking the fix · round ${round}` : "reviewer checking the commit",
            tone: "muted",
        });
    }
    const reviewNote = firstLine(task.reviewnote);
    if (reviewNote) {
        const failed = task.state === "review-failed" || task.reviewverdict === "fail";
        const verdict = task.reviewverdict ? ` ${task.reviewverdict}` : "";
        rows.push({ text: `review${verdict}: ${reviewNote}`, tone: failed ? "warning" : "muted" });
    }
    for (const err of [task.verifyerror, task.mergeerror, task.cleanuperror]) {
        const line = firstLine(err);
        if (line) {
            rows.push({ text: line, tone: "warning" });
        }
    }
    return {
        title: task.label || task.id,
        description: (task.description ?? "").trim(),
        rows,
        verify: verifySection(task, nowMs),
    };
}

// verifySection decides what the peek's Verify block shows. A failed Verify's reason is already a row, so
// its section is the output alone; a task that never verified, or passed before output was kept, has none.
export function verifySection(task: TaskNode, nowMs: number): VerifySection | null {
    const tail = (task.verifyoutput ?? "").trim();
    switch (task.state) {
        case "verifying":
            return { heading: verifyHeading(task.verifystartedts, nowMs), tail, tone: "muted" };
        case "verify-failed":
            return tail ? { heading: "Verify output", tail, tone: "warning" } : null;
        case "done":
            return tail || task.verifystartedts ? { heading: "Verify passed", tail, tone: "muted" } : null;
        default:
            return null;
    }
}

// the stamps are sampled transcript writes; a running task with neither has written nothing the watchdog
// can read (or its runtime has no readable transcript), which is not the same as idle
function activityText(task: TaskNode, nowMs: number): string | null {
    const parts: string[] = [];
    if (task.firstactivity) {
        parts.push(`first activity ${ago(nowMs, task.firstactivity)} ago`);
    }
    if (task.lastactivity) {
        parts.push(`last ${ago(nowMs, task.lastactivity)} ago`);
    }
    if (parts.length > 0) {
        return parts.join(" · ");
    }
    return task.state === "running" || task.state === "stalled" ? "no activity observed" : null;
}

function ago(nowMs: number, ts: number): string {
    return formatElapsed(Math.max(0, nowMs - ts));
}
