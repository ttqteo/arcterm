// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
    DAY_IDS,
    formatSchedule,
    formatWhen,
    OFFICE_HOURS,
    onUntilFor,
    parseOnForHours,
    parseSchedule,
    runsPastMidnight,
    scheduleOrOffice,
    telegramView,
    toggleDay,
} from "./telegrammodel";

const NOW = 1_800_000_000_000;

// a bot whose token check answered, with nothing else going on
const live: TelegramStatusData = { enabled: true, hastoken: true, botname: "arc_bot" };
// paired with a chat and inside the allowed time, not connected
const paired: TelegramStatusData = { ...live, chatname: "Verify chat", allowed: true };

describe("telegramView", () => {
    it("reads no status, and a status without a token, as no token", () => {
        expect(telegramView(null, NOW)).toEqual({ kind: "no-token" });
        expect(telegramView({ enabled: false, hastoken: false }, NOW)).toEqual({ kind: "no-token" });
    });

    it("puts a missing token ahead of everything else", () => {
        const s = { ...live, hastoken: false, lasterror: "Token rejected by Telegram", chatname: "Me" };
        expect(telegramView(s, NOW)).toEqual({ kind: "no-token" });
    });

    it("reads a token with the switch off as off, even after an error", () => {
        expect(telegramView({ ...live, enabled: false }, NOW)).toEqual({ kind: "off" });
        expect(telegramView({ ...live, enabled: false, lasterror: "old" }, NOW)).toEqual({ kind: "off" });
    });

    it("shows the last error while the switch is on, ahead of the token check", () => {
        const s = { ...live, lasterror: "Token rejected by Telegram" };
        expect(telegramView(s, NOW)).toEqual({ kind: "error", text: "Token rejected by Telegram" });
        expect(telegramView({ ...s, botname: undefined }, NOW)).toMatchObject({ kind: "error" });
    });

    it("reads a bot whose token check has not answered as checking", () => {
        expect(telegramView({ ...live, botname: undefined }, NOW)).toEqual({ kind: "checking" });
        expect(telegramView({ ...live, botname: "" }, NOW)).toEqual({ kind: "checking" });
        // checking comes before a code, so a pair pressed before the name arrives still says it is checking
        const code = { ...live, botname: "", paircode: "123456", paircodeexpires: NOW + 60_000 };
        expect(telegramView(code, NOW)).toEqual({ kind: "checking" });
    });

    it("shows the pair code with the minutes left, rounded up and never under one", () => {
        const base = { ...live, paircode: "123456" };
        expect(telegramView({ ...base, paircodeexpires: NOW + 10 * 60_000 }, NOW)).toEqual({
            kind: "pairing",
            code: "123456",
            minutesLeft: 10,
            bot: "arc_bot",
        });
        expect(telegramView({ ...base, paircodeexpires: NOW + 90_000 }, NOW)).toMatchObject({ minutesLeft: 2 });
        expect(telegramView({ ...base, paircodeexpires: NOW + 1 }, NOW)).toMatchObject({ minutesLeft: 1 });
    });

    it("drops a pair code that has expired", () => {
        const s = { ...live, paircode: "123456", paircodeexpires: NOW };
        expect(telegramView(s, NOW)).toEqual({ kind: "unpaired", bot: "arc_bot" });
        expect(telegramView({ ...s, paircodeexpires: NOW - 1 }, NOW)).toEqual({ kind: "unpaired", bot: "arc_bot" });
    });

    it("drops a pair code that has no expiry", () => {
        expect(telegramView({ ...live, paircode: "123456" }, NOW)).toEqual({ kind: "unpaired", bot: "arc_bot" });
    });

    it("shows a live code ahead of a paired chat, so a re-pair shows its code", () => {
        const repair = { ...paired, paircode: "654321", paircodeexpires: NOW + 60_000 };
        expect(telegramView(repair, NOW)).toMatchObject({ kind: "pairing", code: "654321" });
    });

    it("reads a bot with no chat as unpaired, allowed time or not", () => {
        expect(telegramView(live, NOW)).toEqual({ kind: "unpaired", bot: "arc_bot" });
        expect(telegramView({ ...live, allowed: true, connected: true }, NOW)).toEqual({
            kind: "unpaired",
            bot: "arc_bot",
        });
    });

    it("reads a paired chat outside the allowed time as asleep, with when it wakes", () => {
        const next = NOW + 3_600_000;
        expect(telegramView({ ...paired, allowed: undefined, nextallowed: next }, NOW)).toEqual({
            kind: "asleep",
            chat: "Verify chat",
            bot: "arc_bot",
            nextAllowed: next,
        });
        // nothing will turn it on: nextallowed is absent
        expect(telegramView({ ...paired, allowed: false }, NOW)).toMatchObject({ kind: "asleep", nextAllowed: 0 });
    });

    it("reads asleep ahead of connected: a session that lingers past the allowed time is off", () => {
        const s = { ...paired, allowed: false, connected: true, open: 1 };
        expect(telegramView(s, NOW)).toMatchObject({ kind: "asleep" });
    });

    it("reads a connected paired bot as connected, with the questions open", () => {
        expect(telegramView({ ...paired, connected: true }, NOW)).toEqual({
            kind: "connected",
            chat: "Verify chat",
            bot: "arc_bot",
            open: 0,
        });
        expect(telegramView({ ...paired, connected: true, open: 2 }, NOW)).toMatchObject({
            kind: "connected",
            open: 2,
        });
    });

    it("reads a paired, allowed bot with no connection as idle", () => {
        expect(telegramView(paired, NOW)).toEqual({ kind: "idle", chat: "Verify chat", bot: "arc_bot" });
        // questions left open across a stop do not make it connected
        expect(telegramView({ ...paired, open: 1 }, NOW)).toMatchObject({ kind: "idle" });
    });
});

