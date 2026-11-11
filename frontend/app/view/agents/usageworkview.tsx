// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The Usage surface's By work lens: what the usage paid for. A scope bar pinned under the header (All usage, the
// projects, then the initiatives) over a detail page: the historical cards, the ranked list of runs and sessions
// (paged: eight rows, then 25 more per press), the daily chart and where it goes (usageattribution.ts). The
// provider page (usagesurface.tsx) hands the whole page below its header to this component the way it does for the
// Workflow lens, so every provider page section stays where it was.
//
// The keyboard cursor walks the scope cards, then the shown rows of a list whose rows open something (usagenav.ts);
// Escape's Back step is the usage:back binding (bindings.ts), which reads the same lens, scope and item atoms.

import { Meter, StackedMeter } from "@/app/element/meter";
import { useDidBecomeTrue } from "@/app/element/motionhooks";
import { cardVariants } from "@/app/element/motiontokens";
import { Segmented } from "@/app/element/segmented";
import { SkeletonLine } from "@/app/element/skeleton";
import { useSurfaceListNav, type ListNavController } from "@/app/store/keybindings/listnav";
import { REGION_LABEL } from "@/app/view/jarvis/briefstyle";
import { openTarget } from "@/app/view/jarvis/openref";
import { cn, fireAndForget } from "@/util/util";
import { useAtom, useAtomValue } from "jotai";
import { MotionConfig, motion } from "motion/react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { AgentsViewModel } from "./agents";
import { providerLabel } from "./cockpitrailmodel";
import { DailyChart } from "./dailychart";
import { SurfaceEmptyState, SurfaceError, SurfaceHeader } from "./surfacescaffold";
import {
    ALL_SCOPE,
    buildAttribution,
    itemScopeKey,
    LIST_COLLAPSED_ROWS,
    listPageShown,
    nextShown,
    otherFoldersText,
    plural,
    resolveScope,
    scopeBuckets,
    scopeId,
    scopeList,
    scopeName,
    scopeSplit,
    type WorkList,
    type WorkRow,
    type WorkScope,
    type WorkSplit,
} from "./usageattribution";
import { resolveUsageCursor, usageNavIds } from "./usagenav";
import {
    aggregateBuckets,
    coverageStr,
    estimateStr,
    fmt,
    pctStr,
    usd,
    windowStartDay,
    type UsageStats,
} from "./usagestats";
import {
    allUsageStatsAtom,
    loadUsage,
    usageBucketsAtom,
    usageEffortsAtom,
    usageErrorAtom,
    usageHeldWindowAtom,
    usageListShownAtom,
    usageLoadedAtom,
    usageLoadView,
    usageMetricAtom,
    usageSessionsAtom,
    usageWindowAtom,
    usageWorkItemAtom,
    usageWorkScopeAtom,
} from "./usagestore";

// an initiative is not a part of All usage's split, so its card dot names no lane
const INITIATIVE_DOT = "bg-ink-faint";
const HELD_DASH = "—";
const PILL_TINT = "color-mix(in srgb, currentColor 14%, transparent)";

// Selected/idle treatment of a scope card, the same pair the Sessions rail uses. Cards hold 220-340px; the bar
// scrolls sideways before it squashes.
const CARD_BASE =
    "flex min-w-[220px] max-w-[340px] flex-1 flex-col gap-[7px] cursor-pointer rounded-[10px] border px-3 py-2.5 text-left transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent";
const ROW_ON = "border-accent bg-surface-hover";
const ROW_OFF = "border-border bg-surface hover:border-edge-strong";
const PANEL = "rounded-[14px] border border-border bg-surface-raised px-5 py-[18px]";
const QUIET_BUTTON =
    "cursor-pointer rounded border border-edge-mid bg-surface-raised text-[12px] hover:border-edge-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent";
const RANGE_OPTIONS: { key: "7d" | "all"; label: string }[] = [
    { key: "7d", label: "7 days" },
    { key: "all", label: "All time" },
];

