// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Persists the last-known account-level rate-limit windows (5-hour + weekly) per provider so the
// Usage surface donuts survive when no agent is running. Live AgentUsage only exists while a Claude
// agent is active; this saves a snapshot whenever one reports, seeds from localStorage at load, and
// merges live-over-saved (with per-window rollover) for the surface. The claude snapshot is also fed
// with no agent running, from the account's quota read (claudequota.ts), so it is known before one runs.
// See docs/superpowers/specs/2026-06-26-ratelimit-donut-persistence-design.md.
//
// Claude windows belong to a Claude account, so claude snapshots are kept per account ("claude:<id>",
// "claude:default" for the /login one) and readers see only the active account's, projected back to
// "claude". Other providers keep their bare key. See 2026-10-07-claude-account-switch-design.md.

import { getSettingsKeyAtom } from "@/app/store/global";
import { globalStore } from "@/app/store/jotaiStore";
import { atom, type PrimitiveAtom } from "jotai";
import { liveWindowAgents, providerPlanUsage, type AgentVM } from "./agentsviewmodel";

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

// The saved key for a provider's windows: claude's are per account, every other provider's are not.
export function rateLimitKey(provider: string, account?: string): string {
    return provider === "claude" ? `claude:${account || "default"}` : provider;
}

// A snapshot saved before accounts existed is the Default account's; one already saved under
// claude:default is newer than the switch to per-account keys, so it wins.
export function migrateSaved(saved: Record<string, SavedSnapshot>): Record<string, SavedSnapshot> {
    if (saved.claude == null) {
        return saved;
    }
    const { claude, ...rest } = saved;
    return rest["claude:default"] != null ? rest : { ...rest, "claude:default": claude };
}

// What readers see: the active account's claude snapshot as "claude", other accounts' dropped.
export function projectActiveAccount(
    saved: Record<string, SavedSnapshot>,
    active: string
): Record<string, SavedSnapshot> {
    const activeKey = rateLimitKey("claude", active);
    const out: Record<string, SavedSnapshot> = {};
    for (const [key, snapshot] of Object.entries(saved)) {
        if (key === activeKey) {
            out.claude = snapshot;
        } else if (!key.startsWith("claude:")) {
            out[key] = snapshot;
        }
    }
    return out;
}

// The Claude account wavesrv runs new sessions on; "" is Default.
export const activeClaudeAccountAtom = atom((get) => (get(getSettingsKeyAtom("claude:activeaccount")) as string) || "");

// Best-effort read; any failure (no localStorage, parse error) -> {}.
export function readSavedRateLimits(): Record<string, SavedSnapshot> {
    try {
        const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
        if (!raw) {
            return {};
        }
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === "object" ? migrateSaved(parsed as Record<string, SavedSnapshot>) : {};
    } catch {
        return {};
    }
}

// Seeded from localStorage at module load so donuts render on a fresh launch with no agent.
export const savedRateLimitsAtom = atom<Record<string, SavedSnapshot>>(
    readSavedRateLimits()
) as PrimitiveAtom<Record<string, SavedSnapshot>>;

// Save a snapshot under `provider` (a rateLimitKey) — only when the usage carries a 5h or weekly window field.
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

export const FIVE_HOUR_MS = 5 * 60 * 60 * 1000;
export const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

// Two ways a saved window stops being current, and the second is not redundant: the reset timestamp
// catches the ordinary rollover, but it cannot catch a reset that is itself wrong. A codex snapshot
// once carried a "five-hour" reset almost six days out, so it never rolled and spoke for the account at
// 100% for days. A capture older than the window it describes has rolled at least once regardless.
export function windowFromSaved(
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

// The plan-usage donuts for the active Claude account: claude agents on another account and other
// accounts' snapshots are left out. Every other provider is unaffected.
export function planDonuts(
    agents: AgentVM[],
    saved: Record<string, SavedSnapshot>,
    active: string,
    now: number
): ProviderDonuts[] {
    const live = liveWindowAgents(agents).filter(
        (a) => (a.agent || "claude") !== "claude" || (a.usage?.account || "") === active
    );
    return mergeRateLimitWindows(providerPlanUsage(live), projectActiveAccount(saved, active), now);
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
