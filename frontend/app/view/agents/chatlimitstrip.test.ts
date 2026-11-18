// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
    agentAccountId,
    agentReading,
    FIVEHOUR_WARN_PCT,
    limitStrip,
    nextSnooze,
    parseSnoozes,
    pruneSnoozes,
    stripText,
    switchTarget,
    WEEK_WARN_PCT,
} from "./chatlimitstrip";
import type { AccountChoice } from "./claudeaccount";
import type { SavedSnapshot } from "./ratelimitstore";

// a local wall-clock time as epoch seconds (a window's reset) and as epoch ms (the clock)
const secs = (y: number, mo: number, d: number, h = 0, mi = 0) => new Date(y, mo - 1, d, h, mi).getTime() / 1000;
const ms = (y: number, mo: number, d: number, h = 0, mi = 0) => secs(y, mo, d, h, mi) * 1000;

const NOW = ms(2026, 11, 18, 12, 0);
const FAR = NOW / 1000 + 3 * 24 * 3600; // a reset well ahead

describe("limitStrip", () => {
    it("shows the weekly window from 80% and not below", () => {
        const at = (pct: number) => limitStrip({ week: { pct, reset: FAR }, fivehour: {} }, undefined, NOW);
        expect(WEEK_WARN_PCT).toBe(80);
        expect(at(79)).toBeNull();
        expect(at(80)).toEqual({ window: "week", pct: 80, reset: FAR });
    });

    it("shows the 5-hour window from 90% and not below", () => {
        const at = (pct: number) => limitStrip({ week: {}, fivehour: { pct, reset: FAR } }, undefined, NOW);
        expect(FIVEHOUR_WARN_PCT).toBe(90);
        expect(at(89)).toBeNull();
        expect(at(90)).toEqual({ window: "fivehour", pct: 90, reset: FAR });
    });

    it("names the weekly window when both are past, and carries the 5-hour one", () => {
        const s = limitStrip({ week: { pct: 84, reset: FAR }, fivehour: { pct: 92, reset: FAR - 1 } }, undefined, NOW);
        expect(s).toEqual({ window: "week", pct: 84, reset: FAR, also: { pct: 92 } });
    });

    it("carries no 5-hour window that is below its threshold", () => {
        const s = limitStrip({ week: { pct: 84, reset: FAR }, fivehour: { pct: 60, reset: FAR } }, undefined, NOW);
        expect(s?.also).toBeUndefined();
    });

    it("is hidden by a snooze until its time, and shows again from then on", () => {
        const reading = { week: { pct: 84, reset: FAR }, fivehour: {} };
        expect(limitStrip(reading, NOW + 1, NOW)).toBeNull();
        expect(limitStrip(reading, NOW, NOW)?.window).toBe("week");
        expect(limitStrip(reading, NOW - 1000, NOW)?.window).toBe("week");
        expect(limitStrip(reading, undefined, NOW)?.window).toBe("week");
    });

    it("reads a window past its reset as 0%, and hides the strip", () => {
        const past = NOW / 1000 - 60;
        expect(limitStrip({ week: { pct: 95, reset: past }, fivehour: {} }, undefined, NOW)).toBeNull();
        expect(limitStrip({ week: {}, fivehour: { pct: 99, reset: past } }, undefined, NOW)).toBeNull();
        // one window rolled over, the other not: only the live one counts
        const s = limitStrip({ week: { pct: 95, reset: past }, fivehour: { pct: 93, reset: FAR } }, undefined, NOW);
        expect(s).toEqual({ window: "fivehour", pct: 93, reset: FAR });
    });

    it("shows nothing for a reading with no windows", () => {
        expect(limitStrip({ week: {}, fivehour: {} }, undefined, NOW)).toBeNull();
    });
});