// An h3, not a styled span: these head real sections, so the heading level has to survive the eyebrow styling.
function SectionRule({ label, meta }: { label: string; meta?: string }) {
    return (
        <div className="mb-3 flex items-center gap-2.5">
            <h3 className={cn(REGION_LABEL, "text-muted")}>{label}</h3>
            <div className="h-px flex-1 bg-edge-faint" />
            {meta != null ? <span className="text-[10.5px] tabular-nums text-muted">{meta}</span> : null}
        </div>
    );
}

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
    return (
        <div className="rounded-[11px] border border-border bg-surface-raised px-3.5 py-3">
            <div className="mb-1.5 truncate text-[10.5px] tabular-nums text-muted">{label}</div>
            <div className="text-[17px] font-bold tabular-nums text-primary">{value}</div>
            {sub ? (
                <div className="mt-2 truncate text-[10.5px] tabular-nums text-muted" title={sub}>
                    {sub}
                </div>
            ) : null}
        </div>
    );
}

// One card of the scope bar: dot, name and share pill over the scope's tokens and estimate, then a fact on its own
// line (a long fact truncates there rather than clipping the numbers). `harness` (All usage's "all"), `project` or
// `initiative` keys the card for the scenarios.
function ScopeCard({
    harness,
    project,
    initiative,
    title,
    active,
    onSelect,
    dot,
    name,
    pill,
    tokens,
    estimate,
    fact,
    failed,
}: {
    harness?: string;
    project?: string;
    initiative?: string;
    title?: string;
    active: boolean;
    onSelect: () => void;
    dot: string;
    name: string;
    pill: string;
    tokens: number;
    estimate: string; // estimateStr: "≈ $1.20", or "unpriced"
    fact?: string;
    failed?: string; // why the range's figures are missing; the line then reads a dash under this title
}) {
    return (
        <motion.button
            layout
            variants={cardVariants}
            initial="initial"
            animate="animate"
            type="button"
            data-usage-harness={harness}
            data-usage-project={project}
            data-usage-initiative={initiative}
            aria-pressed={active}
            title={title}
            onClick={onSelect}
            className={cn(CARD_BASE, active ? ROW_ON : ROW_OFF)}
        >
            <span className="flex w-full items-center gap-2">
                <span className={cn("h-2 w-2 flex-none rounded-full", dot)} />
                <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-primary">{name}</span>
                <span
                    className="flex-none rounded-[4px] px-1.5 py-0.5 text-[10px] font-bold uppercase tabular-nums tracking-[0.06em]"
                    style={{ color: "var(--color-accent-soft)", backgroundColor: PILL_TINT }}
                >
                    {pill}
                </span>
            </span>
            <span
                data-usage-figures
                title={failed}
                className="flex w-full gap-2 whitespace-nowrap text-[10.5px] tabular-nums text-muted"
            >
                {failed != null ? (
                    <span>{HELD_DASH}</span>
                ) : (
                    <>
                        <span className="text-secondary">{fmt(tokens)} tok</span>
                        <span>·</span>
                        <span>{estimate}</span>
                    </>
                )}
            </span>
            {fact != null ? (
                <span data-usage-fact title={fact} className="w-full truncate text-[10.5px] tabular-nums text-muted">
                    {fact}
                </span>
            ) : null}
        </motion.button>
    );
}

interface DetailHead {
    title: string;
    meta: [string, string][];
    action?: ReactNode;
}

// the header meta every scope shares, after whatever names the scope itself
function statsMeta(stats: UsageStats): [string, string][] {
    const reported = stats.totals.reportedCostWindowPresent ? usd(stats.totals.reportedCostWindowUsd) : "not reported";
    return [
        ["tokens", fmt(stats.totals.tokensWindow)],
        ["reported", reported],
        [
            "api-equiv",
            estimateStr(stats.totals.spendWindowUsd, stats.totals.pricedTokensWindow, stats.totals.tokensWindow),
        ],
        ["models", String(stats.providers.reduce((n, p) => n + p.models.length, 0))],
    ];
}

function workHead(scope: WorkScope, stats: UsageStats, action: ReactNode): DetailHead {
    if (scope.kind === "all") {
        return { title: "All usage", meta: statsMeta(stats) };
    }
    if (scope.kind === "project" || scope.kind === "initiative") {
        const { label, count } = scope.kind === "project" ? scope.project : scope.initiative;
        return { title: label, meta: [["runs and sessions", String(count)], ...statsMeta(stats)] };
    }
    const { item } = scope;
    const named: [string, string][] = item.projectLabel !== "" ? [["project", item.projectLabel]] : [];
    return {
        title: item.title,
        meta: [...named, ["sessions", String(item.sessions.length)], ...statsMeta(stats)],
        action,
    };
}

