// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Usage surface (handoff redesign: Wave-usage-redesign.dc.html artboard 1B). Master-detail, the same
// shape Conversation History and Radar use: a harness rail on the left grouped by whether the harness reports a
// quota window at all, and a detail pane holding that harness's two trust zones — LIVE LIMITS
// (ephemeral 5h/weekly quota, merged live-over-saved via ratelimitstore so it survives idle) and
// HISTORICAL (durable token-class split, daily series, per-model breakdown, folded from the backend
// usage scan). Rail selection IS usageHarnessFilterAtom, so the scope picker and the historical
// filter are one piece of state rather than two that can disagree; that atom re-aggregates
// model.usageStatsAtom, so the detail is simply the surface scoped to one harness.
// Loads on mount + a 60s refresh for the current window; a 1s tick keeps reset countdowns current.

import { Meter, StackedMeter } from "@/app/element/meter";
import { useDidBecomeTrue } from "@/app/element/motionhooks";
import { cardVariants } from "@/app/element/motiontokens";
import { Segmented } from "@/app/element/segmented";
import { SkeletonLine } from "@/app/element/skeleton";
import { globalStore } from "@/app/store/jotaiStore";
import { useSurfaceListNav, type ListNavController } from "@/app/store/keybindings/listnav";
import { REGION_LABEL } from "@/app/view/jarvis/briefstyle";
import { cn } from "@/util/util";
import { useAtom, useAtomValue } from "jotai";
import { MotionConfig, motion } from "motion/react";
import { useEffect, useMemo } from "react";
import type { AgentsViewModel } from "./agents";
import { formatReset, liveWindowAgents, providerPlanUsage, usageLevel } from "./agentsviewmodel";
import { providerDot, providerLabel } from "./cockpitrailmodel";
import { DailyChart } from "./dailychart";
import { harnessesAtom } from "./harnessstore";
import { mergeRateLimitWindows, savedRateLimitsAtom, type DonutWindow } from "./ratelimitstore";
import { runtimeMeta } from "./runtimemeta";
import { SurfaceError, SurfaceHeader } from "./surfacescaffold";
import {
    buildUsageRail,
    countReporting,
    railRows,
    worstWindow,
    type AggregateWindow,
    type UsageRailGroup,
    type UsageRailRow,
} from "./usagerail";
import type { ClassUsage, ProviderUsage, UsageStats } from "./usagestats";
import { CLASS_FILL, fmt, foldModels, modelGridClass, usd } from "./usagestats";
import {
    allUsageStatsAtom,
    loadUsage,
    usageErrorAtom,
    usageLoadedAtom,
    usageMetricAtom,
    usageWindowAtom,
} from "./usagestore";
import { formatProjectedDate, projectWeeklyExhaustion } from "./weeklyforecast";

const ALL = "all";

const LEVEL_FILL: Record<"ok" | "warn" | "hot", string> = {
    ok: "bg-success",
    warn: "bg-warning",
    hot: "bg-error",
};
const LEVEL_TEXT: Record<"ok" | "warn" | "hot", string> = {
    ok: "text-success",
    warn: "text-warning",
    hot: "text-error",
};
// Ranked magnitude within one provider is an ORDINAL job, not categorical: one hue, monotone
// lightness, indexed by rank. Four stops off the existing accent scale — no new colors. Stops are two
// apart so adjacent ranks stay tellable; --color-accent sits next to --color-accent-300 on the ramp.
const MODEL_SEQ = ["bg-accent-200", "bg-accent-400", "bg-accent-600", "bg-accent-800"];
const MAX_MODEL_ROWS = MODEL_SEQ.length;

// Selected/idle treatment for a rail row, matching Conversation History's list (the pane this body is
// modeled on) rather than minting a second selection vocabulary for one surface.
const ROW_BASE =
    "cursor-pointer rounded-[11px] border px-[13px] py-[11px] text-left transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent";
const ROW_ON = "border-accent bg-surface-hover";
const ROW_OFF = "border-border bg-surface hover:border-edge-strong";

