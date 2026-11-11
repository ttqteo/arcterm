// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
    backgroundTaskKind,
    backgroundTasksLabel,
    backgroundTasksNoun,
    backgroundTaskState,
    backgroundTaskSubline,
    clampPeekSize,
    clockTime,
    monitorEventsFooter,
    monitorEventsSummary,
    monitorExpiresAt,
    monitorSubline,
    monitorTimeLeft,
    OUTPUT_MAX_CHARS,
    outputTail,
    parsePeekSize,
    PEEK_DEFAULT_SIZE,
    PEEK_DEFAULT_WIDTH_PX,
    PEEK_MIN_BODY_PX,
    PEEK_MIN_WIDTH_PX,
    peekedTask,
} from "./monitortasks";
import type { BackgroundTask } from "./transcriptprojection";

describe("clampPeekSize", () => {
    it("keeps a size that fits", () => {
        expect(clampPeekSize({ width: 700, body: 300 }, 1200, 600)).toEqual({ width: 700, body: 300 });
    });

    it("holds it inside the room the window leaves", () => {
        expect(clampPeekSize({ width: 2000, body: 900 }, 1200, 600)).toEqual({ width: 1200, body: 600 });
    });

    it("never drags it under the least size", () => {
        expect(clampPeekSize({ width: 50, body: 10 }, 1200, 600)).toEqual({
            width: PEEK_MIN_WIDTH_PX,
            body: PEEK_MIN_BODY_PX,
        });
    });

    it("keeps the least size in a window too small for it", () => {
        expect(clampPeekSize({ width: 500, body: 300 }, 200, 50)).toEqual({
            width: PEEK_MIN_WIDTH_PX,
            body: PEEK_MIN_BODY_PX,
        });
    });

    it("leaves an undragged body fitting its lines", () => {
        expect(clampPeekSize({ width: 600, body: null }, 1200, 600).body).toBeNull();
    });
});

describe("parsePeekSize", () => {
    it("is the default with nothing stored", () => {
        expect(parsePeekSize(null)).toEqual(PEEK_DEFAULT_SIZE);
    });

    it("reads a stored size back", () => {
        expect(parsePeekSize(JSON.stringify({ width: 720, body: 240 }))).toEqual({ width: 720, body: 240 });
    });

    it("is the default for anything unreadable", () => {
        expect(parsePeekSize("{not json")).toEqual(PEEK_DEFAULT_SIZE);
        expect(parsePeekSize(JSON.stringify({ width: "wide", body: -4 }))).toEqual({
            width: PEEK_DEFAULT_WIDTH_PX,
            body: null,
        });
    });
});

const NOW = Date.parse("2026-10-27T10:00:00.000Z");
const MIN = 60_000;

const shell = (over: Partial<BackgroundTask> = {}): BackgroundTask => ({
    toolUseId: "s",
    taskId: "bs",
    label: "Run the dev app",
    command: "task dev",
    status: "running",
    startMs: NOW - 5 * MIN,
    ...over,
});
const monitor = (over: Partial<BackgroundTask> = {}): BackgroundTask => ({
    toolUseId: "m",
    taskId: "bm",
    label: "Watch the log",
    command: "tail -f dev.log",
    status: "running",
    monitor: true,
    startMs: NOW - 10 * MIN,
    timeoutMs: 30 * MIN,
    persistent: false,
    events: [],
    ...over,
});
const events = (...agoMs: number[]) => agoMs.map((ago) => ({ ts: NOW - ago, lines: ["x"] }));

describe("kinds", () => {
    it("tells a monitor from a background shell", () => {
        expect(backgroundTaskKind(shell())).toBe("shell");
        expect(backgroundTaskKind(monitor())).toBe("monitor");
    });

    it("labels a list by its kinds", () => {
        expect(backgroundTasksLabel([shell()])).toBe("1 shell task");
        expect(backgroundTasksLabel([shell(), shell(), shell()])).toBe("3 shell tasks");
        expect(backgroundTasksLabel([monitor()])).toBe("1 monitor");
        expect(backgroundTasksLabel([monitor(), monitor()])).toBe("2 monitors");
        expect(backgroundTasksLabel([shell(), monitor(), monitor()])).toBe("3 tasks");
        expect(backgroundTasksLabel([])).toBe("0 shell tasks");
        expect(backgroundTasksNoun([shell()])).toBe("shell tasks");
        expect(backgroundTasksNoun([monitor()])).toBe("monitors");
        expect(backgroundTasksNoun([shell(), monitor()])).toBe("tasks");
    });

    it("words a task's state: a running monitor watches, an ended one is not running", () => {
        expect(backgroundTaskState(shell())).toBe("running");
        expect(backgroundTaskState(monitor())).toBe("watching");
        expect(backgroundTaskState(monitor({ status: "completed" }))).toBe("completed");
        expect(backgroundTaskState(monitor({ status: "stopped" }))).toBe("stopped");
        expect(backgroundTaskState(shell({ status: "failed" }))).toBe("failed");
    });
});

