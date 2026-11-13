// Copyright 2026, Command Line Inc.
//
// The lifecycle rail's rows as data: bursts of one phase of one task, the steps worth showing in each, a
// one-line snippet, quiet gaps and the activity strip. Attention is ATTENTION_KINDS and titles are
// runtimeline's, so this rail and any other timeline cannot disagree about either.

import { detailOf, eventText, eventTitle, planReviewReviewers } from "../agents/runtimeline";
import { ATTENTION_KINDS, taskIdOf, type TimelineFilter } from "./timelinefilter";

// one phase of one task within BURST_MS reads as one row; a silence of QUIET_MS or more is worth a gap row
export const BURST_MS = 3 * 60_000;
export const QUIET_MS = 5 * 60_000;

export type Phase = "work" | "review" | "land";

export function phaseOf(kind: string): Phase {
    if (/review/.test(kind)) {
        return "review";
    }
    return /done|merge|cleanup|verify/.test(kind) ? "land" : "work";
}

// these sets only rank which event heads a burst; they are not tones
const LANDED_KINDS = new Set<string>([
    "task-done",
    "task-review-passed",
    "dag-plan-approved",
    "task-cleanup-completed",
    "task-merge-continued",
]);
const STARTED_KINDS = new Set<string>([
    "task-spawned",
    "task-review-started",
    "task-verify-started",
    "task-merge-started",
]);

export function priority(kind: string): number {
    if (kind === "task-first-activity") {
        return 0.5;
    }
    if (ATTENTION_KINDS.has(kind)) {
        return 4;
    }
    if (kind === "task-merged" || kind === "task-verify-passed") {
        return 3;
    }
    if (LANDED_KINDS.has(kind)) {
        return 2;
    }
    return STARTED_KINDS.has(kind) ? 1 : 0;
}

// a step made redundant by a later one in the same burst
export const SUPERSEDED: Record<string, string[]> = {
    "task-cleanup-pending": ["task-cleanup-completed"],
    "task-merge-started": ["task-merged"],
    "task-verify-started": ["task-verify-passed", "task-verify-failed"],
    "task-first-activity": ["task-spawned"],
    "task-review-started": ["task-review-passed", "task-review-failed"],
};

const STEP_LABEL = new Map<string, string>([
    ["task-spawned", "spawned"],
    ["task-first-activity", "first output"],
    ["task-stalled", "stalled"],
    ["task-retried", "retried"],
    ["task-skipped", "skipped"],
    ["task-escalated", "escalated"],
    ["final-rerun", "final rerun"],
    ["task-done", "done"],
    ["task-merge-started", "merge"],
    ["task-merge-blocked", "merge blocked"],
    ["task-merge-continued", "merge continued"],
    ["task-merged", "merged"],
    ["task-cleanup-pending", "cleanup"],
    ["task-cleanup-completed", "cleanup done"],
    ["task-verify-started", "verify"],
    ["task-verify-passed", "verify passed"],
    ["task-verify-failed", "verify failed"],
    ["task-review-started", "review"],
    ["task-review-passed", "review passed"],
    ["task-review-failed", "review failed"],
    ["task-amended", "amended"],
    ["task-lead-told", "told"],
    ["task-told", "told"],
    ["task-failed", "failed"],
]);

export function stepLabel(event: RunEvent): string {
    return STEP_LABEL.get(event.kind) ?? eventTitle(event);
}

export type EventGroup = {
    // the group's place in the sorted list: it moves when an earlier-stamped event arrives, so it is no React key
    id: string;
    // names the group's first event, so it holds whatever arrives later; a row's React key, and the rail's
    // open-row and entrance state
    key: string;
    taskId: string;
    items: RunEvent[];
    first: number;
    last: number;
    head: RunEvent;
    attention: boolean;
    steps: RunEvent[];
};

function groupKey(e: RunEvent): string {
    const taskId = taskIdOf(e);
    return taskId ? `${taskId}:${phaseOf(e.kind)}` : `dag:${e.kind}`;
}

function finishGroup(g: EventGroup): EventGroup {
    const kinds = new Set(g.items.map((e) => e.kind));
    return {
        ...g,
        // later wins a tie, so a burst reads as where it ended
        head: g.items.reduce((best, e) => (priority(e.kind) >= priority(best.kind) ? e : best), g.items[0]),
        attention: g.items.some((e) => ATTENTION_KINDS.has(e.kind)),
        steps: g.items.filter((e) => !(SUPERSEDED[e.kind] ?? []).some((k) => kinds.has(k))),
    };
}