function pctStr(n: number): string {
    if (n >= 10) return Math.round(n) + "%";
    if (n < 0.1) return n <= 0 ? "0%" : "<0.1%";
    return +n.toFixed(1) + "%";
}

// "Claude 1.2K · OpenCode 300" for the token summary-card secondary line.
function harnessSub(byHarness: Record<string, number>): string {
    const parts = Object.entries(byHarness)
        .filter(([, n]) => n > 0)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([h, n]) => `${providerLabel(h)} ${fmt(n)}`);
    return parts.length > 0 ? parts.join(" · ") : "no usage in scope";
}

function ageStr(ms: number): string {
    const s = Math.max(0, Math.floor(ms / 1000));
    if (s < 60) return s + "s";
    const m = Math.floor(s / 60);
    if (m < 60) return m + "m";
    const h = Math.floor(m / 60);
    if (h < 24) return h + "h";
    return Math.floor(h / 24) + "d";
}

// Rail/detail state chrome. Status is never color alone here — every use pairs this with the label.
// `color` is a var() reference applied through `style`, so the one value drives both the text and the
// currentColor tint behind it.
const PILL_TINT = "color-mix(in srgb, currentColor 14%, transparent)";

function stateMeta(row: UsageRailRow, now: number): { label: string; long: string; color: string } {
    if (row.state === "live") {
        return { label: "Live", long: "live", color: "var(--color-success)" };
    }
    if (row.state === "saved") {
        const age = row.capturedAt != null ? ageStr(now - row.capturedAt) : "?";
        return { label: "Saved", long: `as of ${age} ago`, color: "var(--color-warning)" };
    }
    return { label: "No reading", long: "no quota reading", color: "var(--color-muted)" };
}

// An h3, not a styled span: these head real sections (and the by-model cards, where the heading IS the
// provider name), so the heading level has to survive the eyebrow styling.
function SectionRule({ label, meta, accent = false }: { label: string; meta?: string; accent?: boolean }) {
    return (
        <div className="mb-3 flex items-center gap-2.5">
            <h3 className={cn(REGION_LABEL, accent ? "text-accent-soft" : "text-muted")}>{label}</h3>
            <div className="h-px flex-1 bg-edge-faint" />
            {meta != null ? <span className="text-[10.5px] tabular-nums text-muted">{meta}</span> : null}
        </div>
    );
}

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
    return (
        <div className="rounded-[11px] border border-border bg-surface-raised px-4 py-[14px]">
            <div className="mb-2 text-[10.5px] text-muted">{label}</div>
            <div className="mb-1.5 text-[21px] font-bold tabular-nums text-primary">{value}</div>
            {sub ? <div className="text-[10.5px] tabular-nums text-muted">{sub}</div> : null}
        </div>
    );
}

// One quota window as a bar. The redesign trades the arc donuts for bars because the detail pane
// gives two windows the full width, and a bar reads a percentage against its track far better than a
// 40px ring did. `used` carries the source harness on the aggregate row, where "62%" alone would not
// say whose account it describes.
function LimitCard({
    kind,
    title,
    w,
    now,
    used,
    projectedExhaustion,
}: {
    kind: string;
    title: string;
    w: DonutWindow;
    now: number;
    used?: string;
    projectedExhaustion?: number | null;
}) {
    const level = usageLevel(w.pct ?? 0);
    const has = w.pct != null;
    return (
        <div
            data-usage-limit={kind}
            className="rounded-[11px] border border-border bg-surface-raised px-[15px] py-[13px]"
        >
            <div className="mb-2 flex items-baseline justify-between">
                <span className="text-[10.5px] font-semibold text-ink-mid">{title}</span>
                <span className={cn("text-[13px] font-bold tabular-nums", has ? LEVEL_TEXT[level] : "text-muted")}>
                    {has ? Math.round(w.pct!) + "%" : "—"}
                </span>
            </div>
            <Meter pct={w.pct ?? 0} fill={has ? LEVEL_FILL[level] : "bg-edge-strong"} height={7} radius={4} />
            <div className="mt-1.5 flex justify-between gap-2 text-[10.5px] tabular-nums text-muted">
                <span className="truncate">{used ?? (has ? "in window" : "no reading")}</span>
                <span className="flex-none whitespace-nowrap">
                    {w.reset ? "resets " + formatReset(w.reset, now) : "—"}
                </span>
            </div>
            {projectedExhaustion != null ? (
                <div className="mt-1 text-[10.5px] tabular-nums text-warning">
                    ~100% by {formatProjectedDate(projectedExhaustion)}
                </div>
            ) : null}
        </div>
    );
}

