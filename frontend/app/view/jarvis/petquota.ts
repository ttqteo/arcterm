// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The quota as the creature reads it. Pure, like petcondition.ts: which window is the tightest (the tired face),
// and when a window crosses a mark worth a bubble. A condition never speaks on its own (petvoice.ts speaks
// events), so a window running out changed only the creature's gait and went unnoticed; the crossing is the
// event, the tired face is the level, which is the design's "report each thing once" (§3).

import type { ProviderDonuts } from "../agents/ratelimitstore";
import { conditionLine, type QuotaWindow } from "./petcondition";
import type { PetEvent } from "./petvoice";

export interface QuotaReading {
    provider: string;
    window: QuotaWindow;
    pct: number;
    resetAt?: number; // epoch seconds, like the donuts
}

function readingsOf(d: ProviderDonuts): QuotaReading[] {
    const out: QuotaReading[] = [];
    if (d.fivehour.pct != null) {
        out.push({ provider: d.provider, window: "5h", pct: d.fivehour.pct, resetAt: d.fivehour.reset });
    }
    if (d.week.pct != null) {
        out.push({ provider: d.provider, window: "week", pct: d.week.pct, resetAt: d.week.reset });
    }
    return out;
}

function tightestOf(donuts: ProviderDonuts[]): QuotaReading | undefined {
    let top: QuotaReading | undefined;
    for (const r of donuts.flatMap(readingsOf)) {
        if (top == null || r.pct > top.pct) {
            top = r;
        }
    }
    return top;
}

// The tightest window across providers and both windows. A live reading wins over a saved snapshot, the same
// preference as topProviderUsage, so a stale 99% from last night does not tire a creature whose window reset.
export function tightestWindow(donuts: ProviderDonuts[]): QuotaReading | undefined {
    return tightestOf(donuts.filter((d) => d.stale == null)) ?? tightestOf(donuts);
}

// Every live window with a reading. A saved snapshot is never news, so it is never spoken.
export function quotaReadings(donuts: ProviderDonuts[]): QuotaReading[] {
    return donuts.filter((d) => d.stale == null).flatMap(readingsOf);
}

// 85 is where the cockpit's usage band turns red (usageLevel's "hot"); 100 is spent.
const MARKS = [100, 85] as const;
export type QuotaMark = (typeof MARKS)[number];

export interface QuotaCrossing {
    key: string;
    mark: QuotaMark;
    reading: QuotaReading;
    // lower marks of the same cycle that this one makes moot, to be recorded as said with it
    alsoSaid?: string[];
}

// A cycle is a window plus its reset time, so the same mark speaks again once the window resets. A window with
// no reset time has no cycle to tell apart, and speaks each mark once.
function markKey(r: QuotaReading, mark: QuotaMark): string {
    return `${r.provider}:${r.window}:${r.resetAt ?? "?"}:${mark}`;
}

function reached(pct: number, mark: QuotaMark): boolean {
    return mark === 100 ? pct >= 100 : pct > mark;
}

// The marks to speak now: per window, the highest one reached and not yet said. A window first seen already
// spent says it is spent, and its 85 mark goes with it rather than following it.
export function quotaCrossings(readings: QuotaReading[], said: ReadonlySet<string>): QuotaCrossing[] {
    const out: QuotaCrossing[] = [];
    for (const r of readings) {
        const top = MARKS.find((m) => reached(r.pct, m));
        if (top == null || said.has(markKey(r, top))) {
            continue;
        }
        const lower = MARKS.filter((m) => m < top).map((m) => markKey(r, m));
        out.push({ key: markKey(r, top), mark: top, reading: r, alsoSaid: lower.length > 0 ? lower : undefined });
    }
    return out;
}

export function quotaEvent(c: QuotaCrossing, nowMs: number): PetEvent {
    const r = c.reading;
    return {
        id: `quota:${c.key}`,
        at: nowMs,
        kind: "notify",
        level: c.mark === 100 ? "error" : "warn",
        text: conditionLine(
            { kind: "tired", provider: r.provider, window: r.window, pct: r.pct, resetAt: r.resetAt },
            nowMs
        ),
    };
}

// The said keys are persisted; a key outlives its cycle, so only the newest are kept.
export function pruneSaid(keys: string[], max: number): string[] {
    return keys.length > max ? keys.slice(keys.length - max) : keys;
}