describe("monitor labels", () => {
    it("summarizes events, or nothing without any", () => {
        expect(monitorEventsSummary(monitor(), NOW)).toBeNull();
        expect(monitorEventsSummary(shell(), NOW)).toBeNull();
        expect(monitorEventsSummary(monitor({ events: events(3 * MIN) }), NOW)).toBe("1 event · 3m ago");
        expect(monitorEventsSummary(monitor({ events: events(5 * MIN, 0, 20_000, 10_000) }), NOW)).toBe(
            "4 events · just now"
        );
        // an event with no time still counts, and reads as just now
        expect(monitorEventsSummary(monitor({ events: [{ lines: ["x"] }] }), NOW)).toBe("1 event · just now");
    });

    it("writes a row's second line", () => {
        expect(monitorSubline(monitor({ startMs: NOW - 20_000 }), NOW)).toBe("no events yet · <1m");
        expect(monitorSubline(monitor({ startMs: NOW - 12 * MIN }), NOW)).toBe("no events yet · 12m");
        expect(monitorSubline(monitor({ startMs: undefined }), NOW)).toBe("no events yet · <1m");
        expect(monitorSubline(monitor({ events: events(30 * MIN, 20_000, 10_000, 0) }), NOW)).toBe(
            "4 events · just now"
        );
        const nine = events(...Array.from({ length: 9 }, (_, i) => (i === 8 ? 3 * MIN : 4 * MIN)));
        expect(monitorSubline(monitor({ persistent: true, events: nine }), NOW)).toBe("persistent · 9 events · 3m ago");
    });

    it("writes an ended monitor's second line with how it ended instead of a watch", () => {
        expect(monitorSubline(monitor({ status: "completed" }), NOW)).toBe("completed · no events");
        expect(monitorSubline(monitor({ status: "stopped", events: events(3 * MIN) }), NOW)).toBe(
            "stopped · 1 event · 3m ago"
        );
        expect(monitorSubline(monitor({ status: "stopped", persistent: true }), NOW)).toBe("stopped · no events");
    });

    it("writes a shell task's second line, running or ended", () => {
        expect(backgroundTaskSubline(shell(), NOW)).toBe("running · 5m");
        expect(backgroundTaskSubline(shell({ startMs: undefined }), NOW)).toBe("running · <1m");
        expect(backgroundTaskSubline(shell({ startMs: NOW + MIN }), NOW)).toBe("running · <1m");
        expect(backgroundTaskSubline(shell({ status: "completed", endMs: NOW - MIN }), NOW)).toBe("completed · 4m");
        expect(backgroundTaskSubline(shell({ status: "failed", endMs: NOW - 4.5 * MIN }), NOW)).toBe("failed · <1m");
        expect(backgroundTaskSubline(shell({ status: "stopped" }), NOW)).toBe("stopped");
        expect(backgroundTaskSubline(shell({ status: "completed", startMs: undefined, endMs: NOW }), NOW)).toBe(
            "completed"
        );
    });

    it("writes either kind's second line through one call", () => {
        expect(backgroundTaskSubline(monitor({ events: events(3 * MIN) }), NOW)).toBe("1 event · 3m ago");
        expect(backgroundTaskSubline(monitor({ status: "stopped" }), NOW)).toBe("stopped · no events");
    });

    it("reads the time left, rounded up", () => {
        expect(monitorTimeLeft(monitor({ startMs: NOW - 12.5 * MIN, timeoutMs: 30 * MIN }), NOW)).toBe("18m left");
        expect(monitorTimeLeft(monitor({ startMs: NOW - 30 * MIN + 30_000 }), NOW)).toBe("<1m left");
        expect(monitorTimeLeft(monitor({ startMs: NOW - 31 * MIN }), NOW)).toBe("<1m left");
        expect(monitorTimeLeft(monitor({ persistent: true }), NOW)).toBeNull();
        expect(monitorTimeLeft(monitor({ timeoutMs: undefined }), NOW)).toBeNull();
        expect(monitorTimeLeft(monitor({ startMs: undefined }), NOW)).toBeNull();
        expect(monitorTimeLeft(shell(), NOW)).toBeNull();
    });

    it("counts no time left for a monitor that is not running", () => {
        expect(monitorTimeLeft(monitor({ status: "stopped" }), NOW)).toBeNull();
        expect(monitorTimeLeft(monitor({ status: "completed" }), NOW)).toBeNull();
    });

    it("derives the expiry from start and timeout", () => {
        expect(monitorExpiresAt(monitor())).toBe(NOW - 10 * MIN + 30 * MIN);
        expect(monitorExpiresAt(monitor({ persistent: true }))).toBeNull();
        expect(monitorExpiresAt(monitor({ timeoutMs: undefined }))).toBeNull();
        expect(monitorExpiresAt(monitor({ startMs: undefined }))).toBeNull();
        expect(monitorExpiresAt(shell())).toBeNull();
    });
});

