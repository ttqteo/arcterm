// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { activityGrid, cellTooltip, dayKey, last7Line, levelFor, moveCell, quartileCuts } from "./projectactivity";

const day = (d: string, tokens = 0, sessions = 0, runs = 0, councils = 0): ProjectActivityDay => ({
    day: d,
    tokens,
    sessions,
    runs,
    councils,
});
const rtn = (days: ProjectActivityDay[], firstday = "2026-01-01", sessions = 0): CommandGetProjectActivityRtnData => ({
    days,
    firstday,
    sessions,
});

// 2026-10-28 is a Wednesday
const WED = new Date(2026, 9, 28, 14, 30);

describe("activityGrid shape", () => {
    // 2026-10-26 is a Monday: each of the seven days of that week as "today"
    it.each([0, 1, 2, 3, 4, 5, 6])("holds 53 week columns ending today (weekday %i)", (offset) => {
        const today = new Date(2026, 9, 26 + offset, 9);
        const g = activityGrid(rtn([]), today);
        expect(g.cells).toHaveLength(52 * 7 + offset + 1);
        expect(g.cells[g.cells.length - 1].day).toBe(dayKey(today));
        expect(g.cells[g.cells.length - 1].today).toBe(true);
        expect(g.cells.filter((c) => c.today)).toHaveLength(1);
        expect(g.cells[g.cells.length - 1].col).toBe(52);
        expect(g.cells[0].weekday).toBe(0); // Monday first
        expect(g.cells[0].day).toBe(dayKey(new Date(2026, 9, 26 - 52 * 7)));
        expect(g.cells[g.cells.length - 1].weekday).toBe(offset);
    });

    it("steps one local day per cell across a daylight-saving change", () => {
        const g = activityGrid(rtn([]), WED);
        const keys = g.cells.map((c) => c.day);
        expect(new Set(keys).size).toBe(keys.length);
        keys.slice(1).forEach((k, i) => expect(k > keys[i]).toBe(true));
    });

    it("marks days before firstday, and every day when firstday is empty, as no record", () => {
        const g = activityGrid(rtn([day("2026-10-27", 100, 1)], "2026-10-20"), WED);
        const none = g.cells.filter((c) => c.none);
        expect(none[none.length - 1].day).toBe("2026-10-19");
        expect(none.every((c) => c.record == null)).toBe(true);
        const after = g.cells.find((c) => c.day === "2026-10-20");
        expect(after?.none).toBe(false);
        expect(after?.record).toEqual(day("2026-10-20"));
        expect(activityGrid(rtn([], ""), WED).cells.every((c) => c.none)).toBe(true);
    });

    it("reads a day the tally has an entry for, in any order", () => {
        const g = activityGrid(rtn([day("2026-10-27", 5, 1), day("2026-10-20", 9, 2)]), WED);
        expect(g.cells.find((c) => c.day === "2026-10-27")?.record?.tokens).toBe(5);
        expect(g.cells.find((c) => c.day === "2026-10-20")?.record?.tokens).toBe(9);
    });
});