function DetailHeader({ head }: { head: DetailHead }) {
    return (
        <div data-usage-head className="flex items-baseline gap-4">
            <h2 className="min-w-0 truncate text-[14px] font-semibold text-primary" title={head.title}>
                {head.title}
            </h2>
            <div className="flex min-w-[240px] flex-1 flex-wrap gap-x-3.5 gap-y-1 text-[11px] tabular-nums text-muted">
                {head.meta.map(([k, v]) => (
                    <span key={k}>
                        {k} <span className="text-secondary">{v}</span>
                    </span>
                ))}
            </div>
            {head.action}
        </div>
    );
}

function RowIcon({ run }: { run: boolean }) {
    return (
        <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
        >
            {run ? (
                <>
                    <rect x="3" y="3" width="6" height="6" rx="1" />
                    <rect x="15" y="15" width="6" height="6" rx="1" />
                    <path d="M6 9v4a3 3 0 0 0 3 3h6" />
                </>
            ) : (
                <>
                    <path d="m4 17 6-5-6-5" />
                    <path d="M12 19h8" />
                </>
            )}
        </svg>
    );
}

function Chevron({ back = false }: { back?: boolean }) {
    return (
        <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
        >
            <path d={back ? "m15 6-6 6 6 6" : "m9 6 6 6-6 6"} />
        </svg>
    );
}

const LIST_ROW =
    "grid min-h-[48px] w-full grid-cols-[22px_minmax(0,1fr)_150px_64px_74px_14px] items-center gap-x-3.5 border-0 border-b border-edge-faint bg-transparent px-1 py-1.5 text-left";

function rowCost(r: WorkRow): string {
    if (r.reported) {
        return usd(r.cost);
    }
    return r.unpriced ? "unpriced" : `≈ ${usd(r.cost)}`;
}

// The one ranked list of a By work page, paged: eight rows, then 25 more per press. On All usage, a project and an
// initiative a row opens its run or session; a run's own sessions are read-only rows.
function WorkListCard({
    list,
    shown,
    cursor,
    onOpen,
    onShown,
}: {
    list: WorkList;
    shown: number;
    cursor: string | undefined; // the row the keyboard cursor marks, not yet opened
    onOpen: (key: string) => void;
    onShown: (shown: number) => void;
}) {
    const page = listPageShown(list, shown);
    const rowsRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
        if (cursor != null) {
            rowsRef.current?.querySelector("[data-usage-cursor]")?.scrollIntoView({ block: "nearest" });
        }
    }, [cursor]);
    return (
        <div data-usage-list className={PANEL}>
            <SectionRule label={list.title} meta={list.meta} />
            {list.summary != null ? (
                <p className="mb-2.5 max-w-[680px] text-[12.5px] leading-[1.55] text-secondary">{list.summary}</p>
            ) : null}
            <div ref={rowsRef} className="flex flex-col">
                {page.rows.map((r) => {
                    const cells = (
                        <>
                            <span className="flex items-center justify-center text-ink-mid">
                                <RowIcon run={r.isRun} />
                            </span>
                            <span className="flex min-w-0 flex-col gap-0.5">
                                <span className="truncate text-[13px] font-semibold text-primary">{r.title}</span>
                                <span className="truncate text-[10.5px] tabular-nums text-muted">{r.sub}</span>
                            </span>
                            <Meter pct={r.pct} fill="bg-accent" height={7} radius={4} track="bg-edge-strong" />
                            <span className="text-right text-[11px] tabular-nums text-muted">{fmt(r.tokens)}</span>
                            <span className="flex flex-col items-end text-[12px] font-semibold tabular-nums text-secondary">
                                <span data-usage-cost>{rowCost(r)}</span>
                                {r.reported ? (
                                    <span data-usage-reported className="text-[10.5px] font-normal text-muted">
                                        reported
                                    </span>
                                ) : null}
                            </span>
                            <span className="flex text-ink-faint">{list.nav ? <Chevron /> : null}</span>
                        </>
                    );
                    return list.nav ? (
                        <button
                            key={r.key}
                            type="button"
                            data-usage-item={r.key}
                            data-usage-cursor={r.key === cursor ? "" : undefined}
                            onClick={() => onOpen(r.key)}
                            className={cn(
                                LIST_ROW,
                                "cursor-pointer hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
                                r.key === cursor && "rounded-[6px] ring-2 ring-inset ring-accent"
                            )}
                        >
                            {cells}
                        </button>
                    ) : (
                        <div key={r.key} data-usage-item={r.key} className={LIST_ROW}>
                            {cells}
                        </div>
                    );
                })}
            </div>
            {page.moreLabel != null || page.lessLabel != null ? (
                <div className="mt-3 flex gap-2">
                    {page.moreLabel != null ? (
                        <button
                            type="button"
                            data-usage-more
                            onClick={() => onShown(nextShown(shown, list.rows.length))}
                            className={cn(QUIET_BUTTON, "px-3 py-1.5 text-muted")}
                        >
                            {page.moreLabel}
                        </button>
                    ) : null}
                    {page.lessLabel != null ? (
                        <button
                            type="button"
                            data-usage-less
                            onClick={() => onShown(LIST_COLLAPSED_ROWS)}
                            className={cn(QUIET_BUTTON, "px-3 py-1.5 text-muted")}
                        >
                            {page.lessLabel}
                        </button>
                    ) : null}
                </div>
            ) : null}
        </div>
    );
}

