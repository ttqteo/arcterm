// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// What the Telegram row under Settings → General → Notifications says: the one line that follows from the
// bot's status (TelegramStatusCommand), plus the schedule the "when" controls edit. Pure, so every state is a unit
// test; telegramrow.tsx only draws it. The schedule format mirrors pkg/telebot/allowed.go.

export type TelegramView =
    | { kind: "no-token" }
    | { kind: "off" }
    | { kind: "error"; text: string }
    | { kind: "checking" }
    | { kind: "pairing"; code: string; minutesLeft: number; bot: string }
    | { kind: "unpaired"; bot: string }
    | { kind: "asleep"; chat: string; bot: string; nextAllowed: number }
    | { kind: "connected"; chat: string; bot: string; open: number }
    | { kind: "idle"; chat: string; bot: string };

// `now` is UnixMilli, like paircodeexpires. No status yet reads as no token: the server answers an empty
// status before the bot exists, and the row draws no status line until its first poll lands. allowed and
// connected are omitted from the status while false.
export function telegramView(s: TelegramStatusData | null, now: number): TelegramView {
    if (s == null || !s.hastoken) {
        return { kind: "no-token" };
    }
    if (!s.enabled) {
        return { kind: "off" };
    }
    if (s.lasterror) {
        return { kind: "error", text: s.lasterror };
    }
    const bot = s.botname ?? "";
    if (bot === "") {
        // the one getMe a new token or a switch-on makes has not answered
        return { kind: "checking" };
    }
    const expires = s.paircodeexpires ?? 0;
    if (s.paircode && expires > now) {
        return {
            kind: "pairing",
            code: s.paircode,
            minutesLeft: Math.max(1, Math.ceil((expires - now) / 60_000)),
            bot,
        };
    }
    const chat = s.chatname ?? "";
    if (chat === "") {
        return { kind: "unpaired", bot };
    }
    if (!(s.allowed ?? false)) {
        return { kind: "asleep", chat, bot, nextAllowed: s.nextallowed ?? 0 };
    }
    if (s.connected ?? false) {
        return { kind: "connected", chat, bot, open: s.open ?? 0 };
    }
    return { kind: "idle", chat, bot };
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const pad2 = (n: number) => String(n).padStart(2, "0");
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

// A moment as the row says it, in local time: `15:40` today, `Mon 08:00` within the next week, else the date
// (`Oct 23 08:00`). Both are UnixMilli.
export function formatWhen(ms: number, now: number): string {
    const d = new Date(ms);
    const clock = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
    const days = Math.round((startOfDay(d) - startOfDay(new Date(now))) / 86_400_000);
    if (days === 0) {
        return clock;
    }
    if (days > 0 && days < 7) {
        return `${WEEKDAYS[d.getDay()]} ${clock}`;
    }
    return `${MONTHS[d.getMonth()]} ${d.getDate()} ${clock}`;
}

// ---- "on for" ----

export const ON_FOR_MIN_HOURS = 0.25;
export const ON_FOR_MAX_HOURS = 24;

// The hours typed into the custom field; null when it is not a number inside 0.25–24.
export function parseOnForHours(text: string): number | null {
    const t = text.trim();
    if (t === "") {
        return null;
    }
    const h = Number(t);
    return Number.isFinite(h) && h >= ON_FOR_MIN_HOURS && h <= ON_FOR_MAX_HOURS ? h : null;
}

// telegram:onuntil for "on for <hours>": whole milliseconds, because the setting is an integer.
export function onUntilFor(hours: number, now: number): number {
    return Math.round(now + hours * 3_600_000);
}

// ---- the schedule ----

export const DAY_IDS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
export type DayId = (typeof DAY_IDS)[number];

// The days a window starts on, in mon…sun order, and its from / to as `HH:MM`.
export type TelegramSchedule = { days: DayId[]; from: string; to: string };

// The schedule an unset telegram:schedule reads as (Go: telebot.OfficeHours).
export const OFFICE_HOURS = "mon,tue,wed,thu,fri 08:00-17:30";

// "HH:MM" as minutes after midnight, or null when it is not a clock time.
function clockMinutes(s: string): number | null {
    const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim());
    if (m == null) {
        return null;
    }
    const h = Number(m[1]);
    const min = Number(m[2]);
    return h <= 23 && min <= 59 ? h * 60 + min : null;
}

// `<days> <HH:MM>-<HH:MM>`, the days a comma list of mon…sun in any case; "" reads as office hours. Null for a
// string the Go side rejects (it then reads the setting as office hours, see scheduleOrOffice).
export function parseSchedule(s: string): TelegramSchedule | null {
    let text = s.trim();
    if (text === "") {
        text = OFFICE_HOURS;
    }
    const sep = text.search(/[ \t][^ \t]*$/);
    if (sep < 0) {
        return null;
    }
    const picked = new Set<string>();
    for (const name of text.slice(0, sep).split(",")) {
        const day = DAY_IDS.find((d) => d === name.trim().toLowerCase());
        if (day == null) {
            return null;
        }
        picked.add(day);
    }
    const [from, to, ...rest] = text.slice(sep + 1).split("-");
    if (from === undefined || to === undefined || rest.length > 0) {
        return null;
    }
    const start = clockMinutes(from);
    const end = clockMinutes(to);
    if (start == null || end == null) {
        return null;
    }
    return { days: DAY_IDS.filter((d) => picked.has(d)), from: formatClock(start), to: formatClock(end) };
}

function formatClock(minutes: number): string {
    return `${pad2(Math.floor(minutes / 60))}:${pad2(minutes % 60)}`;
}

// The schedule the way parseSchedule reads it, the days in mon…sun order. The row never writes one with no day
// (toggleDay keeps the last), since "" days would not parse and the bot would fall back to office hours.
export function formatSchedule(s: TelegramSchedule): string {
    return `${DAY_IDS.filter((d) => s.days.includes(d)).join(",")} ${s.from}-${s.to}`;
}

// What the row shows for the stored telegram:schedule: the schedule itself, or office hours when it is unset or
// does not parse, as the bot reads it.
export function scheduleOrOffice(stored: string): TelegramSchedule {
    return parseSchedule(stored) ?? { days: ["mon", "tue", "wed", "thu", "fri"], from: "08:00", to: "17:30" };
}

// The schedule with `day` pressed or unpressed. The last pressed day stays: a schedule needs one.
export function toggleDay(s: TelegramSchedule, day: DayId): TelegramSchedule {
    if (!s.days.includes(day)) {
        return { ...s, days: DAY_IDS.filter((d) => d === day || s.days.includes(d)) };
    }
    return s.days.length === 1 ? s : { ...s, days: s.days.filter((d) => d !== day) };
}

// A window whose end is not after its start runs into the next day.
export function runsPastMidnight(s: TelegramSchedule): boolean {
    const from = clockMinutes(s.from);
    const to = clockMinutes(s.to);
    return from != null && to != null && to <= from;
}
