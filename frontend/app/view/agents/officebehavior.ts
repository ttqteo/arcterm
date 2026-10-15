// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// What the Cockpit office's people do on their own (cockpit office spec, "Personality, day and night, energy"): idle
// people past the Finished window go to the lounge, at most three walk at once, the office follows the work hours,
// and the 5-hour window sets how tired everyone is. Pure: no React and no clock; callers pass the time.

// the Cockpit's Finished window (IDLE_GRACE_MS): past it the grid parks an idle agent in the Idle section, and the
// office sends it to the lounge
export const COFFEE_AFTER_MS = 300_000;
export const SOFA_AFTER_MS = 600_000;
export const CHEER_MS = 1500;
export const STRETCH_MS = 1500;
export const MAX_WALKERS = 3;

export type Away = "coffee" | "sofa";
export type Energy = "fresh" | "yawny" | "tired";
export interface WorkHours {
    start: number;
    end: number;
}
export const DEFAULT_HOURS: WorkHours = { start: 9, end: 18 };

export interface BehaviorAgent {
    id: string;
    state: "asking" | "working" | "idle";
    idleSince?: number;
    finished: boolean;
}

/** FNV-1a over the id, so an agent keeps its look and its yawn offset. */
export function idHash(id: string): number {
    let h = 0x811c9dc5;
    for (let i = 0; i < id.length; i++) {
        h ^= id.charCodeAt(i);
        h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h;
}

/** Skin and hair, 1 to 4. */
export function lookOf(id: string): number {
    return (idHash(id) % 4) + 1;
}

/** Where an idle agent goes: the coffee machine past the Finished window, the sofa from ten minutes; none while
 * it is still in the window, at work, or of unknown age. */
export function awayTarget(a: BehaviorAgent, now: number): Away | undefined {
    if (a.state !== "idle" || a.finished || a.idleSince == null) {
        return undefined;
    }
    const idle = now - a.idleSince;
    return idle >= SOFA_AFTER_MS ? "sofa" : idle >= COFFEE_AFTER_MS ? "coffee" : undefined;
}

/** Of those waiting to walk, the ones that may start while `walking` already are: the longest idle first. */
export function admitWalkers(waiting: { id: string; idleSince?: number }[], walking: number): string[] {
    const room = Math.max(0, MAX_WALKERS - walking);
    return [...waiting]
        .sort((a, b) => (a.idleSince ?? 0) - (b.idleSince ?? 0) || a.id.localeCompare(b.id))
        .slice(0, room)
        .map((w) => w.id);
}

/** Outside work hours: before the start, from the end on, and all of Saturday and Sunday. */
export function afterHours(d: Date, h: WorkHours): boolean {
    const day = d.getDay();
    if (day === 0 || day === 6) {
        return true;
    }
    const hour = d.getHours();
    return hour < h.start || hour >= h.end;
}

/** Hours read back from storage: whole hours 0 to 23 with the start before the end, else 9 to 18. */
export function sanitizeHours(v: unknown): WorkHours {
    const o = (typeof v === "object" && v != null ? v : {}) as Record<string, unknown>;
    const ok = (n: unknown): n is number => Number.isInteger(n) && (n as number) >= 0 && (n as number) <= 23;
    return ok(o.start) && ok(o.end) && o.start < o.end ? { start: o.start, end: o.end } : DEFAULT_HOURS;
}

/** The 5-hour window's use as tiredness: under 70 % fresh, 70 to 90 yawny, 90 and over tired; unknown is fresh. */
export function energyOf(pct: number | undefined): Energy {
    if (pct == null || Number.isNaN(pct)) {
        return "fresh";
    }
    return pct >= 90 ? "tired" : pct >= 70 ? "yawny" : "fresh";
}

/** Whether a working person yawns on this tick: one frame in eight when yawny, one in four when tired. */
export function yawnsNow(id: string, tick: number, e: Energy): boolean {
    if (e === "fresh") {
        return false;
    }
    return (idHash(id) + tick) % (e === "tired" ? 4 : 8) === 0;
}

/** The 5-hour window reset: from 70 % or more to under 20 %. */
export function isReset(prev: number | undefined, next: number | undefined): boolean {
    return prev != null && next != null && prev >= 70 && next < 20;
}

/** An age for a label: minutes under an hour, else hours. */
export function shortAge(ms: number): string {
    const m = Math.max(1, Math.floor(ms / 60_000));
    return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h`;
}