// "Claude 1.2K · OpenCode 300" for a token card's secondary line
function harnessSub(byHarness: Record<string, number>): string {
    const parts = Object.entries(byHarness)
        .filter(([, n]) => n > 0)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([h, n]) => `${providerLabel(h)} ${fmt(n)}`);
    return parts.length > 0 ? parts.join(" · ") : "no usage in scope";
}

// The four stat cards. `all` is the unscoped page (it names the harnesses behind the token count); `of` is set on
// a narrower scope, whose cards say what share of everything they are.
function HistoryCards({
    stats,
    window: win,
    all,
    of,
    reveal,
}: {
    stats: UsageStats;
    window: "7d" | "all";
    all: boolean;
    of?: UsageStats;
    reveal: boolean;
}) {
    const t = stats.totals;
    const week = win === "7d";
    const span = week ? "7 days" : "all time";
    const tokens = week ? t.tokensWeek : t.tokensWindow;
    const spend = week ? t.spendWeekUsd : t.spendWindowUsd;
    const coverage = week ? t.pricingCoverageWeekPct : t.pricingCoverageWindowPct;
    const pricedTokens = week ? t.pricedTokensWeek : t.pricedTokensWindow;
    const reportedPresent = week ? t.reportedCostWeekPresent : t.reportedCostWindowPresent;
    const reportedUsd = week ? t.reportedCostWeekUsd : t.reportedCostWindowUsd;
    const sources = week ? t.reportedCostWeekHarnesses : t.reportedCostWindowHarnesses;

    const share = (part: number, whole: number) => pctStr(whole > 0 ? (part / whole) * 100 : 0);
    const allTokens = of ? (week ? of.totals.tokensWeek : of.totals.tokensWindow) : 0;
    const allSpend = of ? (week ? of.totals.spendWeekUsd : of.totals.spendWindowUsd) : 0;
    const tokenShare = of ? `${share(tokens, allTokens)} of all usage` : undefined;
    const priced = coverage == null ? "no priced tokens" : `${coverageStr(coverage)} of tokens priced`;
    const reportedSub = !reportedPresent
        ? "no source reports cost"
        : of
          ? "recorded by the source"
          : sources.length > 0
            ? `from ${sources.join(" · ")}`
            : "no source reports cost";

    return (
        <motion.div
            data-usage-stats
            variants={cardVariants}
            initial={reveal ? "initial" : false}
            animate="animate"
            className="grid grid-cols-2 gap-2.5 @4xl:grid-cols-4"
        >
            <StatCard
                label={`API-equivalent · ${span}`}
                value={estimateStr(spend, pricedTokens, tokens)}
                sub={of ? `${share(spend, allSpend)} of all spend · ${priced}` : priced}
            />
            <StatCard
                label={`Reported cost · ${span}`}
                value={reportedPresent ? usd(reportedUsd) : "—"}
                sub={reportedSub}
            />
            {week ? (
                <>
                    <StatCard label="Tokens · 7 days" value={fmt(t.tokensWeek)} sub={tokenShare} />
                    <StatCard
                        label="Tokens · today"
                        value={fmt(t.tokensToday)}
                        sub={all ? harnessSub(t.tokensTodayByHarness) : undefined}
                    />
                </>
            ) : (
                <>
                    <StatCard
                        label="Tokens · all time"
                        value={fmt(t.tokensWindow)}
                        sub={all ? harnessSub(t.tokensWindowByHarness) : tokenShare}
                    />
                    <StatCard
                        label="Daily avg"
                        value={fmt(t.activeDays > 0 ? t.tokensWindow / t.activeDays : 0)}
                        sub={`over ${t.activeDays} active day${t.activeDays === 1 ? "" : "s"}`}
                    />
                </>
            )}
        </motion.div>
    );
}

