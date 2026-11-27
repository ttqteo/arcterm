// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import type { PairRow } from "./pairmodel";
import {
    judgeStatus,
    messageClock,
    pairControls,
    pairPromptItems,
    quoteLine,
    readFootLine,
    shortSpan,
} from "./pairpanemodel";

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

describe("pairControls", () => {
    it("keeps today's set on a live pair: the bar, composer, Reply, Run now and Unpair, and no ended footer", () => {
        expect(pairControls({ readOnly: false, ended: false })).toEqual({
            bar: true,
            composer: true,
            reply: true,
            runNow: true,
            unpair: true,
            endedFooter: false,
        });
    });
    it("swaps the composer and Unpair for the ended footer when the live pair has ended", () => {
        expect(pairControls({ readOnly: false, ended: true })).toEqual({
            bar: true,
            composer: false,
            reply: true,
            runNow: true,
            unpair: false,
            endedFooter: true,
        });
    });
    it("drops every control read-only, ended or not (the read view has its own foot line)", () => {
        const none = {
            bar: false,
            composer: false,
            reply: false,
            runNow: false,
            unpair: false,
            endedFooter: false,
        };
        expect(pairControls({ readOnly: true, ended: false })).toEqual(none);
        expect(pairControls({ readOnly: true, ended: true })).toEqual(none);
    });
});

describe("readFootLine", () => {
    it("says an ended pair is over", () => {
        expect(readFootLine({ state: "ended" })).toBe("This pair is over. Read-only.");
    });
    it("says a relaying or stopped pair is driven on the Agent surface", () => {
        const words = "Read-only here; it relays on the Agent surface.";
        expect(readFootLine({ state: "relaying" })).toBe(words);
        expect(readFootLine({ state: "stopped" })).toBe(words);
    });
    it("says a synced pair came from another machine, whatever its state: it cannot relay here", () => {
        const words = "Synced from another machine. Read-only.";
        expect(readFootLine({ state: "relaying", synced: true })).toBe(words);
        expect(readFootLine({ state: "ended", synced: true })).toBe(words);
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

describe("pairPromptItems", () => {
    const row = (
        id: string,
        side: PairRow["side"],
        who: string,
        text: string,
        extra: Partial<PairRow> = {}
    ): PairRow => ({
        id,
        side,
        ts: 0,
        who,
        judge: null,
        toLabel: "",
        text,
        quote: null,
        quoteId: null,
        held: [],
        pause: null,
        ...extra,
    });

    it("holds the judges' and your messages in order, never the worker's or a system line", () => {
        const items = pairPromptItems([
            row("1", "left", "thesis-bench", "pushed fix 1"),
            row("2", "wide", "You", "check fix 1 first"),
            row("3", "system", "", "Paired"),
            row("4", "right", "Judge", "variance still dominates\nmore"),
        ]);
        expect(items).toEqual([
            { id: "2", text: "check fix 1 first", tag: "You" },
            { id: "4", text: "variance still dominates", tag: "Judge" },
        ]);
    });

    it("names a judge by its short id while the pair has several", () => {
        expect(pairPromptItems([row("1", "right", "Judge", "ok", { judge: "c3f1" })])[0].tag).toBe("Judge c3f1");
    });
});
