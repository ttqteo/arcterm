// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Pure glue for the cockpit's plan-usage meters (UsageMeters). Extracted so the provider gating and
// meter visibility are unit-testable without rendering.

import { formatReset, formatTokens, usageLevel } from "./agentsviewmodel";
import type { WindowTokens } from "./windowtokenstore";

// provider identity for the plan strip. not theme tokens — brand colors, single source.
const PROVIDER_DOT: Record<string, string> = {
    claude: "bg-provider-claude",
    codex: "bg-provider-codex",
    opencode: "bg-provider-opencode",
    pi: "bg-provider-pi",
    agy: "bg-provider-agy",
};
const PROVIDER_LABEL: Record<string, string> = {
    claude: "Claude",
    codex: "Codex",
    opencode: "OpenCode",
    pi: "Pi",
    agy: "Antigravity",
};

export function providerLabel(provider: string): string {
    return PROVIDER_LABEL[provider] ?? provider;
}

export function providerDot(provider: string): string {
    return PROVIDER_DOT[provider] ?? "bg-muted";
}

// real used-token sum is claude-only (windowtokenstore); other providers report no token line.
export function windowUsedTokens(
    provider: string,
    windowTokens: WindowTokens | null,
    window: "fivehour" | "week"
): number | undefined {
    return provider === "claude" ? windowTokens?.[window] : undefined;
}

// a null pct (api-key auth or a window not yet reported) renders no bar. a saved snapshot at 0% is
// almost always a window that rolled over while nothing ran that provider — no data, not a reading.
export function usageBarVisible(pct: number | undefined, stale: boolean): boolean {
    return pct != null && !(stale && pct === 0);
}

/** Pure: a meter's hover text, the detail the compact meter leaves out. */
export function meterTitle(
    label: string,
    pct: number,
    used: number | undefined,
    reset: number | undefined,
    now: number
): string {
    return [
        `${label} · ${Math.round(pct)}%`,
        used != null ? `${formatTokens(used)} tok` : "",
        reset ? `resets ${formatReset(reset, now)}` : "",
    ]
        .filter(Boolean)
        .join(" · ");
}

/** Pure: the share of a window already passed (0..1), from its reset (epoch seconds) and its length; undefined
 *  while the reset is unknown. */
export function windowElapsed(reset: number | undefined, windowMs: number, now: number): number | undefined {
    if (!reset) {
        return undefined;
    }
    const left = reset * 1000 - now;
    return Math.min(1, Math.max(0, 1 - left / windowMs));
}

// before this share of a window has passed, a projection is noise: 3% used five minutes in reads as 180%
const PACE_MIN_ELAPSED = 0.15;

/** Pure: a meter's level by pace rather than by use alone: amber when this rate runs out before the reset, red
 *  past 90% or at 1.5x the pace. 72% used with 20 minutes left is fine; 50% used with 3 of 5 hours left is not.
 *  Early in a window, or with the reset unknown, it falls back to usageLevel. */
export function paceLevel(pct: number, elapsed: number | undefined): "ok" | "warn" | "hot" {
    if (elapsed == null || elapsed < PACE_MIN_ELAPSED) {
        return usageLevel(pct);
    }
    const projected = pct / elapsed;
    if (pct >= 90 || projected >= 150) {
        return "hot";
    }
    return projected > 100 ? "warn" : "ok";
}

/** Pure: formatReset for the app bar, where every pixel counts: "1h55", "3h", "42m", "3d4h". */
export function formatResetShort(resetSec: number, now: number): string {
    return formatReset(resetSec, now)
        .replace(/ 0[mh]$/, "")
        .replace(" ", "")
        .replace(/(h\d+)m$/, "$1");
}