// Where it goes: the split's parts as a tokens bar and a spend bar, then one row per part with its share of each.
function WorkSplitCard({ split, scopeLabel }: { split: WorkSplit; scopeLabel: string }) {
    const tokTotal = split.parts.reduce((s, p) => s + p.tokens, 0);
    const spdTotal = split.parts.reduce((s, p) => s + p.spendUsd, 0);
    const share = (n: number, total: number) => pctStr(total > 0 ? (n / total) * 100 : 0);
    return (
        <div data-usage-split className={cn(PANEL, "flex min-w-0 flex-col")}>
            <SectionRule label="Where it goes" meta={`${scopeLabel} · by spend`} />
            <p className="mb-3.5 text-[11px] leading-[1.5] text-muted">{split.note}</p>
            <div className="mb-1.5 flex items-baseline justify-between">
                <span className="text-[10.5px] font-semibold text-ink-mid">Tokens</span>
                <span className="text-[11.5px] font-bold tabular-nums text-primary">{fmt(tokTotal)}</span>
            </div>
            <StackedMeter
                className="mb-2.5"
                height={8}
                radius={4}
                track="bg-background"
                segs={split.parts.map((p) => ({ key: p.key, value: p.tokens, fill: p.fill }))}
            />
            <div className="mb-1.5 flex items-baseline justify-between">
                <span className="text-[10.5px] font-semibold text-ink-mid">
                    Spend <span className="font-medium text-muted">≈ API-equiv</span>
                </span>
                <span className="text-[11.5px] font-bold tabular-nums text-primary">{usd(spdTotal)}</span>
            </div>
            <StackedMeter
                className="mb-3"
                height={8}
                radius={4}
                track="bg-background"
                segs={split.parts.map((p) => ({ key: p.key, value: p.spendUsd, fill: p.fill }))}
            />
            <div className="flex flex-col gap-1.5">
                {split.parts.map((p) => (
                    <span
                        key={p.key}
                        data-usage-split-row
                        className="flex min-w-0 items-center gap-1.5 text-[10.5px] tabular-nums text-secondary"
                        title={`${p.label}: ${fmt(p.tokens)} tokens · ${usd(p.spendUsd)}`}
                    >
                        <span className={cn("h-2 w-2 flex-none rounded-[2px]", p.fill)} />
                        <span className="min-w-0 flex-1 truncate">{p.label}</span>
                        <span className="flex-none text-muted">
                            {share(p.tokens, tokTotal)} · {share(p.spendUsd, spdTotal)}
                        </span>
                    </span>
                ))}
            </div>
        </div>
    );
}

function StatsSkeleton() {
    return (
        <div data-usage-skeleton className="grid grid-cols-2 gap-2.5 @4xl:grid-cols-4">
            {[0, 1, 2, 3].map((i) => (
                <div key={i} className="rounded-[11px] border border-border bg-surface-raised px-3.5 py-3">
                    <SkeletonLine className="mb-2.5 h-[10px] w-[72px]" />
                    <SkeletonLine className="mb-2 h-[17px] w-[64px]" />
                    <SkeletonLine className="h-[10px] w-[96px]" />
                </div>
            ))}
        </div>
    );
}

function BreakdownSkeleton() {
    return (
        <div data-usage-skeleton className="grid grid-cols-1 gap-3.5 @4xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
            <div className={cn(PANEL, "h-[190px]")}>
                <SkeletonLine className="mb-3 h-[11px] w-[64px]" />
                <div className="flex h-[96px] items-end gap-[7px] border-b border-l border-border px-1">
                    {["h-[28px]", "h-[52px]", "h-[40px]", "h-[72px]", "h-[46px]", "h-[84px]", "h-[58px]"].map((h) => (
                        <SkeletonLine key={h} className={cn("flex-1 rounded-t-[3px]", h)} />
                    ))}
                </div>
            </div>
            <div className={PANEL}>
                <SkeletonLine className="mb-3 h-[11px] w-[96px]" />
                <SkeletonLine className="mb-3 h-[8px] w-full rounded-[4px]" />
                <SkeletonLine className="h-[8px] w-full rounded-[4px]" />
            </div>
        </div>
    );
}

