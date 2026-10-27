// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The Overview's Activity card, as data (projectactivitycard.tsx draws it): a GitHub-style calendar of 53 Monday-first
// week columns ending with the week that holds today, one cell per local day up to today. What each day holds is the
// daily tally's (GetProjectActivity); this builds the cells, their levels, the month labels, the tooltip words and the
// two number lines from it. No React, no atoms.

import { formatTokens } from "./agentsviewmodel";

export const ACTIVITY_WEEKS = 53;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

// a month label closer than this many columns to the one before it is left out
const MONTH_GAP = 3;

export type ActivityLevel = 0 | 1 | 2 | 3 | 4;

export interface ActivityCell {
    day: string; // local YYYY-MM-DD
    date: Date; // local midnight
    weekday: number; // 0 = Monday
    col: number;
    record: ProjectActivityDay | null; // null when the day has no record (it is before the tally began)
    none: boolean;
    level: ActivityLevel; // 0 for a day with no tokens, and for a no-record day, which draws no fill at all
    today: boolean;
}

export interface ActivityMonth {
    col: number;
    label: string;
}

export interface ActivityGrid {
    cells: ActivityCell[]; // oldest first; index / 7 is the column, index % 7 the weekday
    months: ActivityMonth[];
    cuts: [number, number, number];
    sessions: number; // the distinct sessions of the window
    tokens: number; // the window's days summed
    since: string; // the first day the grid has a record for, "" when none has
    summary: string;
    last7: { tokens: number; runs: number; councils: number };
}

const pad = (n: number) => String(n).padStart(2, "0");

export function dayKey(d: Date): string {
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

// "30 Jul" from a YYYY-MM-DD
function dayLabel(day: string): string {
    const [, m, d] = day.split("-").map(Number);
    return `${d} ${MONTHS[m - 1]}`;
}

/** The nearest-rank 25th, 50th and 75th percentile of the non-zero values (zeros when there are none). */
export function quartileCuts(values: readonly number[]): [number, number, number] {
    const sorted = values.filter((v) => v > 0).sort((a, b) => a - b);
    const n = sorted.length;
    if (n === 0) {
        return [0, 0, 0];
    }
    const at = (k: number) => sorted[Math.ceil((k * n) / 4) - 1];
    return [at(1), at(2), at(3)];
}

/** 0 for no tokens, else 1 to 4 by how many cuts the day is above: ties sit with the lower step, so a window whose
 *  busy days are all alike shows them all at 1. */
export function levelFor(tokens: number, cuts: readonly [number, number, number]): ActivityLevel {
    if (tokens <= 0) {
        return 0;
    }
    return (1 + cuts.filter((c) => tokens > c).length) as ActivityLevel;
}

/** The grid of the 53 weeks ending with today's: `rtn` read from the backend (its days in any order). */
export function activityGrid(rtn: CommandGetProjectActivityRtnData, today: Date): ActivityGrid {
    const byDay = new Map<string, ProjectActivityDay>();
    for (const d of rtn.days ?? []) {
        byDay.set(d.day, d);
    }
    const weekday = (today.getDay() + 6) % 7;
    const first = new Date(today.getFullYear(), today.getMonth(), today.getDate() - weekday - (ACTIVITY_WEEKS - 1) * 7);
    const count = (ACTIVITY_WEEKS - 1) * 7 + weekday + 1;
    const todayKey = dayKey(today);
    const firstDay = rtn.firstday ?? "";

    const cells: ActivityCell[] = [];
    for (let i = 0; i < count; i++) {
        const date = new Date(first.getFullYear(), first.getMonth(), first.getDate() + i);
        const day = dayKey(date);
        const none = firstDay === "" || day < firstDay;
        cells.push({
            day,
            date,
            weekday: i % 7,
            col: Math.floor(i / 7),
            record: none ? null : (byDay.get(day) ?? { day, tokens: 0, sessions: 0, runs: 0, councils: 0 }),
            none,
            level: 0,
            today: day === todayKey,
        });
    }
    const cuts = quartileCuts(cells.map((c) => c.record?.tokens ?? 0));
    for (const c of cells) {
        c.level = levelFor(c.record?.tokens ?? 0, cuts);
    }

    const months: ActivityMonth[] = [];
    let lastMonth = -1;
    let lastLabelCol = -MONTH_GAP;
    for (const c of cells) {
        if (c.weekday !== 0 || c.date.getMonth() === lastMonth) {
            continue;
        }
        lastMonth = c.date.getMonth();
        if (c.col > 0 && c.col < ACTIVITY_WEEKS - 1 && c.col - lastLabelCol >= MONTH_GAP) {
            months.push({ col: c.col, label: MONTHS[lastMonth] });
            lastLabelCol = c.col;
        }
    }

    const tokens = cells.reduce((n, c) => n + (c.record?.tokens ?? 0), 0);
    const last7 = cells.slice(-7).reduce(
        (acc, c) => ({
            tokens: acc.tokens + (c.record?.tokens ?? 0),
            runs: acc.runs + (c.record?.runs ?? 0),
            councils: acc.councils + (c.record?.councils ?? 0),
        }),
        { tokens: 0, runs: 0, councils: 0 }
    );
    const firstRecorded = cells.find((c) => !c.none);
    const since = firstRecorded?.day ?? "";
    const sessions = rtn.sessions ?? 0;
    // the tally is shared by every project, so a project of its own with nothing on it reads like an empty tally
    const empty = since === "" || (sessions === 0 && byDay.size === 0);
    const summary = empty
        ? "No activity recorded yet"
        : `${plural(sessions, "session")} · ${formatTokens(tokens)} tokens since ${dayLabel(since)}`;
    return { cells, months, cuts, sessions, tokens, since, summary, last7 };
}

/** What a cell's tooltip says: the day, then its numbers (a day with no session says so, even when a run or council
 *  was started on it). */
export function cellTooltip(cell: ActivityCell): { title: string; line: string } {
    const d = cell.date;
    const title = `${WEEKDAYS[cell.weekday]} ${d.getDate()} ${MONTHS[d.getMonth()]}${cell.today ? " · today" : ""}`;
    const r = cell.record;
    if (r == null) {
        return { title, line: "No record" };
    }
    if (r.sessions === 0) {
        return { title, line: "No session" };
    }
    const started = [r.runs > 0 ? plural(r.runs, "run") : "", r.councils > 0 ? plural(r.councils, "council") : ""]
        .filter(Boolean)
        .join(", ");
    const line = `${formatTokens(r.tokens)} tokens · ${plural(r.sessions, "session")}`;
    return { title, line: started === "" ? line : `${line} · ${started}` };
}

/** The cell an arrow key moves to from `index`: Left and Right a week, Up and Down a day, kept inside the grid (its
 *  last cell is today). A week back that would leave the grid stays put; a week on that would pass today lands on
 *  today. Null for any other key. */
export function moveCell(index: number, key: string, cellCount: number): number | null {
    let to: number;
    switch (key) {
        case "ArrowLeft":
            to = index - 7 < 0 ? index : index - 7;
            break;
        case "ArrowRight":
            to = index + 7;
            break;
        case "ArrowUp":
            to = index - 1;
            break;
        case "ArrowDown":
            to = index + 1;
            break;
        default:
            return null;
    }
    return Math.min(Math.max(to, 0), cellCount - 1);
}

/** The footer's "13 sessions · 6.9M tokens": the session count leaves out while History's sessions load (null). */
export function last7Line(tokens: number, sessions: number | null): string {
    const t = `${formatTokens(tokens)} tokens`;
    return sessions == null ? t : `${plural(sessions, "session")} · ${t}`;
}