describe("levels", () => {
    it("cuts at the quartiles of the non-zero values", () => {
        expect(quartileCuts([0, 0, 1, 2, 3, 4, 5, 6, 7, 8])).toEqual([2, 4, 6]);
        expect(quartileCuts([])).toEqual([0, 0, 0]);
        expect(quartileCuts([0, 0])).toEqual([0, 0, 0]);
    });

    it("gives zero tokens level 0 and the rest 1 to 4", () => {
        const cuts: [number, number, number] = [2, 4, 6];
        expect([0, 1, 2, 3, 4, 5, 6, 7, 8].map((t) => levelFor(t, cuts))).toEqual([0, 1, 1, 2, 2, 3, 3, 4, 4]);
    });

    it("keeps ties on the lower step", () => {
        expect(quartileCuts([5, 5, 5, 5, 9])).toEqual([5, 5, 5]);
        expect(levelFor(5, [5, 5, 5])).toBe(1);
        expect(levelFor(9, [5, 5, 5])).toBe(4);
    });

    it("gives a single non-zero day level 1", () => {
        const g = activityGrid(rtn([day("2026-10-27", 700, 1)]), WED);
        expect(g.cuts).toEqual([700, 700, 700]);
        expect(g.cells.find((c) => c.day === "2026-10-27")?.level).toBe(1);
        expect(g.cells.filter((c) => c.level > 0)).toHaveLength(1);
    });

    it("takes the cuts from the window's days only", () => {
        const days = [1, 2, 3, 4].map((n) => day(`2026-10-2${n}`, n * 100, 1));
        const g = activityGrid(rtn(days), WED);
        expect(g.cells.filter((c) => c.day >= "2026-10-21" && c.day <= "2026-10-24").map((c) => c.level)).toEqual([
            1, 2, 3, 4,
        ]);
    });
});

describe("month labels", () => {
    it("labels a week whose Monday starts a new month, never the first or the last column", () => {
        const g = activityGrid(rtn([]), WED);
        // Monday 2026-10-26 is the last column's, and Oct began on its own earlier Monday (2026-10-05, col 49)
        expect(g.months.map((m) => m.label)).toEqual([
            "Nov",
            "Dec",
            "Jan",
            "Feb",
            "Mar",
            "Apr",
            "May",
            "Jun",
            "Jul",
            "Aug",
            "Sep",
            "Oct",
        ]);
        expect(g.months.every((m) => m.col > 0 && m.col < 52)).toBe(true);
    });

    it("keeps each label at least 3 columns from the one before", () => {
        for (const d of [26, 27, 28, 29, 30, 31, 32]) {
            const g = activityGrid(rtn([]), new Date(2026, 9, d));
            g.months.slice(1).forEach((m, i) => expect(m.col - g.months[i].col).toBeGreaterThanOrEqual(3));
        }
    });

    it("puts no label on a last column, even one that starts a month", () => {
        // Monday 2026-11-02 starts November and is the last column's
        const g = activityGrid(rtn([]), new Date(2026, 10, 3));
        expect(g.cells[g.cells.length - 1].col).toBe(52);
        expect(g.months.find((m) => m.col === 52)).toBeUndefined();
        expect(g.months[g.months.length - 1].label).toBe("Oct");
    });
});

describe("cellTooltip", () => {
    const cell = (d: string, days: ProjectActivityDay[]) => {
        const c = activityGrid(rtn(days), WED).cells.find((x) => x.day === d);
        if (c == null) {
            throw new Error(`no cell ${d}`);
        }
        return c;
    };

    it("words a busy day", () => {
        expect(cellTooltip(cell("2026-10-26", [day("2026-10-26", 2_100_000, 3, 3, 1)]))).toEqual({
            title: "Mon 26 Oct",
            line: "2.1M tokens · 3 sessions · 3 runs, 1 council",
        });
    });

    it("leaves out what was not started, and says 1 session", () => {
        expect(cellTooltip(cell("2026-10-26", [day("2026-10-26", 840_000, 1)])).line).toBe("840k tokens · 1 session");
        expect(cellTooltip(cell("2026-10-26", [day("2026-10-26", 1000, 1, 0, 2)])).line).toBe(
            "1k tokens · 1 session · 2 councils"
        );
    });

    it("says No session for a day with runs but no session", () => {
        expect(cellTooltip(cell("2026-10-25", [day("2026-10-25", 0, 0, 2, 1)])).line).toBe("No session");
        expect(cellTooltip(cell("2026-10-24", [])).line).toBe("No session");
    });

    it("says No record before the tally began", () => {
        const c = activityGrid(rtn([], "2026-10-20"), WED).cells.find((x) => x.day === "2026-10-19");
        expect(c && cellTooltip(c)).toEqual({ title: "Mon 19 Oct", line: "No record" });
    });

    it("names today", () => {
        expect(cellTooltip(cell("2026-10-28", [day("2026-10-28", 1_500_000, 2)]))).toEqual({
            title: "Wed 28 Oct · today",
            line: "1.5M tokens · 2 sessions",
        });
    });
});