export function WorkLens({ model, lensSwitch }: { model: AgentsViewModel; lensSwitch: ReactNode }) {
    const allStats: UsageStats = useAtomValue(allUsageStatsAtom);
    const buckets = useAtomValue(usageBucketsAtom);
    const sessions = useAtomValue(usageSessionsAtom);
    const efforts = useAtomValue(usageEffortsAtom);
    const loadError = useAtomValue(usageErrorAtom);
    const usageLoaded = useAtomValue(usageLoadedAtom);
    const heldWindow = useAtomValue(usageHeldWindowAtom);
    const [usageWindow, setUsageWindow] = useAtom(usageWindowAtom);
    const [usageMetric, setUsageMetric] = useAtom(usageMetricAtom);
    const [workScope, setWorkScope] = useAtom(usageWorkScopeAtom);
    const [workItem, setWorkItem] = useAtom(usageWorkItemAtom);
    const [listShown, setListShown] = useAtom(usageListShownAtom);
    const requestedDays = usageWindow === "7d" ? 7 : 0;
    const loadView = usageLoadView(requestedDays, heldWindow, usageLoaded, loadError);

    const attr = useMemo(() => buildAttribution(buckets, sessions, efforts), [buckets, sessions, efforts]);
    const scope = useMemo(() => resolveScope(attr, workScope, workItem?.key ?? null), [attr, workScope, workItem]);
    const stats = useMemo(() => {
        if (scope.kind === "all") {
            return allStats;
        }
        const at = Date.now();
        return aggregateBuckets(scopeBuckets(buckets, attr, scope), at, "all", windowStartDay(heldWindow, at));
    }, [allStats, buckets, attr, scope, heldWindow]);

    const selectWork = useCallback(
        (scopeKey: string) => {
            setWorkScope(scopeKey);
            setWorkItem(null);
            setListShown(LIST_COLLAPSED_ROWS);
        },
        [setWorkScope, setWorkItem, setListShown]
    );
    const pickWindow = (next: "7d" | "all") => {
        setUsageWindow(next);
        selectWork(ALL_SCOPE);
    };
    const openItem = useCallback(
        (key: string) => {
            const item = attr.items.find((it) => it.key === key);
            if (!item) {
                return;
            }
            setWorkItem({ key, back: workScope });
            setWorkScope(itemScopeKey(attr, item));
            setListShown(LIST_COLLAPSED_ROWS);
        },
        [attr, workScope, setWorkItem, setWorkScope, setListShown]
    );

    // A project or initiative that left the rail takes its drilled item with it, and an item the window no longer
    // holds falls back to the scope it sat under. Only once loaded: an empty rail mid-load would otherwise reset a
    // deliberate selection on every window switch.
    useEffect(() => {
        if (!usageLoaded) {
            return;
        }
        const onRail =
            attr.projects.some((p) => p.key === workScope) || attr.initiatives.some((i) => i.key === workScope);
        if (workScope !== ALL_SCOPE && !onRail) {
            selectWork(ALL_SCOPE);
        } else if (workItem != null && !attr.items.some((it) => it.key === workItem.key)) {
            setWorkItem(null);
        }
    }, [usageLoaded, attr, workScope, workItem, selectWork, setWorkItem]);

    // a new page starts at its top: the range, scope or item changed (the 60s refresh changes none)
    const detailRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
        detailRef.current?.scrollTo(0, 0);
    }, [usageWindow, workScope, workItem?.key]);

    const hasHistory = stats.providers.length > 0 || stats.totals.tokensWindow > 0;
    const windowLabel = usageWindow === "7d" ? "last 7 days" : "all time";
    const list = useMemo(() => scopeList(attr, scope, windowLabel), [attr, scope, windowLabel]);
    const shownList =
        list != null && hasHistory && loadView !== "skeleton" && loadView !== "switch-failed" ? list : null;
    // the held buckets belong to the other range, so the cards show no figure from them
    const switchFailed = loadView === "switch-failed" ? `The ${windowLabel} scan failed` : undefined;
    const sharePill = (pct: number) => (switchFailed ? HELD_DASH : pctStr(pct));

    // the keyboard cursor walks the scope cards, then the rows the list shows when a row opens something. A row
    // cursor only marks its row; it holds for the page it was set on.
    const here = scopeId(scope);
    const [rowCursor, setRowCursor] = useState<{ at: string; key: string } | null>(null);
    const rowKeys = useMemo(
        () => (shownList?.nav ? listPageShown(shownList, listShown).rows.map((r) => r.key) : []),
        [shownList, listShown]
    );
    const cursorRow = rowCursor?.at === here && rowKeys.includes(rowCursor.key) ? rowCursor.key : undefined;
    const listNav = useMemo<ListNavController>(() => {
        const scopeIds = [ALL_SCOPE, ...attr.projects.map((p) => p.key), ...attr.initiatives.map((i) => i.key)];
        return {
            surface: "usage",
            navigableIds: usageNavIds(scopeIds, rowKeys),
            cursorId: cursorRow ?? (workItem != null ? undefined : workScope),
            setCursor: (id) => {
                const cursor = resolveUsageCursor(id, scopeIds);
                if (cursor.kind === "row") {
                    setRowCursor({ at: here, key: cursor.id });
                    return;
                }
                setRowCursor(null);
                selectWork(cursor.id);
            },
            activate: () => {
                if (cursorRow != null) {
                    openItem(cursorRow);
                } else if (rowKeys.length > 0) {
                    setRowCursor({ at: here, key: rowKeys[0] });
                }
            },
        };
    }, [attr, rowKeys, cursorRow, here, openItem, workItem, workScope, selectWork]);
    useSurfaceListNav(listNav);

    const all = scope.kind === "all";
    const revealHistory = useDidBecomeTrue(hasHistory);
    const scopeLabel = scope.kind === "item" ? scope.item.title : all ? "all usage" : scopeName(attr, workScope);

    const run = scope.kind === "item" && scope.item.runId != null ? scope.item : null;
    const openRun =
        run != null ? (
            <button
                type="button"
                data-usage-open-run
                onClick={() =>
                    fireAndForget(() =>
                        openTarget(
                            model,
                            run.channelId != null
                                ? { kind: "channel", channelId: run.channelId, runId: run.runId }
                                : { kind: "run", runId: run.runId! }
                        )
                    )
                }
                className={cn(QUIET_BUTTON, "flex-none px-3 py-[7px] text-secondary")}
            >
                Open run
            </button>
        ) : null;
    const head = workHead(scope, stats, openRun);
    const split = scopeSplit(attr, scope, stats.split);

    return (
        <MotionConfig reducedMotion="user">
            <div className="flex h-full min-h-0 flex-col bg-background">
                <SurfaceHeader
                    title="Usage"
                    subtitle={
                        <span className="block max-w-[680px] leading-[1.5]">
                            What the usage paid for: all of it, a project, an initiative, a run or a session. Spend is
                            an estimate from a bundled price table, not a bill.
                        </span>
                    }
                    actions={
                        <>
                            {lensSwitch}
                            <Segmented<"7d" | "all">
                                value={usageWindow}
                                onChange={pickWindow}
                                options={RANGE_OPTIONS}
                                role="group"
                                ariaLabel="Range"
                            />
                        </>
                    }
                />

                {loadView === "data-with-error" ? (
                    <SurfaceError message="Couldn’t refresh — showing the last loaded usage." />
                ) : null}

                <div
                    data-usage-scopes
                    role="group"
                    aria-label="Scope"
                    className="flex flex-none items-stretch gap-2.5 overflow-x-auto border-b border-edge-faint px-5 py-3"
                >
                    <ScopeCard
                        harness={ALL_SCOPE}
                        active={all}
                        onSelect={() => selectWork(ALL_SCOPE)}
                        dot="bg-accent"
                        name="All usage"
                        pill="All"
                        tokens={allStats.totals.tokensWindow}
                        estimate={estimateStr(
                            allStats.totals.spendWindowUsd,
                            allStats.totals.pricedTokensWindow,
                            allStats.totals.tokensWindow
                        )}
                        fact="every transcript"
                        failed={switchFailed}
                    />
                    {attr.projects.map((p) => (
                        <ScopeCard
                            key={p.key}
                            project={p.key}
                            title={p.key}
                            active={workScope === p.key}
                            onSelect={() => selectWork(p.key)}
                            dot={p.fill}
                            name={p.label}
                            pill={sharePill(p.sharePct)}
                            tokens={p.tokens}
                            estimate={estimateStr(p.spendUsd, p.pricedTokens, p.tokens)}
                            fact={plural(p.count, "run or session", "runs and sessions")}
                            failed={switchFailed}
                        />
                    ))}
                    {attr.other.count > 0 && !switchFailed ? (
                        <span
                            data-usage-other
                            className="min-w-[180px] max-w-[240px] flex-1 text-[10.5px] leading-[1.5] tabular-nums text-muted"
                        >
                            {otherFoldersText(attr.other)}
                        </span>
                    ) : null}
                    {attr.initiatives.length > 0 ? (
                        <span aria-hidden="true" className="w-px flex-none bg-edge-faint" />
                    ) : null}
                    {attr.initiatives.map((i) => (
                        <ScopeCard
                            key={i.key}
                            initiative={i.oid}
                            title={i.label}
                            active={workScope === i.key}
                            onSelect={() => selectWork(i.key)}
                            dot={INITIATIVE_DOT}
                            name={i.label}
                            pill={sharePill(i.sharePct)}
                            tokens={i.tokens}
                            estimate={estimateStr(i.spendUsd, i.pricedTokens, i.tokens)}
                            fact={plural(i.count, "run or session", "runs and sessions")}
                            failed={switchFailed}
                        />
                    ))}
                </div>

                <div
                    ref={detailRef}
                    role="tabpanel"
                    data-usage-detail={scopeId(scope)}
                    className="@container min-h-0 min-w-0 flex-1 overflow-y-auto"
                >
                    <div className="flex flex-col gap-5 px-7 pb-12 pt-[18px]">
                        {loadView === "switch-failed" ? (
                            <div data-usage-switch-failed>
                                <SurfaceEmptyState
                                    className="px-0"
                                    title={`Couldn’t load usage for ${usageWindow === "7d" ? "the last 7 days" : "all time"}`}
                                    body="The usage scan for this range failed. The range loaded before it still holds its usage."
                                    secondaryAction={{ label: "Retry", onClick: () => void loadUsage(requestedDays) }}
                                />
                            </div>
                        ) : (
                            <>
                                {workItem != null && scope.kind === "item" ? (
                                    <button
                                        type="button"
                                        data-usage-back
                                        onClick={() => selectWork(workItem.back)}
                                        className={cn(
                                            QUIET_BUTTON,
                                            "-mb-1.5 flex items-center gap-1.5 self-start py-[5px] pl-[7px] pr-[11px] text-ink-mid"
                                        )}
                                    >
                                        <Chevron back />
                                        Back to {scopeName(attr, workItem.back)}
                                    </button>
                                ) : null}

                                <DetailHeader head={head} />

                                <section className="flex min-w-0 flex-col">
                                    <SectionRule label="Historical" meta={`durable · ${windowLabel}`} />
                                    {loadView === "skeleton" ? (
                                        <StatsSkeleton />
                                    ) : !hasHistory ? (
                                        <div
                                            data-usage-empty
                                            className="flex min-h-[92px] flex-1 items-center justify-center text-[13px] text-muted"
                                        >
                                            No usage in this window{all ? " — start an agent." : "."}
                                        </div>
                                    ) : (
                                        <HistoryCards
                                            stats={stats}
                                            window={usageWindow}
                                            all={all}
                                            of={all ? undefined : allStats}
                                            reveal={revealHistory}
                                        />
                                    )}
                                </section>

                                {loadView === "skeleton" ? (
                                    <BreakdownSkeleton />
                                ) : hasHistory ? (
                                    <motion.div
                                        variants={cardVariants}
                                        initial={revealHistory ? "initial" : false}
                                        animate="animate"
                                        className="flex flex-col gap-5"
                                    >
                                        {shownList != null ? (
                                            <WorkListCard
                                                list={shownList}
                                                shown={listShown}
                                                cursor={cursorRow}
                                                onOpen={openItem}
                                                onShown={setListShown}
                                            />
                                        ) : null}

                                        <div className="grid grid-cols-1 gap-3.5 @4xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
                                            <div
                                                data-usage-daily
                                                data-usage-daily-days={stats.daily.length}
                                                className="flex min-w-0 flex-col [&>*]:flex-1"
                                            >
                                                <DailyChart
                                                    daily={stats.daily}
                                                    window={usageWindow}
                                                    metric={usageMetric}
                                                    onMetric={setUsageMetric}
                                                    harnesses={stats.availableHarnesses}
                                                />
                                            </div>
                                            <WorkSplitCard split={split} scopeLabel={scopeLabel} />
                                        </div>
                                    </motion.div>
                                ) : null}
                            </>
                        )}
                    </div>
                </div>
            </div>
        </MotionConfig>
    );
}
