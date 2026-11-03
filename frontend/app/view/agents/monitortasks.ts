// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Pure helpers over a BackgroundTask (transcriptprojection.ts): its kind (a Monitor watches, a background shell
// runs), the words a tree row and a peek show for it, and the tail of its output. No React and no Wave runtime
// imports, so the shapes are unit-testable on their own. A task that is not running reads as how it ended, never
// as a watch or a time left; a Monitor that has reported nothing reads as quiet, not as missing.

import { formatAgeShort, formatAgo } from "./agentsviewmodel";
import { monitorExpiresAt, type BackgroundTask, type BackgroundTaskStatus } from "./transcriptprojection";

export { monitorExpiresAt };

export type BackgroundTaskKind = "monitor" | "shell";

// a running Monitor is "watching"; every other state is the task's own status
export type BackgroundTaskState = "watching" | BackgroundTaskStatus;

// the peek's output read keeps this much of a task's output, which is also what its footer says it shows
export const OUTPUT_MAX_CHARS = 64 * 1024;

export function backgroundTaskKind(t: Pick<BackgroundTask, "monitor">): BackgroundTaskKind {
    return t.monitor ? "monitor" : "shell";
}

export function backgroundTaskState(t: Pick<BackgroundTask, "monitor" | "status">): BackgroundTaskState {
    return t.status === "running" && t.monitor ? "watching" : t.status;
}

export function backgroundTasksNoun(tasks: Pick<BackgroundTask, "monitor">[]): "shell tasks" | "monitors" | "tasks" {
    const monitors = tasks.filter((t) => t.monitor).length;
    if (monitors === 0) {
        return "shell tasks";
    }
    return monitors === tasks.length ? "monitors" : "tasks";
}

/** Pure: "3 tasks", "2 monitors", "1 shell task" — a list named by the kinds in it. */
export function backgroundTasksLabel(tasks: Pick<BackgroundTask, "monitor">[]): string {
    const n = tasks.length;
    const noun = backgroundTasksNoun(tasks);
    if (n !== 1) {
        return `${n} ${noun}`;
    }
    return noun === "monitors" ? "1 monitor" : "1 shell task";
}

/** Local wall-clock HH:MM:SS, 24-hour whatever the locale. */
export function clockTime(ms: number): string {
    return new Date(ms).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hourCycle: "h23",
    });
}

/** Pure: "N events · 3m ago", or null when the Monitor has reported nothing. */
export function monitorEventsSummary(t: Pick<BackgroundTask, "events">, now: number): string | null {
    const events = t.events ?? [];
    if (events.length === 0) {
        return null;
    }
    const lastTs = events[events.length - 1].ts;
    const count = events.length === 1 ? "1 event" : `${events.length} events`;
    return `${count} · ${formatAgo(lastTs != null ? now - lastTs : undefined)}`;
}

/** Pure: a Monitor row's second line: how it is going while it runs, how it ended after. */
export function monitorSubline(t: BackgroundTask, now: number): string {
    if (t.status !== "running") {
        return `${t.status} · ${monitorEventsSummary(t, now) ?? "no events"}`;
    }
    const body =
        monitorEventsSummary(t, now) ??
        `no events yet · ${formatAgeShort(t.startMs != null ? now - t.startMs : undefined)}`;
    return t.persistent ? `persistent · ${body}` : body;
}

/** Pure: a task row's second line, either kind: "running · 5m" for a shell, the Monitor's own line for a Monitor, and
 *  "completed · 4m" (how long it ran, when known) for a shell that ended. */
export function backgroundTaskSubline(t: BackgroundTask, now: number): string {
    if (t.monitor) {
        return monitorSubline(t, now);
    }
    if (t.status === "running") {
        return `running · ${formatAgeShort(t.startMs != null ? Math.max(0, now - t.startMs) : undefined)}`;
    }
    return t.startMs != null && t.endMs != null
        ? `${t.status} · ${formatAgeShort(Math.max(0, t.endMs - t.startMs))}`
        : t.status;
}

/** Pure: "18m left" for a running Monitor, null when it is persistent, has ended, or its start or timeout is unknown. */
export function monitorTimeLeft(t: BackgroundTask, now: number): string | null {
    const expires = t.status === "running" ? monitorExpiresAt(t) : null;
    if (expires == null) {
        return null;
    }
    const left = expires - now;
    return left < 60_000 ? "<1m left" : `${Math.ceil(left / 60_000)}m left`;
}

/** Pure: the footer of a Monitor peek's Events tab. While it runs: what it has reported (or since when it has
 *  watched) and when it expires; once it has ended: what it reported and when it ended. */
export function monitorEventsFooter(t: BackgroundTask, now: number): { left: string; right: string | null } {
    const summary = monitorEventsSummary(t, now);
    if (t.status !== "running") {
        return { left: summary ?? "no events", right: t.endMs != null ? `ended ${clockTime(t.endMs)}` : "ended" };
    }
    const left = summary ?? (t.startMs != null ? `watching since ${clockTime(t.startMs)}` : "watching");
    const timeLeft = monitorTimeLeft(t, now)?.replace(/ left$/, "");
    return { left, right: t.persistent ? "persistent" : timeLeft != null ? `expires in ${timeLeft}` : null };
}

/** The output lines trimmed so their joined text is at most the last maxChars characters; a line
 *  the cut lands inside is dropped rather than shown as a fragment. */
export function outputTail(lines: string[], maxChars = OUTPUT_MAX_CHARS): string[] {
    const text = lines.join("\n");
    if (text.length <= maxChars) {
        return lines;
    }
    const cutAt = text.length - maxChars;
    let tail = text.slice(cutAt);
    const newline = tail.indexOf("\n");
    // a single line longer than the cap keeps its tail; showing nothing would read as no output
    if (text[cutAt - 1] !== "\n" && newline >= 0) {
        tail = tail.slice(newline + 1);
    }
    return tail.split("\n");
}

/** Pure: the task a peek names, by its agent and task id; undefined when the peek is closed or the agent no longer
 *  holds the task. An ended task is still found, so its peek can say how it ended. */
export function peekedTask(
    byAgentId: Readonly<Record<string, BackgroundTask[]>>,
    peek: { agentId: string; taskId: string } | null
): BackgroundTask | undefined {
    return peek == null ? undefined : byAgentId[peek.agentId]?.find((t) => t.taskId === peek.taskId);
}
