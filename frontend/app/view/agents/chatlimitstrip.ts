// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The rules behind Chat's usage-limit strip (chatlimitstripview.tsx draws it): when the Claude account an agent runs on
// is near its weekly or 5-hour limit, what the strip says, which account it offers to switch to, and how long a snooze
// hides it. Pure; the view reads the atoms and the clock.
// See docs/superpowers/specs/2026-11-18-chat-suggest-card-design.md (section 2, decisions 7 to 12 and 14).

import { CLAUDE_ACCOUNT_META, DEFAULT_ACCOUNT_PICK, type AccountChoice } from "./claudeaccount";
import { savedWindows, type DonutWindow, type SavedSnapshot } from "./ratelimitstore";

// The strip shows from here: the week lasts longer, so it is warned earlier than the 5-hour window.
export const WEEK_WARN_PCT = 80;
export const FIVEHOUR_WARN_PCT = 90;

export type LimitWindow = "week" | "fivehour";

export interface LimitReading {
    week: DonutWindow;
    fivehour: DonutWindow;
}

export interface LimitStripData {
    window: LimitWindow; // the weekly one when both are past
    pct: number;
    reset?: number; // epoch seconds
    also?: { pct: number }; // the 5-hour window too, when the strip names the week and it is past as well
}

function warnPct(window: LimitWindow): number {
    return window === "week" ? WEEK_WARN_PCT : FIVEHOUR_WARN_PCT;
}

// A window past its reset has rolled over whatever it last read; one with no reading is 0.
function pctAt(w: DonutWindow, now: number): number {
    if (w.pct == null || (w.reset != null && w.reset * 1000 <= now)) {
        return 0;
    }
    return w.pct;
}