function RailRow({
    row,
    active,
    now,
    onSelect,
}: {
    row: UsageRailRow;
    active: boolean;
    now: number;
    onSelect: () => void;
}) {
    const st = stateMeta(row, now);
    return (
        <motion.button
            layout
            variants={cardVariants}
            initial="initial"
            animate="animate"
            type="button"
            data-usage-harness={row.harness}
            aria-pressed={active}
            onClick={onSelect}
            className={cn("flex flex-col gap-2", ROW_BASE, active ? ROW_ON : ROW_OFF)}
        >
            <span className="flex items-center gap-2.5">
                <span className={cn("h-2 w-2 flex-none rounded-full", providerDot(row.harness))} />
                <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-primary">
                    {providerLabel(row.harness)}
                </span>
                <span
                    className="flex-none rounded-[4px] px-1.5 py-0.5 text-[10.5px] font-bold uppercase tabular-nums tracking-[0.06em]"
                    style={{ color: st.color, backgroundColor: PILL_TINT }}
                >
                    {st.label}
                </span>
            </span>
            <span className="flex items-center gap-2 text-[10.5px] tabular-nums text-muted">
                <span className="text-secondary">{fmt(row.tokens)} tok</span>
                <span className="text-muted">·</span>
                <span>≈ {usd(row.spendUsd)}</span>
                <span className="flex-1" />
                {row.state === "none" ? (
                    <span>history only</span>
                ) : (
                    <>
                        <span>5h {row.fivehour.pct != null ? Math.round(row.fivehour.pct) + "%" : "—"}</span>
                        <span className="text-muted">·</span>
                        <span>wk {row.week.pct != null ? Math.round(row.week.pct) + "%" : "—"}</span>
                    </>
                )}
            </span>
        </motion.button>
    );
}

function UsageRail({
    groups,
    sel,
    now,
    totalTokens,
    onSelect,
}: {
    groups: UsageRailGroup[];
    sel: string;
    now: number;
    totalTokens: number;
    onSelect: (id: string) => void;
}) {
    return (
        <div className="w-[392px] flex-none overflow-y-auto border-r border-edge-faint p-3 pb-10">
            <button
                type="button"
                data-usage-harness={ALL}
                aria-pressed={sel === ALL}
                onClick={() => onSelect(ALL)}
                className={cn("mb-3.5 flex w-full items-center gap-[11px]", ROW_BASE, sel === ALL ? ROW_ON : ROW_OFF)}
            >
                <span className="flex h-[34px] w-[34px] flex-none items-center justify-center rounded-[9px] border border-accent bg-accentbg text-[14px] font-semibold text-accent-soft">
                    Σ
                </span>
                <span className="min-w-0 flex-1">
                    <span className="block text-[13px] font-semibold text-primary">All providers</span>
                    <span className="block text-[11px] text-muted">every transcript in window</span>
                </span>
                <span className="flex-none rounded-full bg-surface-hover px-2 py-0.5 text-[11px] tabular-nums text-secondary">
                    {fmt(totalTokens)}
                </span>
            </button>

            {groups.map((g) => (
                <div key={g.key} className="mb-3.5">
                    <SectionRule label={g.label} meta={String(g.rows.length)} accent={g.key === "reporting"} />
                    <div className="flex flex-col gap-[7px]">
                        {g.rows.map((r) => (
                            <RailRow
                                key={r.harness}
                                row={r}
                                active={sel === r.harness}
                                now={now}
                                onSelect={() => onSelect(r.harness)}
                            />
                        ))}
                    </div>
                </div>
            ))}
        </div>
    );
}