// local-time moments, so the tests hold in any time zone
const at = (y: number, mon: number, d: number, h = 0, min = 0) => new Date(y, mon - 1, d, h, min).getTime();

describe("formatWhen", () => {
    const now = at(2026, 10, 16, 9, 30); // a Friday

    it("says the clock for a moment today", () => {
        expect(formatWhen(at(2026, 10, 16, 15, 40), now)).toBe("15:40");
        expect(formatWhen(at(2026, 10, 16, 0, 5), now)).toBe("00:05");
        expect(formatWhen(at(2026, 10, 16, 23, 59), now)).toBe("23:59");
    });

    it("says the weekday and clock for a moment in the next six days", () => {
        expect(formatWhen(at(2026, 10, 17, 8, 0), now)).toBe("Sat 08:00");
        expect(formatWhen(at(2026, 10, 19, 8, 0), now)).toBe("Mon 08:00");
        expect(formatWhen(at(2026, 10, 22, 23, 30), now)).toBe("Thu 23:30");
    });

    it("says the date for a moment a week or more away, and the same weekday next week is not today's", () => {
        expect(formatWhen(at(2026, 10, 23, 8, 0), now)).toBe("Oct 23 08:00");
        expect(formatWhen(at(2026, 12, 1, 17, 30), now)).toBe("Dec 1 17:30");
    });

    it("counts calendar days, not 24-hour spans", () => {
        const late = at(2026, 10, 16, 23, 50);
        expect(formatWhen(at(2026, 10, 17, 0, 10), late)).toBe("Sat 00:10");
    });
});

describe("on for", () => {
    it("reads hours inside 0.25–24 and nothing else", () => {
        expect(parseOnForHours("1")).toBe(1);
        expect(parseOnForHours(" 1.5 ")).toBe(1.5);
        expect(parseOnForHours("0.25")).toBe(0.25);
        expect(parseOnForHours("24")).toBe(24);
        for (const bad of ["", "  ", "0", "0.2", "24.5", "-1", "abc", "1h", "NaN", "Infinity"]) {
            expect(parseOnForHours(bad), bad).toBeNull();
        }
    });

    it("ends an on-for in whole milliseconds, which the integer setting needs", () => {
        expect(onUntilFor(1, NOW)).toBe(NOW + 3_600_000);
        expect(onUntilFor(1.5, NOW)).toBe(NOW + 5_400_000);
        expect(Number.isInteger(onUntilFor(1 / 3, NOW + 0.4))).toBe(true);
    });
});