describe("stripText", () => {
    it("words the weekly window with its local reset day and time", () => {
        const reset = secs(2026, 11, 19, 1, 0); // a Thursday
        expect(stripText({ window: "week", pct: 84, reset })).toBe(
            "Approaching weekly usage limit · 84% · resets Thu, Nov 19, 1:00 AM"
        );
    });

    it("words the 5-hour window with its reset time only", () => {
        const reset = secs(2026, 11, 18, 14, 30);
        expect(stripText({ window: "fivehour", pct: 92, reset })).toBe(
            "Approaching 5-hour usage limit · 92% · resets 2:30 PM"
        );
    });

    it("adds the 5-hour percentage when both are past", () => {
        const reset = secs(2026, 11, 19, 1, 0);
        expect(stripText({ window: "week", pct: 84, reset, also: { pct: 92 } })).toBe(
            "Approaching weekly usage limit · 84% · resets Thu, Nov 19, 1:00 AM · 5-hour 92%"
        );
    });

    it("rounds the percentage and reads midnight as 12 AM", () => {
        expect(stripText({ window: "fivehour", pct: 90.6, reset: secs(2026, 11, 19, 0, 5) })).toBe(
            "Approaching 5-hour usage limit · 91% · resets 12:05 AM"
        );
    });

    it("leaves the reset out when the window has none", () => {
        expect(stripText({ window: "week", pct: 81 })).toBe("Approaching weekly usage limit · 81%");
    });
});

describe("switchTarget", () => {
    const own: AccountChoice = { pick: "login", id: "", label: "me@x.com" };
    const b: AccountChoice = { pick: "a1", id: "a1", label: "Work" };
    const c: AccountChoice = { pick: "a2", id: "a2", label: "Side" };
    const keyOf = (ch: AccountChoice) => `claude:${ch.pick}`;
    const snap = (weekpct?: number, fivehourpct?: number, extra: Partial<SavedSnapshot> = {}): SavedSnapshot => ({
        weekpct,
        weekreset: weekpct == null ? undefined : FAR,
        fivehourpct,
        fivehourreset: fivehourpct == null ? undefined : NOW / 1000 + 3600,
        capturedAt: NOW,
        ...extra,
    });
    const pick = (
        saved: Record<string, SavedSnapshot>,
        window: "week" | "fivehour" = "week",
        choices: AccountChoice[] = [own, b, c]
    ) => switchTarget({ choices, ownKey: keyOf(own), keyOf, saved, window, now: NOW });

    it("picks the account with the most room on the window", () => {
        expect(pick({ "claude:a1": snap(50), "claude:a2": snap(30) })).toBe(c);
        expect(pick({ "claude:a1": snap(10), "claude:a2": snap(30) })).toBe(b);
        // judged on the window that triggered the strip
        expect(pick({ "claude:a1": snap(10, 80), "claude:a2": snap(30, 20) }, "fivehour")).toBe(c);
    });

    it("never offers the agent's own account, however much room it has", () => {
        expect(pick({ "claude:login": snap(1), "claude:a1": snap(60), "claude:a2": snap(70) })).toBe(b);
    });

    it("skips an account at or past the window's threshold", () => {
        expect(pick({ "claude:a1": snap(85), "claude:a2": snap(70) })).toBe(c);
        expect(pick({ "claude:a1": snap(80), "claude:a2": snap(79) })).toBe(c);
        expect(pick({ "claude:a1": snap(85), "claude:a2": snap(95) })).toBeNull();
        // the 5-hour threshold is 90
        expect(pick({ "claude:a1": snap(10, 90), "claude:a2": snap(10, 85) }, "fivehour")).toBe(c);
    });

    it("offers an unread account only when no other account has a reading", () => {
        expect(pick({})).toBe(b);
        expect(pick({ "claude:a2": snap(40) })).toBe(c); // a1 is unread, a2 has room
        expect(pick({ "claude:a2": snap(95) })).toBeNull(); // the one reading is past, and a1 stays unoffered
        // a snapshot that lacks the window is no reading of it
        expect(pick({ "claude:a1": snap(undefined, 50), "claude:a2": snap(undefined, 20) })).toBe(b);
    });

    it("counts a window that has rolled over as empty, not as unread", () => {
        const rolled = snap(95, undefined, { weekreset: NOW / 1000 - 60 });
        expect(pick({ "claude:a1": rolled })).toBe(b);
        expect(pick({ "claude:a1": rolled, "claude:a2": snap(40) })).toBe(b);
    });

    it("gives null when there is no other account", () => {
        expect(pick({ "claude:a1": snap(10) }, "week", [own])).toBeNull();
        expect(pick({}, "week", [])).toBeNull();
    });

    it("keeps the order of the choices on a tie", () => {
        expect(pick({ "claude:a1": snap(40), "claude:a2": snap(40) })).toBe(b);
    });
});