describe("summary and last 7 days", () => {
    it("counts the RPC's distinct sessions, not the days', and names the first record day", () => {
        const days = [day("2026-10-27", 3_000_000, 1), day("2026-10-28", 3_900_000, 1)];
        const g = activityGrid(rtn(days, "2026-07-30", 1), WED);
        expect(g.sessions).toBe(1);
        expect(g.tokens).toBe(6_900_000);
        expect(g.since).toBe("2026-07-30");
        expect(g.summary).toBe("1 session · 6.9M tokens since 30 Jul");
    });

    it("names the grid's first day when the tally began before the grid", () => {
        const g = activityGrid(rtn([day("2026-10-27", 10, 1)], "2020-01-01", 4), WED);
        expect(g.since).toBe(g.cells[0].day);
        expect(g.cells[0].day).toBe("2025-10-27");
        expect(g.summary).toBe("4 sessions · 10 tokens since 27 Oct");
    });

    it("reads No activity recorded yet for an empty tally or a project with nothing on it", () => {
        expect(activityGrid(rtn([], ""), WED).summary).toBe("No activity recorded yet");
        expect(activityGrid(rtn([], "2026-07-30"), WED).summary).toBe("No activity recorded yet");
    });

    it("sums the last 7 local days only", () => {
        const days = [
            day("2026-10-21", 1000, 1, 5, 5), // eight days back: out
            day("2026-10-22", 10, 1, 1, 0),
            day("2026-10-26", 20, 1, 3, 1),
            day("2026-10-28", 30, 1, 0, 2),
        ];
        expect(activityGrid(rtn(days), WED).last7).toEqual({ tokens: 60, runs: 4, councils: 3 });
    });

    it("sums the 7 days ending today, however far into the week today is", () => {
        const monday = new Date(2026, 9, 26);
        const g = activityGrid(rtn([day("2026-10-20", 7, 1, 1, 1), day("2026-10-19", 99, 1, 9, 9)]), monday);
        expect(g.last7).toEqual({ tokens: 7, runs: 1, councils: 1 });
    });
});

describe("last7Line", () => {
    it("reads sessions then tokens, and only tokens while the sessions load", () => {
        expect(last7Line(6_900_000, 13)).toBe("13 sessions · 6.9M tokens");
        expect(last7Line(6_900_000, 1)).toBe("1 session · 6.9M tokens");
        expect(last7Line(0, null)).toBe("0 tokens");
    });
});

describe("moveCell", () => {
    const n = 52 * 7 + 3; // today a Wednesday: index 366 is the last cell

    it("moves a week with Left and Right, a day with Up and Down", () => {
        expect(moveCell(100, "ArrowLeft", n)).toBe(93);
        expect(moveCell(100, "ArrowRight", n)).toBe(107);
        expect(moveCell(100, "ArrowUp", n)).toBe(99);
        expect(moveCell(100, "ArrowDown", n)).toBe(101);
    });

    it("stays inside the grid at the first cell", () => {
        expect(moveCell(0, "ArrowUp", n)).toBe(0);
        expect(moveCell(3, "ArrowLeft", n)).toBe(3); // a week back would leave the grid
    });

    it("stops at today, the last cell", () => {
        expect(moveCell(n - 1, "ArrowDown", n)).toBe(n - 1);
        expect(moveCell(n - 1, "ArrowRight", n)).toBe(n - 1);
        expect(moveCell(n - 4, "ArrowRight", n)).toBe(n - 1); // the next week's same weekday is past today
    });

    it("ignores other keys", () => {
        expect(moveCell(10, "Enter", n)).toBeNull();
        expect(moveCell(10, "a", n)).toBeNull();
    });
});
