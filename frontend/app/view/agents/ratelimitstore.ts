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
// Claude windows belong to a Claude account, so claude snapshots are kept per real account and readers
// see only the active account's, projected back to "claude". The key is the account's email when it is
// known ("claude:<email>"), else the arcterm account id ("claude:<id>"), else "claude:default" for a
// /login account whose email is not known yet: keyed by arcterm id alone, Default's snapshot changed
// owner every time /login did. Other providers keep their bare key.
// See 2026-10-07-claude-account-switch-design.md (decisions 6 and 8).

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

// What arcterm knows of who the Claude accounts are: the /login account's email, and each token account
// with the email it was tied to (if any).
export interface ClaudeIdentity {
    loginEmail: string;
    accounts: { id: string; label: string; email?: string }[];
}

const NO_IDENTITY: ClaudeIdentity = { loginEmail: "", accounts: [] };

export function normalizeEmail(email: string | undefined | null): string {
    return (email ?? "").trim().toLowerCase();
}

// The identity as wavesrv lists it.
export function identityFromList(list: CommandClaudeAccountListRtnData | null | undefined): ClaudeIdentity {
    return {
        loginEmail: normalizeEmail(list?.loginemail),
        accounts: (list?.accounts ?? []).map((a) => ({
            id: a.id,
            label: a.label,
            email: normalizeEmail(a.email) || undefined,
        })),
    };
}

// The saved key of a Claude account's snapshot. `accountId` is the arcterm account an agent runs on, or
// "" / undefined for Default (the /login account). A token account tied to the email of the /login
// account (or of any other) shares that account's key, so the two are one account to every reader.
// `sessionLoginEmail` is a session's own answer to "which /login account": the one its process started
// on, which differs from the current one once /login has moved (decision 9). It applies to Default only.
export function claudeQuotaKey(
    accountId: string | undefined,
    identity: ClaudeIdentity,
    sessionLoginEmail?: string
): string {
    if (!accountId) {
        const email = normalizeEmail(sessionLoginEmail) || normalizeEmail(identity.loginEmail);
        return email ? `claude:${email}` : "claude:default";
    }
    const email = normalizeEmail(identity.accounts.find((a) => a.id === accountId)?.email);
    return email ? `claude:${email}` : `claude:${accountId}`;
}

// The key of the snapshot an agent's usage belongs to: its arcterm account (`usage.account`), and for a
// Default one the /login email its session started with (the block's `agent:loginemail`).
export function agentQuotaKey(
    account: string | undefined,
    sessionLoginEmail: string | undefined,
    identity: ClaudeIdentity
): string {
    return claudeQuotaKey(account, identity, sessionLoginEmail);
}

// The /login email a claude session started on, as `wsh agent-hook` stamped it on the agent's block at
// SessionStart; "" when the block is not loaded, was never stamped, or belongs to a token session.
export function blockLoginEmail(block: Block | null | undefined): string {
    const email = block?.meta?.["agent:loginemail"];
    return typeof email === "string" ? normalizeEmail(email) : "";
}

// The saved key for a provider's windows: claude's are per account, every other provider's are not.
export function rateLimitKey(
    provider: string,
    account: string | undefined,
    identity: ClaudeIdentity,
    sessionLoginEmail?: string
): string {
    return provider === "claude" ? agentQuotaKey(account, sessionLoginEmail, identity) : provider;
}

// Once the /login account's email is known, the snapshot saved as "claude:default" is that account's: it
// moves to its email key, unless a newer snapshot already sits there. Returns `saved` itself when there
// is nothing to move.
export function adoptDefaultSnapshot(
    saved: Record<string, SavedSnapshot>,
    loginEmail: string
): Record<string, SavedSnapshot> {
    const email = normalizeEmail(loginEmail);
    const fromDefault = saved["claude:default"];
    if (!email || fromDefault == null) {
        return saved;
    }
    const { "claude:default": _gone, ...rest } = saved;
    const key = `claude:${email}`;
    const existing = rest[key];
    return existing != null && existing.capturedAt >= fromDefault.capturedAt ? rest : { ...rest, [key]: fromDefault };
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
// `activeKey` is the active account's claudeQuotaKey.
export function projectActiveAccount(
    saved: Record<string, SavedSnapshot>,
    activeKey: string
): Record<string, SavedSnapshot> {
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

// Who the accounts are, as wavesrv last said (claudeidentity.ts refreshes it).
export const claudeIdentityAtom = atom<ClaudeIdentity>(NO_IDENTITY) as PrimitiveAtom<ClaudeIdentity>;

// The saved key of the active account's snapshot.
export const activeClaudeKeyAtom = atom((get) => claudeQuotaKey(get(activeClaudeAccountAtom), get(claudeIdentityAtom)));

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
    persistSaved({ ...saved, [provider]: snapshot });
}

function persistSaved(next: Record<string, SavedSnapshot>): void {
    globalStore.set(savedRateLimitsAtom, next);
    try {
        globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
        // quota/disabled — the in-memory atom still serves this session
    }
}

// Take a new identity from wavesrv. Once it names the /login account, the "claude:default" snapshot
// saved before that was known moves to that account's key.
export function setClaudeIdentity(identity: ClaudeIdentity): void {
    globalStore.set(claudeIdentityAtom, identity);
    const saved = globalStore.get(savedRateLimitsAtom);
    const adopted = adoptDefaultSnapshot(saved, identity.loginEmail);
    if (adopted !== saved) {
        persistSaved(adopted);
    }
}

// A quota answer names the /login account it read: learn it when the identity does not know it yet.
export function noteLoginEmail(email: string | undefined): void {
    const loginEmail = normalizeEmail(email);
    const current = globalStore.get(claudeIdentityAtom);
    if (loginEmail && loginEmail !== current.loginEmail) {
        setClaudeIdentity({ ...current, loginEmail });
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

// The plan-usage donuts for the active Claude account (`activeKey`, its claudeQuotaKey): claude agents
// on another account and other accounts' snapshots are left out. A token account and Default that name
// the same email are one account, and a Default agent counts by the /login email it started on, not the
// current one. Every other provider is unaffected.
export function planDonuts(
    agents: AgentVM[],
    saved: Record<string, SavedSnapshot>,
    activeKey: string,
    identity: ClaudeIdentity,
    now: number
): ProviderDonuts[] {
    const live = liveWindowAgents(agents).filter(
        (a) =>
            (a.agent || "claude") !== "claude" || agentQuotaKey(a.usage?.account, a.loginEmail, identity) === activeKey
    );
    return mergeRateLimitWindows(providerPlanUsage(live), projectActiveAccount(saved, activeKey), now);
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