describe("schedule", () => {
    it("reads office hours, and an unset schedule as office hours", () => {
        const office = { days: ["mon", "tue", "wed", "thu", "fri"], from: "08:00", to: "17:30" };
        expect(parseSchedule(OFFICE_HOURS)).toEqual(office);
        expect(parseSchedule("")).toEqual(office);
        expect(scheduleOrOffice("")).toEqual(office);
    });

    it("round-trips office hours", () => {
        expect(formatSchedule(parseSchedule(OFFICE_HOURS)!)).toBe(OFFICE_HOURS);
        expect(formatSchedule(scheduleOrOffice(""))).toBe(OFFICE_HOURS);
    });

    it("round-trips a window that wraps midnight", () => {
        const s = "mon,wed,fri,sun 22:00-06:00";
        const parsed = parseSchedule(s)!;
        expect(parsed).toEqual({ days: ["mon", "wed", "fri", "sun"], from: "22:00", to: "06:00" });
        expect(formatSchedule(parsed)).toBe(s);
        expect(runsPastMidnight(parsed)).toBe(true);
    });

    it("reads days in any case and order, and writes them mon…sun", () => {
        const parsed = parseSchedule("Sun, FRI ,mon 9:05-17:00")!;
        expect(parsed).toEqual({ days: ["mon", "fri", "sun"], from: "09:05", to: "17:00" });
        expect(formatSchedule(parsed)).toBe("mon,fri,sun 09:05-17:00");
        expect(formatSchedule({ days: ["sun", "mon"], from: "01:00", to: "02:00" })).toBe("mon,sun 01:00-02:00");
    });

    it("rejects what the Go side rejects", () => {
        for (const bad of [
            "mon",
            "mon 08:00",
            "mon 08:00-",
            "mon 08:00-17:30-18:00",
            "mox 08:00-17:30",
            "mon,, 08:00-17:30",
            "mon 8:0-17:30",
            "mon 24:00-17:30",
            "mon 08:60-17:30",
            "08:00-17:30",
        ]) {
            expect(parseSchedule(bad), bad).toBeNull();
        }
    });

    it("reads a schedule that does not parse as office hours, as the bot does", () => {
        expect(scheduleOrOffice("whenever")).toEqual(parseSchedule(OFFICE_HOURS));
    });

    it("says when a window runs past midnight: to is not after from", () => {
        expect(runsPastMidnight(scheduleOrOffice(""))).toBe(false);
        expect(runsPastMidnight({ days: ["mon"], from: "08:00", to: "08:01" })).toBe(false);
        expect(runsPastMidnight({ days: ["mon"], from: "08:00", to: "08:00" })).toBe(true);
        expect(runsPastMidnight({ days: ["mon"], from: "22:00", to: "06:00" })).toBe(true);
    });

    it("toggles a day on and off, keeping mon…sun order", () => {
        const office = scheduleOrOffice("");
        const withSat = toggleDay(office, "sat");
        expect(withSat.days).toEqual(["mon", "tue", "wed", "thu", "fri", "sat"]);
        expect(formatSchedule(withSat)).toBe("mon,tue,wed,thu,fri,sat 08:00-17:30");
        expect(toggleDay(withSat, "sat")).toEqual(office);
        expect(toggleDay(toggleDay(office, "sun"), "mon").days).toEqual(["tue", "wed", "thu", "fri", "sun"]);
    });

    it("keeps the last pressed day: a schedule with no day does not parse", () => {
        const one = { days: ["wed" as const], from: "08:00", to: "17:30" };
        expect(toggleDay(one, "wed")).toBe(one);
        expect(parseSchedule(formatSchedule(one))).toEqual(one);
    });

    it("lists the seven days Monday first", () => {
        expect(DAY_IDS).toEqual(["mon", "tue", "wed", "thu", "fri", "sat", "sun"]);
    });
});
