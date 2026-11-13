// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// The DAG graph's peek as data: where it sits, what its bar offers, and what a node's card has no room for — the full title, the plan's
// description, and why the task is where it is. The worker's live activity line is not here; it needs the
// roster and renders beside these rows.

import { flip, hide, offset, shift, size, type Middleware, type Rect } from "@floating-ui/react";
import { mergeGateLine, verifyFailLine } from "../agents/runlineage";
import { detailOf } from "../agents/runtimeline";
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
        shift({ boundary, padding, crossAxis: true }),
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
// a row as the card draws it: a clamped row is long prose the card cuts to a few lines, with a toggle to read it
// all; activity marks the worker's time row
export type CardRow = PeekRow & { clamp?: boolean; activity?: boolean };
// what a task's Verify has to show: a heading, and the output tail the plan's command left behind
export type VerifySection = { heading: string; tail: string; tone: "muted" | "warning" };
// rows is the compact reading (a review note's first line, no flags); cardRows is the same rows as the card
// draws them, with the review note whole
export type TaskPeek = {
    title: string;
    description: string;
    rows: PeekRow[];
    cardRows: CardRow[];
    verify: VerifySection | null;
};

type FailedDetail = { taskid?: string; detail?: string };

// taskFailureDetail is why a task failed, as its newest task-failed event says: a dispatch that failed before its
// worker started has no transcript, so this is the only place its reason lives
export function taskFailureDetail(events: RunEvent[], taskId: string): string | undefined {
    let newest: RunEvent | undefined;
    for (const event of events) {
        if (event.kind !== "task-failed" || detailOf<FailedDetail>(event)?.taskid !== taskId) continue;
        if (newest == null || event.ts > newest.ts) newest = event;
    }
    return newest ? detailOf<FailedDetail>(newest)?.detail || undefined : undefined;
}

// sessionPendingText is the worker box of a task with no run: one that failed never got a worker
export function sessionPendingText(task: TaskNode): string {
    if (task.state !== "failed") return "Not dispatched yet";
    return task.lastfailurekind ? `Never dispatched · failed at ${task.lastfailurekind}` : "Never dispatched · failed";
}

// what the peek reads beyond its task: the dag, for the merge gate's holder, and the run's events
export type PeekContext = { group?: TaskGroup; events?: RunEvent[] };

export function taskPeek(
    task: TaskNode,
    td: DagTaskDigest | undefined,
    briefs: Map<string, TaskBrief>,
    nowMs: number,
    { group, events = [] }: PeekContext = {}
): TaskPeek {
    const rows: PeekRow[] = [];
    const cardRows: CardRow[] = [];
    // a row, and how the card draws it when that is not as it reads
    const add = (row: PeekRow, card: Partial<CardRow> = {}) => {
        rows.push(row);
        cardRows.push({ ...row, ...card });
    };
    // the peek is handed its task's digest row alone, which is all the gate line reads of the digest
    const gate = td ? mergeGateLine({ dag: group, digest: { tasks: [td] } as DagStatusDigest }, task.id) : undefined;
    if (gate) {
        add({ text: gate, tone: "warning" });
    }
    if (td?.waitreason === "ask" || td?.waitreason === "lead-ask") {
        const who = td.waitreason === "ask" ? "you" : "the lead";
        add({ text: `asked ${who}: ${td.asksummary || "a question"}`, tone: "warning" });
    }
    if (task.state === "pending" || task.state === "ready") {
        add({ text: waitingText(td, briefs), tone: "muted" });
    }
    const activity = activityText(task, nowMs);
    if (activity) {
        add({ text: activity, tone: "muted" }, { activity: true });
    }
    if (task.lastfailurekind) {
        const attempt = (task.attempts ?? 0) > 1 ? ` · attempt ${task.attempts}` : "";
        const why = taskFailureDetail(events, task.id);
        const text = `last failure: ${task.lastfailurekind}${attempt}`;
        if (why) {
            add({ text: `${text} · ${why}`, tone: "warning" }, { clamp: true });
        } else {
            add({ text, tone: "warning" });
        }
    }
    if (task.state === "reviewing") {
        const round = (task.reviewround ?? 0) + 1;
        add({
            text: round > 1 ? `reviewer checking the fix · round ${round}` : "reviewer checking the commit",
            tone: "muted",
        });
    }
    const reviewNote = firstLine(task.reviewnote);
    if (reviewNote) {
        const failed = task.state === "review-failed" || task.reviewverdict === "fail";
        const verdict = task.reviewverdict ? ` ${task.reviewverdict}` : "";
        const tone = failed ? "warning" : "muted";
        // the card shows the whole trimmed note under the verdict, clamped to a few lines
        const whole = (task.reviewnote ?? "").trim();
        add({ text: `review${verdict}: ${reviewNote}`, tone }, { text: `review${verdict}: ${whole}`, clamp: true });
    }
    for (const line of [verifyFailLine(task, td), firstLine(task.mergeerror), firstLine(task.cleanuperror)]) {
        if (line) {
            add({ text: line, tone: "warning" });
        }
    }
    return {
        title: task.label || task.id,
        description: (task.description ?? "").trim(),
        rows,
        cardRows,
        verify: verifySection(task, nowMs),
    };
}

// colour and cursor escapes in output stored before the engine stripped them at capture; the CSI rule of
// utilfn.StripANSI
// eslint-disable-next-line no-control-regex
const CSI_RE = /\x1b\[[0-9;?]*[ -/]*[@-~]/g;

// verifySection decides what the peek's Verify block shows. A failed Verify's reason is already a row, so
// its section is the output alone; a task that never verified, or passed before output was kept, has none.
export function verifySection(task: TaskNode, nowMs: number): VerifySection | null {
    const tail = (task.verifyoutput ?? "").replace(CSI_RE, "").trim();
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

const ACTIVE_STATES = new Set(["running", "stalled", "verifying", "reviewing"]);

// the stamps are sampled transcript writes; a running task with neither has written nothing the watchdog
// can read (or its runtime has no readable transcript), which is not the same as idle. A task past its work
// says how long it worked: how long ago is a fact about the reader's clock.
function activityText(task: TaskNode, nowMs: number): string | null {
    if (!ACTIVE_STATES.has(task.state)) {
        return task.firstactivity && task.lastactivity
            ? `worked ${formatElapsed(Math.max(0, task.lastactivity - task.firstactivity))}`
            : null;
    }
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
