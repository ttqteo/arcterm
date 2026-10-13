// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// "Don't fold for", on the folded Sprout's hover card (sprout-mini.tsx): window:autosproutpauseuntil holds the fold that
// follows you out of the app (window:autosprout, floatstore.ts) off until a time. The card offers an hour, the next
// 8:00, or a typed time: a length ("2h", "30m", "1h30") or a clock time ("14:30", "8pm"), the next one to come. Pure:
// the card writes the setting.

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
// a typed pause longer than this is a slip, not a plan
const MAX_PAUSE_MS = 7 * 24 * HOUR_MS;
// the morning the card's second chip waits for
export const MORNING_HOUR = 8;
export const HOUR_PAUSE_MS = HOUR_MS;

/** Whether window:autosproutpauseuntil holds the auto fold off at `now`: unset, 0 or past is no pause. */
export function foldPaused(raw: unknown, now: number): raw is number {
    return typeof raw === "number" && raw > now;
}

/** The next time the clock reads hour:minute after `now`: today if it is still ahead, else tomorrow. */
export function nextClock(hour: number, minute: number, now: number): number {
    const d = new Date(now);
    d.setHours(hour, minute, 0, 0);
    if (d.getTime() <= now) {
        d.setDate(d.getDate() + 1);
    }
    return d.getTime();
}

/** The next 8:00 after `now`: tomorrow's from the evening, this morning's before it. */
export function nextMorning(now: number): number {
    return nextClock(MORNING_HOUR, 0, now);
}

/** The time a typed pause ends, or null for text that is no length or clock time. "2h", "30m", "1h30", "1.5h" are
 *  lengths; "14:30", "8:05", "8pm", "8:30am" are clock times. A bare "8" is 8:00, since a length needs its unit. */
export function parsePauseText(text: string, now: number): number | null {
    const t = text.trim().toLowerCase().replace(/\s+/g, "");
    if (t === "") {
        return null;
    }
    const length = lengthMs(t);
    if (length != null) {
        return length > 0 && length <= MAX_PAUSE_MS ? now + length : null;
    }
    const clock = /^(\d{1,2})(?::(\d{2}))?(am|pm)?$/.exec(t);
    if (clock == null) {
        return null;
    }
    let hour = Number(clock[1]);
    const minute = clock[2] != null ? Number(clock[2]) : 0;
    const half = clock[3];
    if (minute > 59) {
        return null;
    }
    if (half != null) {
        if (hour < 1 || hour > 12) {
            return null;
        }
        hour = (hour % 12) + (half === "pm" ? 12 : 0);
    } else if (hour > 23) {
        return null;
    }
    return nextClock(hour, minute, now);
}

function lengthMs(t: string): number | null {
    const hours = /^(\d+(?:\.\d+)?)h(?:(\d+)(?:m|min)?)?$/.exec(t);
    if (hours != null) {
        return Number(hours[1]) * HOUR_MS + (hours[2] != null ? Number(hours[2]) * MINUTE_MS : 0);
    }
    const minutes = /^(\d+)(?:m|min)$/.exec(t);
    return minutes != null ? Number(minutes[1]) * MINUTE_MS : null;
}

function clockText(d: Date): string {
    return `${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** When a pause ends, as the card says it: "14:30" today, "8:00 tomorrow", else the weekday ("Fri 8:00"). */
export function pauseEndLabel(until: number, now: number): string {
    const end = new Date(until);
    const day = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    const days = Math.round((day(end) - day(new Date(now))) / (24 * HOUR_MS));
    if (days <= 0) {
        return clockText(end);
    }
    if (days === 1) {
        return `${clockText(end)} tomorrow`;
    }
    return `${end.toLocaleDateString("en-US", { weekday: "short" })} ${clockText(end)}`;
}