// Events arrive newest-first (the history read and the live stream's unshift alike), so reversing before the stable
// sort keeps same-millisecond events in the order they happened. A group's key names its first event, not its place
// in the sorted list: an event stamped earlier than ones already shown (task-spawned is written after its batch)
// would otherwise re-key every later group, remounting rows and folding an open one.
export function groupEvents(events: RunEvent[]): EventGroup[] {
    const sorted = [...events].reverse().sort((a, b) => a.ts - b.ts);
    const groups: EventGroup[] = [];
    const open = new Map<string, EventGroup>();
    sorted.forEach((e, i) => {
        const key = groupKey(e);
        const g = open.get(key);
        if (g && e.ts - g.last <= BURST_MS) {
            g.items.push(e);
            g.last = e.ts;
            return;
        }
        const ng: EventGroup = {
            id: `${key}@${i}`,
            key: `${key}@${e.id}`,
            taskId: taskIdOf(e),
            items: [e],
            first: e.ts,
            last: e.ts,
            head: e,
            attention: false,
            steps: [],
        };
        groups.push(ng);
        open.set(key, ng);
    });
    return groups.map(finishGroup).sort((a, b) => b.last - a.last);
}

export function filterGroups(
    groups: EventGroup[],
    filter: TimelineFilter,
    selectedTaskId: string | null
): EventGroup[] {
    switch (filter) {
        case "task":
            return selectedTaskId ? groups.filter((g) => g.taskId === selectedTaskId) : [];
        case "attention":
            return groups.filter((g) => g.attention);
        default:
            return groups;
    }
}

export type RailRow = { kind: "gap"; minutes: number } | { kind: "group"; group: EventGroup };

// groups arrive newest first, so the quiet stretch is the newer group's start minus the older one's end
export function railRows(groups: EventGroup[]): RailRow[] {
    const rows: RailRow[] = [];
    groups.forEach((group, i) => {
        const prev = groups[i - 1];
        if (prev && prev.first - group.last >= QUIET_MS) {
            rows.push({ kind: "gap", minutes: Math.round((prev.first - group.last) / 60_000) });
        }
        rows.push({ kind: "group", group });
    });
    return rows;
}

// detail fields are telemetry: a value of the wrong type reads as absent rather than throwing mid-render
function str(v: unknown): string {
    return typeof v === "string" ? v : "";
}

