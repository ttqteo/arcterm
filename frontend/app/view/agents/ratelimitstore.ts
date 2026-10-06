// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Persists the last-known account-level rate-limit windows (5-hour + weekly) per provider so the
// Usage surface donuts survive when no agent is running. Live AgentUsage only exists while a Claude
// agent is active; this saves a snapshot whenever one reports, seeds from localStorage at load, and
// merges live-over-saved (with per-window rollover) for the surface. The claude snapshot is also fed
// with no agent running, from the account's quota read (claudequota.ts), so it is known before one runs.
// See docs/superpowers/specs/2026-06-26-ratelimit-donut-persistence-design.md.

import { atom, type PrimitiveAtom } from "jotai";
import { globalStore } from "@/app/store/jotaiStore";

const STORAGE_KEY = "wave:ratelimits";
const PROVIDER_RANK: Record<string, number> = { claude: 0, codex: 1 };

export interface SavedSnapshot {
    fivehourpct?: number;
    fivehourreset?: number; // absolute epoch seconds (matches AgentUsage)
    weekpct?: number;
    weekreset?: number;
    capturedAt: number; // epoch ms at record time
}

export interface DonutWindow {
    pct?: number;
    reset?: number;
}

export interface ProviderDonuts {
    provider: string;
    fivehour: DonutWindow;
    week: DonutWindow;
    stale?: { capturedAt: number }; // present iff sourced from a saved (not-live) snapshot
}

// Best-effort read; any failure (no localStorage, parse error) -> {}.
export function readSavedRateLimits(): Record<string, SavedSnapshot> {
    try {
        const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
        if (!raw) {
            return {};
        }
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === "object" ? (parsed as Record<string, SavedSnapshot>) : {};
    } catch {
        return {};
    }
}

// Seeded from localStorage at module load so donuts render on a fresh launch with no agent.
export const savedRateLimitsAtom = atom<Record<string, SavedSnapshot>>(
    readSavedRateLimits()
) as PrimitiveAtom<Record<string, SavedSnapshot>>;

// Save a snapshot for `provider` — only when the usage carries a 5h or weekly window field.
// Window fields + capturedAt only; context/cost are per-session and deliberately dropped.
// `capturedAt` is when the reading is as of (now, for an agent's report); a newer snapshot already
// saved wins over an older reading.
export function recordRateLimit(provider: string, usage: AgentUsage, capturedAt = Date.now()): void {
    if (usage == null || (usage.fivehourpct == null && usage.weekpct == null)) {
        return;
    }
    const saved = globalStore.get(savedRateLimitsAtom);
    if ((saved[provider]?.capturedAt ?? 0) > capturedAt) {
        return;
    }
    const snapshot: SavedSnapshot = {
        fivehourpct: usage.fivehourpct,
        fivehourreset: usage.fivehourreset,
        weekpct: usage.weekpct,
        weekreset: usage.weekreset,
        capturedAt,
    };
    const next = { ...saved, [provider]: snapshot };
    globalStore.set(savedRateLimitsAtom, next);
    try {
        globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
        // quota/disabled — the in-memory atom still serves this session
    }
}

const FIVE_HOUR_MS = 5 * 60 * 60 * 1000;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

// Two ways a saved window stops being current, and the second is not redundant: the reset timestamp
// catches the ordinary rollover, but it cannot catch a reset that is itself wrong. A codex snapshot
// once carried a "five-hour" reset almost six days out, so it never rolled and spoke for the account at
// 100% for days. A capture older than the window it describes has rolled at least once regardless.
function windowFromSaved(
    pct: number | undefined,
    reset: number | undefined,
    capturedAt: number,
    windowMs: number,
    now: number
): DonutWindow {
    const resetPassed = reset != null && reset * 1000 <= now;
    const outlivedItsWindow = now - capturedAt >= windowMs;
    if (resetPassed || outlivedItsWindow) {
        return { pct: 0, reset: undefined }; // rolled over; the new cadence is unknowable
    }
    return { pct, reset };
}

// Live wins (no stale); else build from the saved snapshot with per-window rollover. Union of live
// + saved provider keys, claude-first.
export function mergeRateLimitWindows(
    live: { provider: string; usage: AgentUsage }[],
    saved: Record<string, SavedSnapshot>,
    now: number
): ProviderDonuts[] {
    const liveMap = new Map(live.map((l) => [l.provider, l.usage]));
    const providers = [...new Set([...liveMap.keys(), ...Object.keys(saved)])];
    return providers
        .map((provider) => {
            const u = liveMap.get(provider);
            if (u != null) {
                return {
                    provider,
                    fivehour: { pct: u.fivehourpct, reset: u.fivehourreset },
                    week: { pct: u.weekpct, reset: u.weekreset },
                };
            }
            const s = saved[provider];
            return {
                provider,
                fivehour: windowFromSaved(s.fivehourpct, s.fivehourreset, s.capturedAt, FIVE_HOUR_MS, now),
                week: windowFromSaved(s.weekpct, s.weekreset, s.capturedAt, WEEK_MS, now),
                stale: { capturedAt: s.capturedAt },
            };
        })
        .sort((a, b) => (PROVIDER_RANK[a.provider] ?? 99) - (PROVIDER_RANK[b.provider] ?? 99));
}

// Pure: the single most-utilized provider by 5-hour pct across the merged donuts, or undefined if none
// report a 5-hour window. Drives the Jarvis pet's provider reading off the SAME data as the Usage tab
// (persisted + per-provider) and can label which provider it's showing when both Claude and Codex exist.
// A reading nobody is producing right now must never outrank a live one — a stale snapshot pinned high
// would otherwise speak for the whole account, and its countdown with it. Stale still answers when
// nothing is live, which is the entire point of persisting it.
export function topProviderUsage(donuts: ProviderDonuts[]): { provider: string; pct: number } | undefined {
    return highestFiveHour(donuts.filter((d) => d.stale == null)) ?? highestFiveHour(donuts);
}

function highestFiveHour(donuts: ProviderDonuts[]): { provider: string; pct: number } | undefined {
    let top: { provider: string; pct: number } | undefined;
    for (const d of donuts) {
        const pct = d.fivehour.pct;
        if (pct == null) {
            continue;
        }
        if (top == null || pct > top.pct) {
            top = { provider: d.provider, pct };
        }
    }
    return top;
}