function SplitCard({ split, scope }: { split: ClassUsage[]; scope: string }) {
    const tokTotal = split.reduce((s, c) => s + c.tokens, 0);
    const spdTotal = split.reduce((s, c) => s + c.spendUsd, 0);
    const cacheRead = split.find((c) => c.cls === "cacheRead");
    const cachePct = tokTotal > 0 && cacheRead ? (cacheRead.tokens / tokTotal) * 100 : 0;
    return (
        <div className="mb-3.5 rounded-[14px] border border-border bg-surface-raised px-5 py-[18px]">
            <SectionRule label="Where it goes" meta={scope} />
            <p className="mb-[18px] max-w-[680px] text-[12.5px] leading-[1.55] text-secondary">
                {pctStr(cachePct)} of the token count is cache reads, so a single “tokens” number misleads. Cache reads
                price at a fraction of input, so the two bars tell different stories.
            </p>

            <div className="mb-[7px] flex items-baseline justify-between">
                <span className="text-[10.5px] font-semibold text-ink-mid">Tokens</span>
                <span className="text-[12px] font-bold tabular-nums text-primary">{fmt(tokTotal)}</span>
            </div>
            <StackedMeter
                className="mb-4"
                height={26}
                radius={7}
                track="bg-background"
                segs={split.map((c) => ({ key: c.cls, value: c.tokens, fill: CLASS_FILL[c.cls] }))}
            />

            <div className="mb-[7px] flex items-baseline justify-between">
                <span className="text-[10.5px] font-semibold text-ink-mid">
                    Spend <span className="font-medium text-muted">≈ API-equiv</span>
                </span>
                <span className="text-[12px] font-bold tabular-nums text-primary">{usd(spdTotal)}</span>
            </div>
            <StackedMeter
                className="mb-[18px]"
                height={26}
                radius={7}
                track="bg-background"
                segs={split.map((c) => ({ key: c.cls, value: c.spendUsd, fill: CLASS_FILL[c.cls] }))}
            />

            <div className="grid grid-cols-2 gap-x-3 gap-y-3.5 border-t border-edge-faint pt-[15px] lg:grid-cols-3 xl:grid-cols-5">
                {split.map((c) => (
                    <div key={c.cls}>
                        <div className="mb-[7px] flex items-center gap-[7px]">
                            <span className={cn("h-[9px] w-[9px] flex-none rounded-[3px]", CLASS_FILL[c.cls])} />
                            <span className="text-[11.5px] font-semibold text-secondary">{c.label}</span>
                        </div>
                        <div className="mb-[3px] flex justify-between text-[10.5px] tabular-nums text-muted">
                            <span>tokens</span>
                            <span className="text-secondary">
                                {fmt(c.tokens)} · {pctStr(tokTotal > 0 ? (c.tokens / tokTotal) * 100 : 0)}
                            </span>
                        </div>
                        <div className="flex justify-between text-[10.5px] tabular-nums text-muted">
                            <span>spend</span>
                            <span className="text-secondary">
                                {usd(c.spendUsd)} · {pctStr(spdTotal > 0 ? (c.spendUsd / spdTotal) * 100 : 0)}
                            </span>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}

// Grouped by UPSTREAM provider ("anthropic" | "openai"), which is what the transcript buckets carry —
// deliberately a different axis from the harness rail, so the heading names the provider raw.
function ModelGroup({ p }: { p: ProviderUsage }) {
    return (
        <div className="rounded-[14px] border border-border bg-surface-raised px-5 py-[18px]">
            <SectionRule label={p.provider} meta={fmt(p.tokens)} />
            {foldModels(p.models, MAX_MODEL_ROWS).map((m, i) => (
                <div key={m.model} className="mb-3">
                    <div className="mb-1.5 flex items-baseline justify-between gap-3">
                        {/* the provider prefix is what tells Pi's openai-codex/gpt-5.5 from Codex's
                            openai/gpt-5.5 — same model id, different upstream bucket */}
                        <span
                            className="min-w-0 truncate text-[11.5px] tabular-nums text-secondary"
                            title={`${p.provider}/${m.model}`}
                        >
                            {m.model === "Other" ? m.model : `${p.provider}/${m.model}`}
                        </span>
                        <span className="flex-none text-[10.5px] tabular-nums text-muted">
                            {fmt(m.tokens)} · <span className="font-semibold text-secondary">{pctStr(m.pct)}</span>
                        </span>
                    </div>
                    <Meter pct={m.pct} fill={MODEL_SEQ[i]} height={7} radius={4} track="bg-edge-strong" />
                </div>
            ))}
        </div>
    );
}

function DetailHeader({
    sel,
    row,
    stats,
    now,
    reportingLabel,
}: {
    sel: string;
    row?: UsageRailRow;
    stats: UsageStats;
    now: number;
    reportingLabel: string;
}) {
    const all = sel === ALL;
    const meta = runtimeMeta(sel);
    const st = row != null ? stateMeta(row, now) : null;
    const reported = stats.totals.reportedCostWindowPresent ? usd(stats.totals.reportedCostWindowUsd) : "not reported";
    const modelCount = stats.providers.reduce((s, p) => s + p.models.length, 0);
    return (
        <div className="mb-5 flex items-start gap-3.5 border-b border-edge-faint pb-4">
            <span
                className={cn(
                    "flex h-[42px] w-[42px] flex-none items-center justify-center rounded-[11px] border text-[15px] font-semibold",
                    all ? "border-accent bg-accentbg text-accent-soft" : cn(meta.line, meta.softBg, meta.text)
                )}
            >
                {all ? "Σ" : meta.glyph}
            </span>
            <div className="min-w-0 flex-1">
                <div className="mb-1.5 flex items-center gap-2.5">
                    <h2 className="text-[19px] font-bold tracking-[-0.01em] text-primary">
                        {all ? "All providers" : providerLabel(sel)}
                    </h2>
                    <span
                        className="rounded-[5px] px-1.5 py-[3px] text-[10.5px] font-bold uppercase tabular-nums tracking-[0.06em]"
                        style={{
                            color: all ? "var(--color-accent-soft)" : (st?.color ?? "var(--color-muted)"),
                            backgroundColor: PILL_TINT,
                        }}
                    >
                        {all ? "Aggregate" : (st?.label ?? "No reading")}
                    </span>
                </div>
                <div className="flex flex-wrap gap-x-2.5 gap-y-1 text-[11px] tabular-nums text-muted">
                    <span>
                        {"tokens "}
                        <span className="text-secondary">{fmt(stats.totals.tokensWindow)}</span>
                    </span>
                    <span>
                        {"reported "}
                        <span className="text-secondary">{reported}</span>
                    </span>
                    <span>
                        {"api-equiv "}
                        <span className="text-secondary">≈ {usd(stats.totals.spendWindowUsd)}</span>
                    </span>
                    <span>
                        {"models "}
                        <span className="text-secondary">{modelCount}</span>
                    </span>
                    {all ? (
                        <span>
                            {"quota "}
                            <span className="text-secondary">{reportingLabel}</span>
                        </span>
                    ) : null}
                </div>
            </div>
        </div>
    );
}

function UsageHistorySkeleton() {
    return (
        <div>
            <div className="mb-3.5 grid grid-cols-2 gap-3 xl:grid-cols-4">
                {[0, 1, 2, 3].map((i) => (
                    <div key={i} className="rounded-[11px] border border-border bg-surface-raised px-4 py-[14px]">
                        <SkeletonLine className="mb-3 h-[11px] w-[72px]" />
                        <SkeletonLine className="mb-2 h-[21px] w-[92px]" />
                        <SkeletonLine className="h-[10px] w-[118px]" />
                    </div>
                ))}
            </div>
            <div className="mb-3.5 rounded-[14px] border border-border bg-surface-raised px-5 py-[18px]">
                <SkeletonLine className="mb-3 h-[13px] w-[128px]" />
                <SkeletonLine className="mb-[18px] h-[12px] w-[62%]" />
                <SkeletonLine className="mb-4 h-[26px] w-full rounded-[7px]" />
                <SkeletonLine className="h-[26px] w-full rounded-[7px]" />
            </div>
            <div className="rounded-[14px] border border-border bg-surface-raised px-5 py-[18px]">
                <SkeletonLine className="mb-5 h-[13px] w-[92px]" />
                <div className="flex h-[156px] items-end gap-[7px] border-b border-l border-border px-1">
                    <SkeletonLine className="h-[42px] flex-1 rounded-t-[3px]" />
                    <SkeletonLine className="h-[75px] flex-1 rounded-t-[3px]" />
                    <SkeletonLine className="h-[58px] flex-1 rounded-t-[3px]" />
                    <SkeletonLine className="h-[104px] flex-1 rounded-t-[3px]" />
                    <SkeletonLine className="h-[66px] flex-1 rounded-t-[3px]" />
                    <SkeletonLine className="h-[122px] flex-1 rounded-t-[3px]" />
                    <SkeletonLine className="h-[84px] flex-1 rounded-t-[3px]" />
                </div>
            </div>
        </div>
    );
}

export function UsageSurface({ model }: { model: AgentsViewModel }) {
    const agents = useAtomValue(model.agentsAtom);
    const allStats: UsageStats = useAtomValue(allUsageStatsAtom);
    const stats: UsageStats = useAtomValue(model.usageStatsAtom);
    const loadError = useAtomValue(usageErrorAtom);
    const usageLoaded = useAtomValue(usageLoadedAtom);
    const saved = useAtomValue(savedRateLimitsAtom);
    const now = useAtomValue(model.nowAtom);
    const [usageWindow, setUsageWindow] = useAtom(usageWindowAtom);
    const [usageMetric, setUsageMetric] = useAtom(usageMetricAtom);
    // the rail's selection and the historical scope filter are the same state, by construction
    const [sel, setSel] = useAtom(model.usageHarnessFilterAtom);

    useEffect(() => {
        const days = usageWindow === "7d" ? 7 : 0;
        // reset loaded so the skeleton shows while the newly-selected window loads (esp. the heavy
        // all-time scan), instead of leaving the previous window's stats on screen until it resolves.
        // The 60s refresh below does NOT reset — it silently refreshes in place.
        globalStore.set(usageLoadedAtom, false);
        void loadUsage(days);
        const refresh = setInterval(() => void loadUsage(days), 60_000);
        return () => clearInterval(refresh);
    }, [usageWindow]);

    const harnesses = useAtomValue(harnessesAtom);
    const catalogOrder = useMemo(() => harnesses.map((h) => h.runtime), [harnesses]);
    const donuts = mergeRateLimitWindows(providerPlanUsage(liveWindowAgents(agents)), saved, now);
    const groups = useMemo(
        () => buildUsageRail(allStats.availableHarnesses, allStats.daily, donuts, catalogOrder),
        [allStats.availableHarnesses, allStats.daily, donuts, catalogOrder]
    );
    const rows = useMemo(() => railRows(groups), [groups]);
    const selRow = rows.find((r) => r.harness === sel);

    // A window reload can remove the selected harness from the rail (e.g. its history falls outside
    // the window and it reports no quota). Fall back to the aggregate so the detail never points at a
    // row that isn't there. Only once loaded — an empty rail mid-load would otherwise reset a
    // deliberate selection on every window switch.
    useEffect(() => {
        if (usageLoaded && sel !== ALL && !rows.some((r) => r.harness === sel)) {
            setSel(ALL);
        }
    }, [usageLoaded, rows, sel, setSel]);

    const navIds = useMemo(() => [ALL, ...rows.map((r) => r.harness)], [rows]);
    const listNav = useMemo<ListNavController>(
        () => ({ surface: "usage", navigableIds: navIds, cursorId: sel, setCursor: setSel }),
        [navIds, sel, setSel]
    );
    useSurfaceListNav(listNav);

    const claudeRow = rows.find((r) => r.harness === "claude");
    const weeklyProjectionMs =
        claudeRow?.week.pct != null && claudeRow.week.reset != null
            ? projectWeeklyExhaustion(
                  allStats.daily.map((d) => ({ day: d.day, tokens: d.byHarness.claude?.tokens ?? 0 })),
                  claudeRow.week.pct,
                  claudeRow.week.reset,
                  now
              )
            : null;

    const reporting = countReporting(groups);
    const reportingLabel = `${reporting} of ${rows.length} reporting`;
    const all = sel === ALL;
    // the aggregate can't average independent per-account quotas — it reports whichever is closest to
    // its cap (worstWindow) and says whose it is.
    const fiveHour: AggregateWindow = all ? worstWindow(rows, "fivehour") : (selRow?.fivehour ?? {});
    const week: AggregateWindow = all ? worstWindow(rows, "week") : (selRow?.week ?? {});
    const hasLimits = all ? fiveHour.pct != null || week.pct != null : selRow != null && selRow.state !== "none";
    const projectionForWeek = all
        ? week.harness === "claude"
            ? weeklyProjectionMs
            : null
        : sel === "claude"
          ? weeklyProjectionMs
          : null;

    const hasHistory = stats.providers.length > 0 || stats.totals.tokensWindow > 0;
    const revealHistory = useDidBecomeTrue(hasHistory);
    const chartHarnesses = all ? rows.map((r) => r.harness) : [sel];
    const scopeLabel = all ? "all providers" : providerLabel(sel);
    const windowLabel = usageWindow === "7d" ? "last 7 days" : "all time";

    const reportedCard = (present: boolean, sources: string[], value: number): { value: string; sub: string } => ({
        value: present ? usd(value) : "—",
        sub: present && sources.length > 0 ? `from ${sources.join(" · ")}` : "no source reports cost",
    });
    const estimateSub = (coveragePct: number | null) =>
        coveragePct == null ? "no priced tokens" : `${Math.round(coveragePct)}% of tokens priced`;

    return (
        <MotionConfig reducedMotion="user">
            <div className="flex h-full min-h-0 flex-col bg-background">
                <SurfaceHeader
                    title="Usage"
                    badge={
                        reporting > 0 ? (
                            <span className="inline-flex items-center gap-1.5 rounded-sm border border-accent bg-accentbg px-2 py-[3px] text-[10.5px] font-semibold uppercase tabular-nums tracking-[0.08em] text-accent-soft">
                                <span className="h-1.5 w-1.5 rounded-full bg-accent" />
                                {reporting} reporting
                            </span>
                        ) : null
                    }
                    subtitle={
                        <span className="block max-w-[680px] leading-[1.5]">
                            Live provider quota while agents run, and the durable history behind it. Pick a scope on the
                            left; reported cost is what each agent source recorded, the API-equivalent estimate comes
                            from a bundled price table. Neither is a bill.
                        </span>
                    }
                    actions={
                        <Segmented<"7d" | "all">
                            value={usageWindow}
                            onChange={setUsageWindow}
                            options={[
                                { key: "7d", label: "7 days" },
                                { key: "all", label: "All time" },
                            ]}
                        />
                    }
                />

                {loadError ? <SurfaceError message="Couldn’t refresh — showing the last loaded usage." /> : null}

                <div className="flex min-h-0 flex-1">
                    <UsageRail
                        groups={groups}
                        sel={sel}
                        now={now}
                        totalTokens={allStats.totals.tokensWindow}
                        onSelect={setSel}
                    />

                    <div data-usage-detail={sel} className="min-w-0 flex-1 overflow-y-auto px-7 pb-12 pt-5">
                        <DetailHeader sel={sel} row={selRow} stats={stats} now={now} reportingLabel={reportingLabel} />

                        <SectionRule
                            label="Live limits"
                            meta={all ? "highest reading · ephemeral" : selRow ? stateMeta(selRow, now).long : "—"}
                        />
                        {hasLimits ? (
                            <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
                                <LimitCard
                                    kind="fivehour"
                                    title="5-hour"
                                    w={fiveHour}
                                    now={now}
                                    used={all && fiveHour.harness ? providerLabel(fiveHour.harness) : undefined}
                                />
                                <LimitCard
                                    kind="week"
                                    title="Weekly"
                                    w={week}
                                    now={now}
                                    used={all && week.harness ? providerLabel(week.harness) : undefined}
                                    projectedExhaustion={projectionForWeek}
                                />
                            </div>
                        ) : (
                            <p className="mb-6 rounded-[11px] border border-border bg-surface px-4 py-3 text-[11px] leading-[1.55] text-muted">
                                No quota reading{all ? "" : ` for ${providerLabel(sel)}`}. Windows are known only while
                                an agent that publishes them runs; the last snapshot is kept per provider, and rolls to
                                empty once its window passes. History below is unaffected.
                            </p>
                        )}

                        <SectionRule label="Historical" meta={`durable · ${windowLabel}`} />

                        {!usageLoaded ? (
                            <UsageHistorySkeleton />
                        ) : !hasHistory ? (
                            <div className="mt-10 text-center text-[13px] text-muted">
                                No usage in this window{all ? " — start an agent." : ` for ${providerLabel(sel)}.`}
                            </div>
                        ) : (
                            <motion.div
                                variants={cardVariants}
                                initial={revealHistory ? "initial" : false}
                                animate="animate"
                            >
                                <div className="mb-3.5 grid grid-cols-2 gap-3 xl:grid-cols-4">
                                    {usageWindow === "7d" ? (
                                        <>
                                            <StatCard
                                                label="Tokens · today"
                                                value={fmt(stats.totals.tokensToday)}
                                                sub={all ? harnessSub(stats.totals.tokensTodayByHarness) : undefined}
                                            />
                                            <StatCard label="Tokens · 7 days" value={fmt(stats.totals.tokensWeek)} />
                                            <StatCard
                                                label="Reported cost · 7 days"
                                                {...reportedCard(
                                                    stats.totals.reportedCostWeekPresent,
                                                    stats.totals.reportedCostWeekHarnesses,
                                                    stats.totals.reportedCostWeekUsd
                                                )}
                                            />
                                            <StatCard
                                                label="API-equivalent · 7 days"
                                                value={`≈ ${usd(stats.totals.spendWeekUsd)}`}
                                                sub={estimateSub(stats.totals.pricingCoverageWeekPct)}
                                            />
                                        </>
                                    ) : (
                                        <>
                                            <StatCard
                                                label="Tokens · all time"
                                                value={fmt(stats.totals.tokensWindow)}
                                                sub={all ? harnessSub(stats.totals.tokensWindowByHarness) : undefined}
                                            />
                                            <StatCard
                                                label="Daily avg"
                                                value={fmt(
                                                    stats.totals.activeDays > 0
                                                        ? stats.totals.tokensWindow / stats.totals.activeDays
                                                        : 0
                                                )}
                                                sub={`over ${stats.totals.activeDays} active day${stats.totals.activeDays === 1 ? "" : "s"}`}
                                            />
                                            <StatCard
                                                label="Reported cost · all time"
                                                {...reportedCard(
                                                    stats.totals.reportedCostWindowPresent,
                                                    stats.totals.reportedCostWindowHarnesses,
                                                    stats.totals.reportedCostWindowUsd
                                                )}
                                            />
                                            <StatCard
                                                label="API-equivalent · all time"
                                                value={`≈ ${usd(stats.totals.spendWindowUsd)}`}
                                                sub={estimateSub(stats.totals.pricingCoverageWindowPct)}
                                            />
                                        </>
                                    )}
                                </div>

                                <SplitCard split={stats.split} scope={scopeLabel} />

                                <DailyChart
                                    daily={stats.daily}
                                    window={usageWindow}
                                    metric={usageMetric}
                                    onMetric={setUsageMetric}
                                    harnesses={chartHarnesses}
                                />

                                <div className={modelGridClass(stats.providers.length)}>
                                    {stats.providers.map((p) => (
                                        <ModelGroup key={p.provider} p={p} />
                                    ))}
                                </div>
                            </motion.div>
                        )}
                    </div>
                </div>
            </div>
        </MotionConfig>
    );
}