function num(v: unknown): number {
    return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

function secs(ms: number): string {
    if (ms < 60_000) {
        return `${(ms / 1000).toFixed(1)}s`;
    }
    // round once, so 119.6s reads "2m 0s" and never "1m 60s"
    const total = Math.round(ms / 1000);
    return `${Math.floor(total / 60)}m ${total % 60}s`;
}

function shortPkg(s: string): string {
    return s.replace(/github\.com\/wavetermdev\/waveterm\//g, "");
}

export function snippetOf(e: RunEvent): string {
    const d = detailOf<Record<string, unknown>>(e) ?? {};
    switch (e.kind) {
        case "task-verify-failed": {
            const lines = str(d.detail).split("\n");
            const line = lines.find((l) => l.startsWith("FAIL\t")) ?? lines[0];
            return shortPkg(line.replace(/\t/g, " "));
        }
        case "task-verify-passed":
            return num(d.ms) ? `passed in ${secs(num(d.ms))}` : "";
        case "task-merged": {
            const commit = str(d.commit) ? `commit ${str(d.commit).slice(0, 8)}` : "";
            // the last merge runs no Verify of its own
            return [commit, d.verify === "final" ? "Verify left to the final stage" : ""].filter(Boolean).join(" · ");
        }
        case "task-review-passed":
        case "task-review-failed":
            return (str(d.note) || str(d.downstream)).split("\n")[0];
        case "task-amended":
        case "task-lead-told":
        case "task-told":
        case "task-stalled":
            return str(d.text);
        // an action by the human or the lead says who took it; an engine retry carries no actor
        case "task-retried":
            return d.by ? eventText(e) : str(d.text);
        case "task-skipped":
        case "task-escalated":
        case "final-rerun":
            return eventText(e);
        case "task-spawned":
            return num(d.worktreems)
                ? `worktree ${secs(num(d.worktreems))} · setup ${secs(num(d.setupms))} · spawn ${secs(num(d.spawnms))}`
                : "";
        case "task-first-activity":
            return num(d.sincespawnms) ? `first output ${secs(num(d.sincespawnms))} after spawn` : "";
        case "final-ended":
            return num(d.round) ? `round ${num(d.round)}` : "";
        default:
            return "";
    }
}

export function groupSnippet(g: EventGroup): string {
    return snippetOf(g.head) || g.items.map(snippetOf).find((s) => s !== "") || "";
}

function rawDetail(e: RunEvent): { text: string; pre: string } {
    const d = detailOf<Record<string, unknown>>(e) ?? {};
    if (e.kind === "task-verify-failed" && str(d.detail)) {
        return { text: "", pre: shortPkg(str(d.detail)) };
    }
    if (e.kind === "lead-wake-failed") {
        const lines = Array.isArray(d.lines) ? d.lines.map(str).filter(Boolean) : [];
        return { text: str(d.reason), pre: lines.join("\n") };
    }
    if (str(d.note) || str(d.downstream)) {
        return { text: [str(d.note), str(d.downstream)].filter(Boolean).join("\n\n"), pre: "" };
    }
    return { text: snippetOf(e), pre: "" };
}

// a text that only repeats the row's title is no detail at all
export function eventDetail(e: RunEvent): { text: string; pre: string } {
    const detail = rawDetail(e);
    return detail.text === eventTitle(e) ? { ...detail, text: "" } : detail;
}

// groupHasDetail: whether expanding the row shows anything beyond its title. A burst lists each step with its
// time, so it always does; a lone event needs a detail or a plan review's reviewers.
export function groupHasDetail(g: EventGroup): boolean {
    if (g.items.length > 1) {
        return true;
    }
    return g.items.some((e) => {
        const detail = eventDetail(e);
        const reviewed = e.kind === "plan-reviewed" && planReviewReviewers(e.detail).length > 0;
        return detail.text !== "" || detail.pre !== "" || reviewed;
    });
}

// eventCount: the rail counts events everywhere, as its header and a task popup's Lifecycle do, never bursts
export function eventCount(groups: EventGroup[]): number {
    return groups.reduce((n, g) => n + g.items.length, 0);
}

// axisEnd: an ended run has no "now" on its axis, so the axis stops at its last event
export function axisEnd(events: RunEvent[], ended: boolean, nowMs: number): number {
    if (!ended || events.length === 0) {
        return nowMs;
    }
    return Math.max(...events.map((e) => e.ts));
}

function localDay(ts: number): string {
    const d = new Date(ts);
    return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

// needsDate: times carry a date once the events span more than one local day or the last is not from today
export function needsDate(events: RunEvent[], nowMs: number): boolean {
    if (events.length === 0) {
        return false;
    }
    const ts = events.map((e) => e.ts);
    const first = localDay(Math.min(...ts));
    const last = localDay(Math.max(...ts));
    return first !== last || last !== localDay(nowMs);
}

const SECOND_MS = 1000;
const MINUTE_MS = 60 * SECOND_MS;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
// up to this a span reads in hours and minutes; past it whole days are the useful grain
const SPAN_HOURS_MAX_MS = 48 * HOUR_MS;

// spanText reads a duration as 45s, 12m, 1h17m or 29d
export function spanText(ms: number): string {
    const s = Math.max(0, Math.round(ms / SECOND_MS));
    if (s < 60) {
        return `${s}s`;
    }
    const min = Math.round(ms / MINUTE_MS);
    if (min < 60) {
        return `${min}m`;
    }
    if (ms < SPAN_HOURS_MAX_MS) {
        return `${Math.floor(min / 60)}h${min % 60}m`;
    }
    return `${Math.floor(ms / DAY_MS)}d`;
}

export type StripTick = { id: string; frac: number; attention: boolean; taskId: string };

// endMs is axisEnd's: now for a live run, the last event for an ended one
export function stripTicks(events: RunEvent[], endMs: number): StripTick[] {
    if (events.length === 0) {
        return [];
    }
    const start = Math.min(...events.map((e) => e.ts));
    const span = Math.max(1, endMs - start);
    return events.map((e) => ({
        id: e.id,
        frac: Math.min(1, Math.max(0, (e.ts - start) / span)),
        attention: ATTENTION_KINDS.has(e.kind),
        taskId: taskIdOf(e),
    }));
}

export type GlyphName = "play" | "eye" | "merge" | "shield" | "check" | "msg" | "bell" | "alert" | "skip";

export function glyphOf(kind: string): GlyphName {
    if (ATTENTION_KINDS.has(kind)) {
        return "alert";
    }
    if (kind === "task-skipped") {
        return "skip";
    }
    if (/review/.test(kind)) {
        return "eye";
    }
    if (/verify/.test(kind)) {
        return "shield";
    }
    if (/merge|cleanup/.test(kind)) {
        return "merge";
    }
    if (/amended|told/.test(kind)) {
        return "msg";
    }
    if (kind === "lead-woken") {
        return "bell";
    }
    if (kind === "task-done" || kind === "dag-plan-approved") {
        return "check";
    }
    return "play";
}

// 24x24 viewBox path data, stroked
export const GLYPH_PATHS: Record<GlyphName, string> = {
    play: "M7 4.5v15l12-7.5z",
    eye: "M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z",
    merge: "M21 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z M9 6a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z M6 21V9a9 9 0 0 0 9 9",
    shield: "M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z",
    check: "M20 6 9 17l-5-5",
    msg: "M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z",
    bell: "M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9 M10.3 21a1.94 1.94 0 0 0 3.4 0",
    alert: "M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z M12 9v4 M12 17h.01",
    skip: "M4.9 4.9l14.2 14.2 M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0Z",
};
