// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Pure glue for the cockpit's plan-usage meters (UsageMeters). Extracted so the provider gating and
// meter visibility are unit-testable without rendering.

import { formatReset, formatTokens } from "./agentsviewmodel";
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
