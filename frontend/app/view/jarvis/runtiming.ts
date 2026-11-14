// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The run sheet's Timing section: where an orchestrator run's wall clock went, as one bar per activity on a
// shared since-launch axis. Go derives the intervals once (digest.timing); this only lays them out and words
// them. Pure.

import { isTerminal } from "../agents/runmodel";
import { formatElapsed } from "../orchestrate/dagdigest";

function joinAnd(items: string[]): string {
    return items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

export type TimingKey = "planning" | "execution" | "review" | "merge" | "final" | "landing";
// left/width in percent of the axis
export type TimingRow = { key: TimingKey; label: string; left: number; width: number; duration: string; open: boolean };
export type RunTimingView = {
    header: string;
    axis: [string, string, string];
    rows: TimingRow[];
    // live only, shown even when collapsed; [] on a terminal run
    summary: string[];
    notes: string[];
    defaultOpen: boolean;
};

const LABELS: Record<TimingKey, string> = {
    planning: "Planning",
    execution: "Execution",
    review: "Task review",
    merge: "Merge & Verify",
    final: "Final verification",
    landing: "Landing / wrap-up",
};

// how an activity is named mid-sentence; "task review has overlapped execution" repeats what the row says
const NOUNS: Record<TimingKey, string> = {
    planning: "planning",
    execution: "execution",
    review: "review",
    merge: "merge & Verify",
    final: "final verification",
    landing: "landing / wrap-up",
};

// activities a live run may still be waiting to start; landing only follows the end, so it is never "ahead"
const AHEAD: TimingKey[] = ["execution", "review", "merge", "final"];
// the stages a task passes after it executes, in row order
const STAGES: TimingKey[] = ["review", "merge", "final"];

// a zero-length bar still has to be seen
const MIN_ROW_WIDTH = 1;

const OVERLAP_NOTE = "Elapsed since launch. Activities overlap; do not add these rows.";
const PARTIAL_NOTE = "Some early boundaries were pruned; rows may start late.";

const EXECUTING = new Set(["running", "stalled"]);
const WAITING = new Set(["pending", "ready"]);

type Span = { key: TimingKey; start: number; end: number; open: boolean };

function capitalize(s: string): string {
    return s.charAt(0).toUpperCase() + s.slice(1);
}

function nounList(keys: TimingKey[]): string {
    return joinAnd(keys.map((k) => NOUNS[k]));
}

// taskNumber is a plan id's number ("t-3" -> "3"), or null for an id that is not a plan's.
function taskNumber(t: TaskNode): string | null {
    return /^t-(\d+)$/.exec(t.id)?.[1] ?? null;
}

function executingLine(executing: TaskNode[], anyWaiting: boolean): string {
    const numbers = executing.map(taskNumber);
    if (executing.length === 1) {
        const name = numbers[0] != null ? `Task ${numbers[0]}` : executing[0].label || executing[0].id;
        return anyWaiting ? `${name} is executing.` : `${name} is the last task still executing.`;
    }
    const names = numbers.every((n) => n != null)
        ? `Tasks ${joinAnd(numbers)}`
        : joinAnd(executing.map((t, i) => (numbers[i] != null ? `Task ${numbers[i]}` : t.label || t.id)));
    return `${names} are executing.`;
}

function aheadLine(subject: string, count: number): string {
    return `${subject} ${count === 1 ? "is" : "are"} still ahead.`;
}

// summaryLines says which tasks are still executing and the stages they have yet to pass: review and merge
// (the engine reviews and merges every task that commits), then final verification unless it is already
// under way. With no task executing it names the stages that have not started.
function summaryLines(tasks: TaskNode[], started: Set<TimingKey>): string[] {
    const executing = tasks.filter((t) => EXECUTING.has(t.state));
    if (executing.length === 0) {
        const ahead = STAGES.filter((k) => !started.has(k));
        return ahead.length > 0 ? [aheadLine(capitalize(nounList(ahead)), ahead.length)] : [];
    }
    const ahead = STAGES.filter((k) => k !== "final" || !started.has("final"));
    const owner = executing.length === 1 ? "Its" : "Their";
    const anyWaiting = tasks.some((t) => WAITING.has(t.state));
    return [executingLine(executing, anyWaiting), aheadLine(`${owner} ${nounList(ahead)}`, ahead.length)];
}

// liveNote names the open activities that run alongside the earliest open one, and those not yet started.
function liveNote(spans: Span[], started: Set<TimingKey>): string | null {
    const sentences: string[] = [];
    const open = spans.filter((s) => s.open).map((s) => s.key);
    if (open.length > 1) {
        const overlapping = open.slice(1);
        const verb = overlapping.length === 1 ? "has" : "have";
        sentences.push(`${capitalize(nounList(overlapping))} ${verb} overlapped ${NOUNS[open[0]]}.`);
    }
    const notStarted = AHEAD.filter((k) => !started.has(k));
    if (notStarted.length > 0) {
        const verb = notStarted.length === 1 ? "has" : "have";
        sentences.push(`${capitalize(nounList(notStarted))} ${verb} not started.`);
    }
    return sentences.length > 0 ? sentences.join(" ") : null;
}

function longestNote(spans: Span[]): string | null {
    if (spans.length === 0) {
        return null;
    }
    const longest = spans.reduce((a, b) => (b.end - b.start > a.end - a.start ? b : a));
    return `Longest activity: ${NOUNS[longest.key]}, ${formatElapsed(longest.end - longest.start)}. This is not summed worker time.`;
}

function header(status: string, terminal: boolean, elapsed: string): string {
    if (!terminal) {
        return `${elapsed} elapsed`;
    }
    return status === "done" ? `Finished in ${elapsed}` : `Ended after ${elapsed}`;
}

export function runTiming(input: {
    run: Run;
    digest: DagStatusDigest | undefined;
    tasks: TaskNode[] | undefined;
    nowMs: number;
}): RunTimingView | null {
    const { run, digest, tasks, nowMs } = input;
    const timing = digest?.timing;
    if (timing == null) {
        return null;
    }
    const terminal = isTerminal(run.status);
    const start = timing.startts;
    // a finished run's axis is its own end, never the clock
    const end = terminal ? timing.endts || run.completedts || start : Math.max(nowMs, start);
    const span = Math.max(end - start, 1);
    const pct = (ms: number) => (ms / span) * 100;

    const spans: Span[] = (timing.activities ?? [])
        .filter((a) => a.key in LABELS)
        .map((a) => ({
            key: a.key as TimingKey,
            start: a.startts,
            end: a.endts || end,
            open: !terminal && !a.endts,
        }));
    const rows: TimingRow[] = spans.map((s) => {
        const width = Math.max(pct(s.end - s.start), MIN_ROW_WIDTH);
        return {
            key: s.key,
            label: LABELS[s.key],
            left: Math.min(pct(s.start - start), 100 - width),
            width,
            duration: formatElapsed(Math.max(0, s.end - s.start)),
            open: s.open,
        };
    });
    const started = new Set(spans.map((s) => s.key));

    const notes = [OVERLAP_NOTE];
    const detail = terminal ? longestNote(spans) : liveNote(spans, started);
    if (detail != null) {
        notes.push(detail);
    }
    if (timing.partial) {
        notes.push(PARTIAL_NOTE);
    }

    return {
        header: header(run.status, terminal, formatElapsed(end - start)),
        axis: ["0m", formatElapsed(span / 2), formatElapsed(span)],
        rows,
        summary: terminal ? [] : summaryLines(tasks ?? [], started),
        notes,
        defaultOpen: terminal,
    };
}