// The strip to show for a reading, or null: both windows below their thresholds, or the account snoozed until after
// `now`. A snooze holds whatever the window does meanwhile; it ends at its time, not before.
export function limitStrip(
    reading: LimitReading,
    snoozedUntil: number | undefined,
    now: number
): LimitStripData | null {
    if (snoozedUntil != null && snoozedUntil > now) {
        return null;
    }
    const week = pctAt(reading.week, now);
    const fivehour = pctAt(reading.fivehour, now);
    const fivehourPast = fivehour >= FIVEHOUR_WARN_PCT;
    if (week >= WEEK_WARN_PCT) {
        return {
            window: "week",
            pct: week,
            reset: reading.week.reset,
            ...(fivehourPast ? { also: { pct: fivehour } } : {}),
        };
    }
    return fivehourPast ? { window: "fivehour", pct: fivehour, reset: reading.fivehour.reset } : null;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// "1:00 AM", in local time; written out rather than asked of Intl, whose en-US time carries a narrow no-break space.
function clockText(d: Date): string {
    const h = d.getHours();
    return `${h % 12 === 0 ? 12 : h % 12}:${String(d.getMinutes()).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

function resetText(epochSeconds: number, window: LimitWindow): string {
    const d = new Date(epochSeconds * 1000);
    return window === "week"
        ? `${WEEKDAYS[d.getDay()]}, ${MONTHS[d.getMonth()]} ${d.getDate()}, ${clockText(d)}`
        : clockText(d);
}

// The strip's line, without the account (the view adds it): "Approaching weekly usage limit · 84% · resets Thu, Nov
// 19, 1:00 AM", with the 5-hour window past too "… · 5-hour 92%", and for that window alone "Approaching 5-hour usage
// limit · 92% · resets 2:30 PM". The strip is English like the rest of Chat's chrome, whatever language the
// conversation is in.
export function stripText(s: LimitStripData): string {
    const parts = [
        s.window === "week" ? "Approaching weekly usage limit" : "Approaching 5-hour usage limit",
        `${Math.round(s.pct)}%`,
    ];
    if (s.reset != null) {
        parts.push(`resets ${resetText(s.reset, s.window)}`);
    }
    if (s.also != null) {
        parts.push(`5-hour ${Math.round(s.also.pct)}%`);
    }
    return parts.join(" · ");
}

// The account to offer the switch to: of the choices other than the agent's own (by quota key), the one with the
// lowest reading on the window that triggered the strip, ties keeping the order of `choices`. One at or past that
// window's threshold is skipped. An account with no saved reading of the window is offered only when no other account
// has one. null with no other account, or none that qualifies.
export function switchTarget(args: {
    choices: AccountChoice[];
    ownKey: string;
    keyOf: (c: AccountChoice) => string;
    saved: Record<string, SavedSnapshot>;
    window: LimitWindow;
    now: number;
}): AccountChoice | null {
    const { choices, ownKey, keyOf, saved, window, now } = args;
    const read: { choice: AccountChoice; pct: number | undefined }[] = [];
    for (const choice of choices) {
        const key = keyOf(choice);
        if (key === ownKey) {
            continue;
        }
        const snapshot = saved[key];
        read.push({ choice, pct: snapshot == null ? undefined : savedWindows(snapshot, now)[window].pct });
    }
    const known = read.filter((r) => r.pct != null);
    if (known.length === 0) {
        return read[0]?.choice ?? null;
    }
    let best: { choice: AccountChoice; pct: number } | null = null;
    for (const r of known) {
        const pct = r.pct as number;
        if (pct < warnPct(window) && (best == null || pct < best.pct)) {
            best = { choice: r.choice, pct };
        }
    }
    return best?.choice ?? null;
}

export type SnoozeChoice = "1h" | "4h" | "tomorrow";

const HOUR_MS = 3_600_000;

// When a snooze picked at `now` ends: an hour, four hours, or the next local 8:00 AM (the start of a working day;
// the next day's when today's has passed).
export function nextSnooze(choice: SnoozeChoice, now: number): number {
    if (choice === "1h") {
        return now + HOUR_MS;
    }
    if (choice === "4h") {
        return now + 4 * HOUR_MS;
    }
    const d = new Date(now);
    d.setHours(8, 0, 0, 0);
    if (d.getTime() <= now) {
        d.setDate(d.getDate() + 1);
    }
    return d.getTime();
}

// The snoozes as kept in localStorage: quota key → { until } (epoch ms).
export type SnoozeMap = Record<string, { until: number }>;

// The saved map, with an entry that is not `{ until: <number> }` dropped; anything unreadable is no snoozes at all.
export function parseSnoozes(raw: string | null | undefined): SnoozeMap {
    if (!raw) {
        return {};
    }
    try {
        const parsed: unknown = JSON.parse(raw);
        if (parsed == null || typeof parsed !== "object" || Array.isArray(parsed)) {
            return {};
        }
        const out: SnoozeMap = {};
        for (const [key, v] of Object.entries(parsed)) {
            const until = (v as { until?: unknown } | null)?.until;
            if (typeof until === "number" && Number.isFinite(until)) {
                out[key] = { until };
            }
        }
        return out;
    } catch {
        return {};
    }
}

// The snoozes still running at `now`: one that ran out hides nothing, so it is not kept.
export function pruneSnoozes(map: SnoozeMap, now: number): SnoozeMap {
    const out: SnoozeMap = {};
    for (const [key, s] of Object.entries(map)) {
        if (s.until > now) {
            out[key] = s;
        }
    }
    return out;
}

// What an agent reads on its account: its live windows where it carries them, else the account's saved snapshot (which
// counts a window that has rolled over as 0). The same live-over-saved merge as the Usage donuts.
export function agentReading(
    usage: AgentUsage | undefined,
    saved: SavedSnapshot | undefined,
    now: number
): LimitReading {
    const fromSaved = saved == null ? undefined : savedWindows(saved, now);
    return {
        week: usage?.weekpct != null ? { pct: usage.weekpct, reset: usage.weekreset } : (fromSaved?.week ?? {}),
        fivehour:
            usage?.fivehourpct != null
                ? { pct: usage.fivehourpct, reset: usage.fivehourreset }
                : (fromSaved?.fivehour ?? {}),
    };
}

// The Claude account an agent runs on ("" for Default): the one its usage report names; an agent that has reported
// with no `account` is on Default (not "unknown"); one that has not reported yet, the one its block was launched on
// (`agent:claudeaccount`, "login" meaning Default); else the active account, which a plain launch follows.
export function agentAccountId(
    usage: AgentUsage | null | undefined,
    blockMeta: { [key: string]: unknown } | null | undefined,
    activeId: string
): string {
    if (usage != null) {
        return usage.account ?? "";
    }
    const pick = blockMeta?.[CLAUDE_ACCOUNT_META];
    if (typeof pick === "string" && pick !== "") {
        return pick === DEFAULT_ACCOUNT_PICK ? "" : pick;
    }
    return activeId;
}
