// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { judgeStatus, messageClock, quoteLine, shortSpan } from "./pairpanemodel";

const side = (extra: Partial<PairSide> = {}): PairSide => ({
    tab: "4c6ba858-0d7e",
    name: "Judge",
    harness: "claude",
    ...extra,
});
const NOW = 1_000_000_000;

describe("shortSpan", () => {
    it("reads seconds under a minute, minutes under an hour, then hours", () => {
        expect(shortSpan(0)).toBe("0 s");
        expect(shortSpan(12_400)).toBe("12 s");
        expect(shortSpan(59_999)).toBe("59 s");
        expect(shortSpan(60_000)).toBe("1 m");
        expect(shortSpan(3 * 60_000 + 59_000)).toBe("3 m");
        expect(shortSpan(2 * 3_600_000 + 5 * 60_000)).toBe("2 h");
    });
    it("never goes negative when a clock runs behind a stamp", () => {
        expect(shortSpan(-5_000)).toBe("0 s");
    });
});

describe("judgeStatus", () => {
    it("names the verb of a working judge's activity and how long it has gone", () => {
        const agent = { state: "working" as const, activity: "reading study_pilot.py", activeMs: 12_000 };
        expect(judgeStatus(agent, side(), NOW)).toBe("reading · 12 s");
    });
    it("grows with the clock from stateSince, where activeMs is a duration read once", () => {
        const agent = {
            state: "working" as const,
            activity: "Running tests",
            activeMs: 1_000,
            stateSince: NOW - 30_000,
        };
        expect(judgeStatus(agent, side(), NOW)).toBe("running · 30 s");
    });
    it("says working when the activity names no verb, and no time when none is known", () => {
        expect(judgeStatus({ state: "working", activity: "task build:backend" }, side(), NOW)).toBe("working");
        expect(judgeStatus({ state: "working" }, side(), NOW)).toBe("working");
    });
    it("reads idle with its age, asking, and asleep", () => {
        expect(judgeStatus({ state: "idle", idleSince: NOW - 90_000 }, side(), NOW)).toBe("idle · 1 m");
        expect(judgeStatus({ state: "idle" }, side(), NOW)).toBe("idle");
        expect(judgeStatus({ state: "asking", blockedMs: 5_000 }, side(), NOW)).toBe("asking · 5 s");
        expect(
            judgeStatus({ state: "idle", idleSince: NOW - 90_000, sleeping: { since: 1, freedBytes: 0 } }, side(), NOW)
        ).toBe("asleep");
    });
    it("reads gone for a judge the pair lost or the roster no longer holds", () => {
        expect(judgeStatus({ state: "working" }, side({ gone: true }), NOW)).toBe("gone");
        expect(judgeStatus(undefined, side(), NOW)).toBe("gone");
    });
});

describe("messageClock", () => {
    it("is the local HH:MM with a leading zero", () => {
        expect(messageClock(new Date(2026, 10, 25, 10, 58).getTime())).toBe("10:58");
        expect(messageClock(new Date(2026, 10, 25, 9, 5).getTime())).toBe("09:05");
        expect(messageClock(new Date(2026, 10, 25, 0, 0).getTime())).toBe("00:00");
    });
});

describe("quoteLine", () => {
    it("is the first line that holds text, whitespace collapsed", () => {
        expect(quoteLine("\n\n  Pilot first   is right.\nSecond line.")).toBe("Pilot first is right.");
    });
    it("cuts a long line at a word and ends it with an ellipsis", () => {
        const line = "word ".repeat(40).trim();
        const out = quoteLine(line, 30);
        expect(out.endsWith("…")).toBe(true);
        expect(out.length).toBeLessThanOrEqual(31);
        expect(out).not.toMatch(/\s…$/);
    });
    it("keeps a line that fits whole", () => {
        expect(quoteLine("short one", 30)).toBe("short one");
    });
    it("is empty for text with nothing in it", () => {
        expect(quoteLine("  \n \n")).toBe("");
    });
});