describe("monitorEventsFooter", () => {
    it("says a quiet monitor is watching since it started, with its time left", () => {
        expect(monitorEventsFooter(monitor({ startMs: NOW - 12.5 * MIN }), NOW)).toEqual({
            left: `watching since ${clockTime(NOW - 12.5 * MIN)}`,
            right: "expires in 18m",
        });
    });

    it("says a quiet monitor with no known start is watching", () => {
        expect(monitorEventsFooter(monitor({ startMs: undefined }), NOW)).toEqual({ left: "watching", right: null });
    });

    it("summarizes a monitor's events, and says a persistent one is", () => {
        expect(monitorEventsFooter(monitor({ persistent: true, events: events(3 * MIN) }), NOW)).toEqual({
            left: "1 event · 3m ago",
            right: "persistent",
        });
    });

    it("says an ended monitor ended, with its events or none", () => {
        expect(monitorEventsFooter(monitor({ status: "stopped", endMs: NOW - MIN }), NOW)).toEqual({
            left: "no events",
            right: `ended ${clockTime(NOW - MIN)}`,
        });
        expect(monitorEventsFooter(monitor({ status: "completed", events: events(2 * MIN, MIN) }), NOW)).toEqual({
            left: "2 events · 1m ago",
            right: "ended",
        });
    });
});

describe("clockTime", () => {
    it("pads every field and reads midnight as 00", () => {
        expect(clockTime(new Date(2026, 9, 27, 0, 0, 5).getTime())).toBe("00:00:05");
    });

    it("keeps a 24-hour clock", () => {
        expect(clockTime(new Date(2026, 9, 27, 23, 59, 59).getTime())).toBe("23:59:59");
    });

    it("pads a single-digit hour and minute", () => {
        expect(clockTime(new Date(2026, 9, 27, 9, 4, 42).getTime())).toBe("09:04:42");
    });
});

describe("outputTail", () => {
    it("returns short output whole, and nothing for no output", () => {
        expect(outputTail(["[exited with code 0]"])).toEqual(["[exited with code 0]"]);
        expect(outputTail([])).toEqual([]);
    });

    it("cuts to the last maxChars and drops the fragment of the line the cut lands in", () => {
        // joined: "aaaa\nbbbb\ncccc" (14 chars); the last 7 are "bb\ncccc"
        expect(outputTail(["aaaa", "bbbb", "cccc"], 7)).toEqual(["cccc"]);
    });

    it("keeps a whole first line when the cut lands on a line start", () => {
        // the last 9 are "bbbb\ncccc"
        expect(outputTail(["aaaa", "bbbb", "cccc"], 9)).toEqual(["bbbb", "cccc"]);
    });

    it("keeps the tail of a single line longer than the cap", () => {
        expect(outputTail(["x".repeat(10) + "tail"], 4)).toEqual(["tail"]);
    });

    it("defaults to 64 KB, keeping the newest lines", () => {
        expect(OUTPUT_MAX_CHARS).toBe(64 * 1024);
        const lines = Array.from({ length: 1000 }, (_, i) => `line ${i} ${"x".repeat(100)}`);
        const tail = outputTail(lines);
        expect(tail.join("\n").length).toBeLessThanOrEqual(64 * 1024);
        expect(tail.length).toBeLessThan(lines.length);
        expect(tail.at(-1)).toBe(lines.at(-1));
    });
});

describe("peekedTask", () => {
    const byId = { a1: [shell(), monitor({ taskId: "bm2", toolUseId: "m2" })], a2: [monitor()] };

    it("finds the task a peek names under its agent", () => {
        expect(peekedTask(byId, { agentId: "a1", taskId: "bm2" })?.toolUseId).toBe("m2");
        expect(peekedTask(byId, { agentId: "a2", taskId: "bm" })?.toolUseId).toBe("m");
    });

    it("finds nothing for no peek, an agent without tasks, or an id the agent does not hold", () => {
        expect(peekedTask(byId, null)).toBeUndefined();
        expect(peekedTask(byId, { agentId: "a9", taskId: "bm" })).toBeUndefined();
        expect(peekedTask(byId, { agentId: "a2", taskId: "bs" })).toBeUndefined();
    });

    it("keeps finding a task that has ended, so its peek can say so", () => {
        const ended = { a1: [monitor({ status: "stopped" })] };
        expect(peekedTask(ended, { agentId: "a1", taskId: "bm" })?.status).toBe("stopped");
    });
});
