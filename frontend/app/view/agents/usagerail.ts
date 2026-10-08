// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Pure derivation for the Usage surface's provider tabs (handoff redesign:
// Wave-usage-redesign.dc.html artboard 1B, whose rail the tabs replaced). The rows are keyed on HARNESS ("claude" | "codex" | …),
// not on the upstream provider the historical buckets carry ("anthropic" | "openai"): quota windows
// are account-level per harness and the historical scope filter (usageHarnessFilterAtom) is per
// harness too, so the harness is the only key both halves of the surface share. Pure module — no
// React, no Wave runtime imports.

import { providerLabel } from "./cockpitrailmodel";
import type { DonutWindow, ProviderDonuts } from "./ratelimitstore";
import { fmt, type DailyUsage } from "./usagestats";

// "live" = a running agent is reporting now; "saved" = last snapshot from ratelimitstore; "none" =
// this harness has never reported a quota window (opencode/pi don't publish one at all).
export type RailState = "live" | "saved" | "none";

export interface UsageRailRow {
    harness: string;
    tokens: number;
    spendUsd: number;
    fivehour: DonutWindow;
    week: DonutWindow;
    state: RailState;
    capturedAt?: number; // epoch ms of the snapshot; only when state === "saved"
}

export interface UsageRailGroup {
    key: "reporting" | "quiet";
    label: string;
    rows: UsageRailRow[];
}

export interface AggregateWindow {
    pct?: number;
    reset?: number;
    harness?: string; // which harness supplied the reading
}

// Fold the window's daily series into per-harness totals. `daily` already carries tokens AND spend
// per harness for every day in the loaded window, so the rail needs no second pass over the raw
// buckets — and it stays in lockstep with the chart, which reads the same series.
export function harnessTotals(daily: DailyUsage[]): Record<string, { tokens: number; spendUsd: number }> {
    const out: Record<string, { tokens: number; spendUsd: number }> = {};
    for (const d of daily) {
        for (const [harness, v] of Object.entries(d.byHarness)) {
            const cur = out[harness] ?? { tokens: 0, spendUsd: 0 };
            cur.tokens += v.tokens;
            cur.spendUsd += v.spendUsd;
            out[harness] = cur;
        }
    }
    return out;
}

// One row per harness the cockpit knows about, from three unioned sources: harnesses with buckets in
// the loaded window, harnesses with a quota reading, and (via catalogOrder) the installed-harness
// catalog. A harness with history but no quota still gets a row — it owns real spend, and dropping
// it would make the rail disagree with the totals. Grouped so the two trust zones are visually
// separate: a reading you can act on vs. history only.
export function buildUsageRail(
    harnesses: string[],
    daily: DailyUsage[],
    donuts: ProviderDonuts[],
    catalogOrder: string[]
): UsageRailGroup[] {
    const totals = harnessTotals(daily);
    const byHarness = new Map(donuts.map((d) => [d.provider, d]));
    const keys = [...new Set([...harnesses, ...Object.keys(totals), ...byHarness.keys()])];
    const rank = (h: string): number => {
        const i = catalogOrder.indexOf(h);
        return i === -1 ? catalogOrder.length : i;
    };
    const rows = keys
        .sort((a, b) => rank(a) - rank(b) || (a < b ? -1 : 1))
        .map<UsageRailRow>((harness) => {
            const t = totals[harness] ?? { tokens: 0, spendUsd: 0 };
            const d = byHarness.get(harness);
            return {
                harness,
                tokens: t.tokens,
                spendUsd: t.spendUsd,
                fivehour: d?.fivehour ?? {},
                week: d?.week ?? {},
                state: d == null ? "none" : d.stale != null ? "saved" : "live",
                capturedAt: d?.stale?.capturedAt,
            };
        });
    const groups: UsageRailGroup[] = [];
    const reporting = rows.filter((r) => r.state !== "none");
    const quiet = rows.filter((r) => r.state === "none");
    if (reporting.length > 0) {
        groups.push({ key: "reporting", label: "Reporting", rows: reporting });
    }
    if (quiet.length > 0) {
        groups.push({ key: "quiet", label: "No reading", rows: quiet });
    }
    return groups;
}

// The aggregate row cannot average quotas — they are independent per-account windows, and a mean
// would read "fine" while one account sits at 98%. The one that matters is whichever is closest to
// its cap, so that is the reading "All providers" shows, named so it is never mistaken for a total.
export function worstWindow(rows: UsageRailRow[], which: "fivehour" | "week"): AggregateWindow {
    let top: AggregateWindow | undefined;
    for (const r of rows) {
        const pct = r[which].pct;
        if (pct == null) {
            continue;
        }
        if (top == null || pct > top.pct!) {
            top = { pct, reset: r[which].reset, harness: r.harness };
        }
    }
    return top ?? {};
}

export function railRows(groups: UsageRailGroup[]): UsageRailRow[] {
    return groups.flatMap((g) => g.rows);
}

// The provider tabs, busiest first. The rail's "reporting / quiet" grouping is gone: a tab says whether its
// provider reports quota in its own meta, so the order is by what the window spent, ties by the label shown.
export function tabRows(rows: UsageRailRow[]): UsageRailRow[] {
    return [...rows].sort(
        (a, b) => b.tokens - a.tokens || providerLabel(a.harness).localeCompare(providerLabel(b.harness))
    );
}

// The tab shown until the person picks one: the harness with the most tokens, "all" when there is none.
export function defaultTab(rows: UsageRailRow[]): string {
    return tabRows(rows)[0]?.harness ?? "all";
}

// A tab's meta: the quota windows the provider reports ("5h 41% · wk 72%"; Codex has only the week), else what
// the window spent in tokens. A provider with a reading but neither window filled in falls back to tokens too.
export function tabMeta(row: UsageRailRow): string {
    const windows = [
        row.state !== "none" && row.fivehour.pct != null ? `5h ${Math.round(row.fivehour.pct)}%` : null,
        row.state !== "none" && row.week.pct != null ? `wk ${Math.round(row.week.pct)}%` : null,
    ].filter((w): w is string => w != null);
    return windows.length > 0 ? windows.join(" · ") : `${fmt(row.tokens)} tok`;
}

export function countReporting(groups: UsageRailGroup[]): number {
    return groups.find((g) => g.key === "reporting")?.rows.length ?? 0;
}
