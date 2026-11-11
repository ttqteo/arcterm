// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The Daily chart's by-model model: harness colors and labels, the legend grouped by harness, the
// per-model shades, and the stacked chart rows. Pure module — no React or Wave runtime imports.
//
// Ported from the kaeltran16 fork, where usagestats.ts folds a per-model series. Ours does not (DailyChart is
// stacked by harness and reads toRows), so the types the fold would give this model are declared here, and nothing
// of ours reads this module yet.

export type UsageMetric = "tokens" | "spend";

// one model's window totals. identity is harness + provider + model: pi's openai-codex/gpt-5.5 and
// codex's openai/gpt-5.5 are two series, never one
export interface ModelSeries {
    key: string;
    harness: string;
    provider: string;
    model: string;
    tokens: number;
    spendUsd: number;
}

// json of the triple: unique (no separator a model id could contain collides) and stable
export function modelKey(harness: string, provider: string, model: string): string {
    return JSON.stringify([harness, provider, model]);
}

// one day of a by-model fold: each model's amount that day, keyed by modelKey
export interface ModelDay {
    day: string; // "YYYY-MM-DD"
    byModel: Record<string, { tokens: number; spendUsd: number; pricedTokens?: number }>;
}

// the provider-* tokens the cards' dots use, so a harness reads as one color everywhere; an unknown
// harness falls back to muted
const HARNESS_META: Record<string, { label: string; color: string }> = {
    claude: { label: "Claude", color: "var(--color-provider-claude)" },
    codex: { label: "Codex", color: "var(--color-provider-codex)" },
    opencode: { label: "OpenCode", color: "var(--color-provider-opencode)" },
    pi: { label: "Pi", color: "var(--color-provider-pi)" },
};
const OTHER_COLOR = "var(--color-muted)";

// the faintest shade a harness's last-ranked model gets, so no model fades out of sight
const MIN_SHADE_PCT = 25;

export function harnessChartColor(harness: string): string {
    return HARNESS_META[harness]?.color ?? OTHER_COLOR;
}

export function harnessChartLabel(harness: string): string {
    return HARNESS_META[harness]?.label ?? harness;
}

// rank 0 is the bare color; the rest step evenly down to MIN_SHADE_PCT at the last rank
export function modelShade(color: string, rank: number, count: number): string {
    if (rank <= 0 || count <= 1) return color;
    const pct = 100 - (rank * (100 - MIN_SHADE_PCT)) / (count - 1);
    return `color-mix(in srgb, ${color} ${+pct.toFixed(2)}%, transparent)`;
}

export interface LegendModel {
    key: string;
    harness: string;
    model: string;
    label: string; // provider/model when the model name repeats in its group, else the model
    title: string;
    fill: string;
    tokens: number;
    spendUsd: number;
    value: number;
    pct: number;
}

export interface LegendGroup {
    harness: string;
    label: string;
    value: number;
    pct: number;
    showHead: boolean;
    models: LegendModel[];
}

function metricValue(m: { tokens: number; spendUsd: number }, metric: UsageMetric): number {
    return metric === "tokens" ? m.tokens : m.spendUsd;
}

function compareHarness(order: string[]): (a: string, b: string) => number {
    const rank = (h: string) => {
        const i = order.indexOf(h);
        return i < 0 ? order.length : i;
    };
    return (a, b) => rank(a) - rank(b) || a.localeCompare(b);
}

// groups follow harnessOrder (unlisted harnesses after, alphabetically); models inside a group go by
// window tokens whatever the metric, so switching to spend never reorders rows
export function modelLegend(models: ModelSeries[], harnessOrder: string[], metric: UsageMetric): LegendGroup[] {
    const byHarness = new Map<string, ModelSeries[]>();
    for (const m of models) {
        byHarness.set(m.harness, [...(byHarness.get(m.harness) ?? []), m]);
    }
    const sum = models.reduce((s, m) => s + metricValue(m, metric), 0);
    const share = (v: number) => (sum > 0 ? (v / sum) * 100 : 0);
    const harnesses = [...byHarness.keys()].sort(compareHarness(harnessOrder));
    const showHead = harnesses.length > 1;
    return harnesses.map((harness) => {
        const color = harnessChartColor(harness);
        const ranked = [...byHarness.get(harness)].sort(
            (a, b) => b.tokens - a.tokens || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)
        );
        const nameCount = new Map<string, number>();
        for (const m of ranked) {
            nameCount.set(m.model, (nameCount.get(m.model) ?? 0) + 1);
        }
        const rows: LegendModel[] = ranked.map((m, rank) => {
            const value = metricValue(m, metric);
            const title = `${m.provider}/${m.model}`;
            return {
                key: m.key,
                harness,
                model: m.model,
                label: nameCount.get(m.model) > 1 ? title : m.model,
                title,
                fill: modelShade(color, rank, ranked.length),
                tokens: m.tokens,
                spendUsd: m.spendUsd,
                value,
                pct: share(value),
            };
        });
        const value = rows.reduce((s, r) => s + r.value, 0);
        return { harness, label: harnessChartLabel(harness), value, pct: share(value), showHead, models: rows };
    });
}

export function legendSeries(groups: LegendGroup[]): LegendModel[] {
    return groups.flatMap((g) => g.models);
}

export interface ModelRow {
    day: string; // "MM-DD"
    values: Record<string, number>;
    total: number;
}

export function modelRows(daily: ModelDay[], keys: string[], metric: UsageMetric): ModelRow[] {
    return daily.map((d) => {
        const values = Object.fromEntries(
            keys.map((k) => [k, metricValue(d.byModel[k] ?? { tokens: 0, spendUsd: 0 }, metric)])
        );
        return { day: d.day.slice(5), values, total: keys.reduce((s, k) => s + values[k], 0) };
    });
}

// a window with nothing in it still needs a non-empty y domain: one token, or one cent of spend
const Y_FLOOR: Record<UsageMetric, number> = { tokens: 1, spend: 0.01 };

// the y scale's top: the tallest day, so it fills the plot on either metric
export function yDomainMax(metric: UsageMetric, totals: number[]): number {
    return Math.max(Y_FLOOR[metric], ...totals);
}

// One stack segment: rounded top corners, flat baseline (a rect's rx rounds all four, so a capped top segment read as a
// detached pill above a square bar). Every segment draws the same commands, a lower one with radius 0 and an empty one
// with height 0, and coordinates round to 0.01 so none is written in exponent notation: motion tweens d only between
// strings of the same shape, which is what lets a bar grow or shrink instead of snapping when the data changes.
export function barPath(x: number, y: number, w: number, h: number, r: number): string {
    const n = (v: number) => Math.round(v * 100) / 100;
    const rr = Math.max(0, Math.min(r, w / 2, h));
    const [l, t, rt, b] = [n(x), n(y), n(x + w), n(y + h)];
    return `M${l},${b}V${n(y + rr)}Q${l},${t} ${n(x + rr)},${t}H${n(x + w - rr)}Q${rt},${t} ${rt},${n(y + rr)}V${b}Z`;
}