describe("nextSnooze", () => {
    it("adds one and four hours", () => {
        expect(nextSnooze("1h", NOW)).toBe(NOW + 3_600_000);
        expect(nextSnooze("4h", NOW)).toBe(NOW + 4 * 3_600_000);
    });

    it("tomorrow is the next local 8:00 AM: today's before it, the next day's after it", () => {
        expect(nextSnooze("tomorrow", ms(2026, 11, 18, 6, 30))).toBe(ms(2026, 11, 18, 8, 0));
        expect(nextSnooze("tomorrow", ms(2026, 11, 18, 8, 0))).toBe(ms(2026, 11, 19, 8, 0));
        expect(nextSnooze("tomorrow", ms(2026, 11, 18, 9, 0))).toBe(ms(2026, 11, 19, 8, 0));
        expect(nextSnooze("tomorrow", ms(2026, 11, 30, 23, 59))).toBe(ms(2026, 12, 1, 8, 0));
    });
});

describe("snooze storage", () => {
    it("reads the saved map and drops what is malformed", () => {
        const raw = JSON.stringify({
            "claude:a@x.com": { until: NOW + 5 },
            "claude:b": { until: "soon" },
            "claude:c": null,
            "claude:d": {},
            "claude:e": { until: NaN },
        });
        expect(parseSnoozes(raw)).toEqual({ "claude:a@x.com": { until: NOW + 5 } });
        expect(parseSnoozes(null)).toEqual({});
        expect(parseSnoozes("not json")).toEqual({});
        expect(parseSnoozes("[1,2]")).toEqual({});
        expect(parseSnoozes("7")).toEqual({});
    });

    it("prunes the snoozes that have run out", () => {
        const map = { a: { until: NOW - 1 }, b: { until: NOW }, c: { until: NOW + 1 } };
        expect(pruneSnoozes(map, NOW)).toEqual({ c: { until: NOW + 1 } });
    });
});

describe("agentReading", () => {
    const saved: SavedSnapshot = {
        weekpct: 70,
        weekreset: FAR,
        fivehourpct: 40,
        fivehourreset: NOW / 1000 + 3600,
        capturedAt: NOW,
    };

    it("takes the live windows where the agent carries them, the saved ones for the rest", () => {
        const r = agentReading({ weekpct: 84, weekreset: FAR + 5 }, saved, NOW);
        expect(r.week).toEqual({ pct: 84, reset: FAR + 5 });
        expect(r.fivehour).toEqual({ pct: 40, reset: NOW / 1000 + 3600 });
    });

    it("reads the saved snapshot when the agent has reported nothing", () => {
        const r = agentReading(undefined, saved, NOW);
        expect(r.week).toEqual({ pct: 70, reset: FAR });
        expect(r.fivehour.pct).toBe(40);
    });

    it("counts a saved window past its reset as 0", () => {
        const stale = { ...saved, weekreset: NOW / 1000 - 10 };
        expect(agentReading(undefined, stale, NOW).week.pct).toBe(0);
    });

    it("reads only the live windows with no snapshot, and nothing with neither", () => {
        expect(agentReading({ fivehourpct: 91, fivehourreset: FAR }, undefined, NOW)).toEqual({
            week: {},
            fivehour: { pct: 91, reset: FAR },
        });
        expect(agentReading(undefined, undefined, NOW)).toEqual({ week: {}, fivehour: {} });
    });
});

describe("agentAccountId", () => {
    it("reads the account an agent that has reported runs on", () => {
        expect(agentAccountId({ account: "a1" }, { "agent:claudeaccount": "a2" }, "a3")).toBe("a1");
    });

    it("reads a usage with no account as Default, not as unknown", () => {
        expect(agentAccountId({ weekpct: 10 }, { "agent:claudeaccount": "a2" }, "a3")).toBe("");
        expect(agentAccountId({}, undefined, "a3")).toBe("");
    });

    it("falls back to the account its block was launched on, `login` meaning Default", () => {
        expect(agentAccountId(undefined, { "agent:claudeaccount": "a2" }, "a3")).toBe("a2");
        expect(agentAccountId(undefined, { "agent:claudeaccount": "login" }, "a3")).toBe("");
    });

    it("falls back to the active account when it has neither", () => {
        expect(agentAccountId(undefined, undefined, "a3")).toBe("a3");
        expect(agentAccountId(undefined, {}, "")).toBe("");
        expect(agentAccountId(undefined, { "agent:claudeaccount": "" }, "a3")).toBe("a3");
        expect(agentAccountId(undefined, { "agent:claudeaccount": 7 }, "a3")).toBe("a3");
    });
});
