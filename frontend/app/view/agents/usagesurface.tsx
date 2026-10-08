// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Usage surface (handoff redesign: Wave-usage-redesign.dc.html artboard 1B). Provider tabs across the top
// (one per harness with usage or a quota reading, busiest first, then All) over a full-width pane holding that
// provider's two trust zones — LIVE LIMITS (ephemeral 5h/weekly quota, merged live-over-saved via
// ratelimitstore so it survives idle) and HISTORICAL (durable token-class split, daily series, per-model
// breakdown, folded from the backend usage scan). The selected tab IS usageHarnessFilterAtom, so the scope
// picker and the historical filter are one piece of state rather than two that can disagree; that atom
// re-aggregates model.usageStatsAtom, so the pane is simply the surface scoped to one harness.
// Loads on mount + a 60s refresh for the current window; a 1s tick keeps reset countdowns current.
// On the Claude tab two more sections sit between the two zones and the charts: INSIGHTS (an Analyze button that has
// Claude read a numbers-only digest, usageinsights.ts) and BY SESSION (one row per Claude tab, usagesessions.ts). They
// load per window, not on the 60s tick: a session scan reads every transcript line by line.

import { Meter, StackedMeter } from "@/app/element/meter";
import { useDidBecomeTrue } from "@/app/element/motionhooks";
import { cardVariants } from "@/app/element/motiontokens";
import { Segmented } from "@/app/element/segmented";
import { SkeletonLine } from "@/app/element/skeleton";
import { buildUsageBindings } from "@/app/store/keybindings/bindings";
import { useSurfaceListNav, type ListNavController } from "@/app/store/keybindings/listnav";
import { useKeybindings } from "@/app/store/keybindings/store";
import { REGION_LABEL } from "@/app/view/jarvis/briefstyle";
import { openTarget } from "@/app/view/jarvis/openref";
import { cn } from "@/util/util";
import { useAtom, useAtomValue } from "jotai";
import { motion, MotionConfig } from "motion/react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, type ReactNode } from "react";
import { showSession } from "./agentcenter";
import type { AgentsViewModel } from "./agents";
import { formatReset, moveCursor, usageLevel } from "./agentsviewmodel";
import { providerDot, providerLabel } from "./cockpitrailmodel";
import { DailyChart } from "./dailychart";
import { harnessesAtom } from "./harnessstore";
import {
    activeClaudeAccountAtom,
    activeClaudeKeyAtom,
    claudeIdentityAtom,
    planDonuts,
    savedRateLimitsAtom,
    type DonutWindow,
} from "./ratelimitstore";
import { sessionKey } from "./sessionsruns";
import { SurfaceError, SurfaceHeader } from "./surfacescaffold";
import { buildUsageDigest } from "./usagedigest";
import { insightsCard, insightsHeld } from "./usageinsights";
import { UsageInsightsCard } from "./usageinsightscard";
import {
    analyzeUsage,
    devHeldPct,
    insightsErrorAtom,
    insightsRunningAtom,
    loadSavedInsights,
    loadSessionUsage,
    savedInsightsAtom,
    sessionShowAllAtom,
    sessionUsageAtom,
    sessionUsageLoadedAtom,
    usageSessionCursorAtom,
} from "./usageinsightsstore";
import { kpiGridClass, soloHarness, statGridClass, visibleClasses } from "./usagelayout";
import {
    buildUsageRail,
    countReporting,
    defaultTab,
    railRows,
    tabMeta,
    tabRows,
    worstWindow,
    type AggregateWindow,
    type UsageRailRow,
} from "./usagerail";
import { showUsageRefresh } from "./usagerefresh";
import { UsageRefreshButton } from "./usagerefreshbutton";
import { buildSessionRows, liveSessionTabs, visibleSessionRows, type SessionRow } from "./usagesessions";
import { UsageSessionTable } from "./usagesessiontable";
import type { ClassUsage, ProviderUsage, UsageStats } from "./usagestats";
import { aggregateBuckets, CLASS_FILL, fmt, foldModels, usd } from "./usagestats";
import {
    allUsageStatsAtom,
    loadUsage,
    usageBucketsAtom,
    usageErrorAtom,
    usageLoadedAtom,
    usageMetricAtom,
    usageTabChosenAtom,
    usageWindowAtom,
} from "./usagestore";
import { formatProjectedDate, projectWeeklyExhaustion } from "./weeklyforecast";

const ALL = "all";
// daily, where it goes and models in one row of three cards (one column below the breakpoint); the cards in a row
// stretch to the tallest
const CHART_ROW = "grid grid-cols-1 gap-3.5 @6xl:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)_minmax(0,1fr)]";
const CARD = "flex min-w-0 flex-col rounded-[14px] border border-border bg-surface-raised px-[18px] py-4";

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

// The underline tab of the details rail (TAB / TAB_ON / TAB_OFF in agentrailpanel.tsx), sized for a provider
// name, its state pill and its meta rather than an icon.
const TAB =
    "flex h-10 flex-none cursor-pointer items-center gap-2 border-0 border-b-2 bg-transparent px-3.5 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent";
const TAB_ON = "border-primary text-primary";
const TAB_OFF = "border-transparent text-muted hover:text-secondary";

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
function SectionRule({
    label,
    meta,
    accent = false,
    action,
}: {
    label: string;
    meta?: string;
    accent?: boolean;
    action?: ReactNode;
}) {
    return (
        <div className="mb-3 flex items-center gap-2.5">
            <h3 className={cn(REGION_LABEL, accent ? "text-accent-soft" : "text-muted")}>{label}</h3>
            <div className="h-px flex-1 bg-edge-faint" />
            {meta != null ? <span className="text-[10.5px] tabular-nums text-muted">{meta}</span> : null}
            {action}
        </div>
    );
}

type StatCardProps = { label: string; value: string; sub?: string };

// One anatomy for every KPI tile, limit or stat (label, value, then a bar or a sub line), so the two
// groups sharing the kpi row line up label to label and value to value.
const TILE = "rounded-[11px] border border-border bg-surface-raised px-3.5 py-3";
const TILE_LABEL = "mb-1.5 text-[10.5px] tabular-nums text-muted";
const TILE_VALUE = "text-[17px] font-bold tabular-nums";

function StatCard({ label, value, sub }: StatCardProps) {
    return (
        <div className={TILE}>
            <div className={cn(TILE_LABEL, "truncate")}>{label}</div>
            <div className={cn(TILE_VALUE, "text-primary")}>{value}</div>
            {sub ? (
                <div className="mt-2 truncate text-[10.5px] tabular-nums text-muted" title={sub}>
                    {sub}
                </div>
            ) : null}
        </div>
    );
}

// One quota window as a tile with a thin bar. `used` carries the source harness on the aggregate row,
// where "62%" alone would not say whose account it describes.
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
        <div data-usage-limit={kind} className={TILE}>
            <div className={cn(TILE_LABEL, "flex justify-between gap-2")}>
                <span className="truncate">{used ? `${title} · ${used}` : title}</span>
                <span className="flex-none whitespace-nowrap">
                    {w.reset ? "resets " + formatReset(w.reset, now) : "—"}
                </span>
            </div>
            <div className={cn(TILE_VALUE, "mb-2", has ? LEVEL_TEXT[level] : "text-muted")}>
                {has ? Math.round(w.pct!) + "%" : "—"}
            </div>
            <Meter pct={w.pct ?? 0} fill={has ? LEVEL_FILL[level] : "bg-edge-strong"} height={4} radius={2} />
            {projectedExhaustion != null ? (
                <div className="mt-1.5 text-[10.5px] tabular-nums text-warning">
                    ~100% by {formatProjectedDate(projectedExhaustion)}
                </div>
            ) : null}
        </div>
    );
}

// One tab per harness, then All at the right end. `data-usage-harness` is what the CDP scenarios select a scope
// by. The state pill is never colour alone: it names LIVE or SAVED, and a provider with no quota reading shows
// its tokens instead (tabMeta).
function UsageTab({
    id,
    row,
    active,
    now,
    allTokens,
    onSelect,
}: {
    id: string;
    row?: UsageRailRow;
    active: boolean;
    now: number;
    allTokens: number;
    onSelect: (id: string) => void;
}) {
    const st = row != null && row.state !== "none" ? stateMeta(row, now) : null;
    return (
        <button
            type="button"
            role="tab"
            data-usage-harness={id}
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            onClick={() => onSelect(id)}
            className={cn(TAB, active ? TAB_ON : TAB_OFF)}
        >
            {row != null ? (
                <span className={cn("h-2 w-2 flex-none rounded-full", providerDot(id))} />
            ) : (
                <span className="flex-none text-[12px] text-accent-soft">Σ</span>
            )}
            <span className={cn("text-[13px]", active ? "font-semibold" : "font-medium")}>
                {row != null ? providerLabel(id) : "All"}
            </span>
            {st != null ? (
                <span
                    className="flex-none rounded-[4px] px-[5px] py-px text-[9.5px] font-bold uppercase tabular-nums tracking-[0.06em]"
                    style={{ color: st.color, backgroundColor: PILL_TINT }}
                >
                    {st.label}
                </span>
            ) : null}
            <span className="flex-none whitespace-nowrap text-[10.5px] tabular-nums text-muted">
                {row != null ? tabMeta(row) : `${fmt(allTokens)} tok`}
            </span>
        </button>
    );
}

function UsageTabs({
    rows,
    sel,
    now,
    allTokens,
    onSelect,
}: {
    rows: UsageRailRow[];
    sel: string;
    now: number;
    allTokens: number;
    onSelect: (id: string) => void;
}) {
    return (
        <div
            role="tablist"
            aria-label="Provider"
            className="flex flex-none items-end gap-0.5 overflow-x-auto border-b border-edge-faint px-5"
        >
            {tabRows(rows).map((r) => (
                <UsageTab
                    key={r.harness}
                    id={r.harness}
                    row={r}
                    active={sel === r.harness}
                    now={now}
                    allTokens={allTokens}
                    onSelect={onSelect}
                />
            ))}
            <div className="min-w-3 flex-1" />
            <UsageTab id={ALL} active={sel === ALL} now={now} allTokens={allTokens} onSelect={onSelect} />
        </div>
    );
}

function SplitCard({ split: all }: { split: ClassUsage[] }) {
    const split = visibleClasses(all);
    const tokTotal = split.reduce((s, c) => s + c.tokens, 0);
    const spdTotal = split.reduce((s, c) => s + c.spendUsd, 0);
    const cacheRead = split.find((c) => c.cls === "cacheRead");
    const cachePct = tokTotal > 0 && cacheRead ? (cacheRead.tokens / tokTotal) * 100 : 0;
    const share = (n: number, total: number) => pctStr(total > 0 ? (n / total) * 100 : 0);
    return (
        <div className={CARD}>
            <SectionRule label="Where it goes" meta="tokens · spend" />
            <p className="mb-3.5 text-[11px] leading-[1.5] text-muted">
                {pctStr(cachePct)} of tokens are cache reads, priced far below input.
            </p>

            <div className="mb-1.5 flex items-baseline justify-between">
                <span className="text-[10.5px] font-semibold text-ink-mid">Tokens</span>
                <span className="text-[11.5px] font-bold tabular-nums text-primary">{fmt(tokTotal)}</span>
            </div>
            <StackedMeter
                className="mb-2.5"
                height={8}
                radius={4}
                track="bg-background"
                segs={split.map((c) => ({ key: c.cls, value: c.tokens, fill: CLASS_FILL[c.cls] }))}
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
                segs={split.map((c) => ({ key: c.cls, value: c.spendUsd, fill: CLASS_FILL[c.cls] }))}
            />

            {/* a 2x2 legend: each class with its share of tokens, then of spend; the absolute numbers are in
                the tooltip */}
            <div className="grid grid-cols-2 gap-x-3.5 gap-y-1.5">
                {split.map((c) => (
                    <span
                        key={c.cls}
                        className="flex min-w-0 items-center gap-1.5 text-[10.5px] tabular-nums text-secondary"
                        title={`${c.label}: ${fmt(c.tokens)} tokens · ${usd(c.spendUsd)}`}
                    >
                        <span className={cn("h-2 w-2 flex-none rounded-[2px]", CLASS_FILL[c.cls])} />
                        <span className="min-w-0 flex-1 truncate">{c.label}</span>
                        <span className="flex-none text-muted">
                            {share(c.tokens, tokTotal)} · {share(c.spendUsd, spdTotal)}
                        </span>
                    </span>
                ))}
            </div>
        </div>
    );
}

// Grouped by UPSTREAM provider ("anthropic" | "openai"), which is what the transcript buckets carry —
// deliberately a different axis from the provider tabs, so the card's meta names the provider raw.
function ModelGroup({ p }: { p: ProviderUsage }) {
    return (
        <div className={CARD}>
            <SectionRule label="Models" meta={`${p.provider} · ${fmt(p.tokens)}`} />
            {foldModels(p.models, MAX_MODEL_ROWS).map((m, i) => (
                <div key={m.model} className="mb-2.5 last:mb-0">
                    <div className="mb-1 flex items-baseline justify-between gap-3">
                        {/* the provider is in the card's meta, so the name drops its prefix; the title keeps the
                            full id, which is what tells Pi's openai-codex/gpt-5.5 from Codex's openai/gpt-5.5 —
                            same model id, different upstream bucket */}
                        <span
                            className="min-w-0 truncate text-[11px] tabular-nums text-secondary"
                            title={m.model === "Other" ? m.model : `${p.provider}/${m.model}`}
                        >
                            {m.model}
                        </span>
                        <span className="flex-none text-[10.5px] tabular-nums text-muted">
                            {fmt(m.tokens)} · <span className="font-semibold text-secondary">{pctStr(m.pct)}</span>
                        </span>
                    </div>
                    <Meter pct={m.pct} fill={MODEL_SEQ[i]} height={5} radius={3} track="bg-edge-strong" />
                </div>
            ))}
        </div>
    );
}

function StatTilesSkeleton() {
    return (
        <div className="grid grid-cols-3 gap-2.5">
            {[0, 1, 2].map((i) => (
                <div key={i} className={TILE}>
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
        <div className={CHART_ROW}>
            <div className={CARD}>
                <SkeletonLine className="mb-3 h-[11px] w-[64px]" />
                <div className="flex h-[96px] items-end gap-[7px] border-b border-l border-border px-1">
                    <SkeletonLine className="h-[28px] flex-1 rounded-t-[3px]" />
                    <SkeletonLine className="h-[52px] flex-1 rounded-t-[3px]" />
                    <SkeletonLine className="h-[40px] flex-1 rounded-t-[3px]" />
                    <SkeletonLine className="h-[72px] flex-1 rounded-t-[3px]" />
                    <SkeletonLine className="h-[46px] flex-1 rounded-t-[3px]" />
                    <SkeletonLine className="h-[84px] flex-1 rounded-t-[3px]" />
                    <SkeletonLine className="h-[58px] flex-1 rounded-t-[3px]" />
                </div>
            </div>
            <div className={CARD}>
                <SkeletonLine className="mb-3 h-[11px] w-[96px]" />
                <SkeletonLine className="mb-3 h-[11px] w-[80%]" />
                <SkeletonLine className="mb-3 h-[8px] w-full rounded-[4px]" />
                <SkeletonLine className="h-[8px] w-full rounded-[4px]" />
            </div>
            <div className={CARD}>
                <SkeletonLine className="mb-3 h-[11px] w-[56px]" />
                <SkeletonLine className="mb-2.5 h-[5px] w-full rounded-[3px]" />
                <SkeletonLine className="mb-2.5 h-[5px] w-full rounded-[3px]" />
                <SkeletonLine className="h-[5px] w-full rounded-[3px]" />
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
    const activeKey = useAtomValue(activeClaudeKeyAtom);
    const activeAccount = useAtomValue(activeClaudeAccountAtom);
    const identity = useAtomValue(claudeIdentityAtom);
    const now = useAtomValue(model.nowAtom);
    const [usageWindow, setUsageWindow] = useAtom(usageWindowAtom);
    const [usageMetric, setUsageMetric] = useAtom(usageMetricAtom);
    // the selected tab and the historical scope filter are the same state, by construction
    const [sel, setSel] = useAtom(model.usageHarnessFilterAtom);
    const [tabChosen, setTabChosen] = useAtom(usageTabChosenAtom);
    // a click or a key is the person's choice; the default tab below stops following the busiest provider
    const pickTab = useCallback(
        (id: string) => {
            setTabChosen(true);
            setSel(id);
        },
        [setTabChosen, setSel]
    );

    useEffect(() => {
        const days = usageWindow === "7d" ? 7 : 0;
        void loadUsage(days);
        const refresh = setInterval(() => void loadUsage(days), 60_000);
        return () => clearInterval(refresh);
    }, [usageWindow]);

    // The By session table and the saved analysis load with the window but not on the 60s tick above: a session
    // scan reads every transcript line by line.
    const windowDays = usageWindow === "7d" ? 7 : 0;
    useEffect(() => {
        void loadSessionUsage(windowDays);
        void loadSavedInsights();
    }, [windowDays]);
    const sessions = useAtomValue(sessionUsageAtom);
    const sessionsLoaded = useAtomValue(sessionUsageLoadedAtom);
    const buckets = useAtomValue(usageBucketsAtom);
    const savedInsights = useAtomValue(savedInsightsAtom);
    const insightsRunning = useAtomValue(insightsRunningAtom);
    const insightsError = useAtomValue(insightsErrorAtom);
    const [showAllSessions, setShowAllSessions] = useAtom(sessionShowAllAtom);
    const [sessionCursor, setSessionCursor] = useAtom(usageSessionCursorAtom);

    const harnesses = useAtomValue(harnessesAtom);
    const catalogOrder = useMemo(() => harnesses.map((h) => h.runtime), [harnesses]);
    const donuts = planDonuts(agents, saved, activeKey, identity, now);
    const refreshShown = showUsageRefresh(
        donuts.filter((d) => d.fivehour.pct != null || d.week.pct != null).map((d) => d.provider),
        activeAccount
    );
    const groups = useMemo(
        () => buildUsageRail(allStats.availableHarnesses, allStats.daily, donuts, catalogOrder),
        [allStats.availableHarnesses, allStats.daily, donuts, catalogOrder]
    );
    const rows = useMemo(() => railRows(groups), [groups]);
    // with one harness there is nothing to pick: no rail, and the detail is that harness, not an
    // "all providers" aggregate of one
    const solo = soloHarness(rows);
    const scope = solo ?? sel;
    const selRow = rows.find((r) => r.harness === scope);

    // usageHarnessFilterAtom is the one selection (model.usageStatsAtom re-aggregates by it), so the default tab
    // is written into it rather than computed beside it: the KPIs, the charts and anything scoped to the tab
    // read the harness the person sees. Until they pick a tab that is the busiest provider; the layout effect
    // keeps the frame after the first load from painting the aggregate. Only once loaded — an empty tab strip
    // mid-load would otherwise reset the selection on every window switch.
    // After a pick, a window reload can remove the selected harness from the tabs (its history falls outside
    // the window and it reports no quota): fall back to the aggregate so the pane never points at a tab that
    // isn't there.
    useLayoutEffect(() => {
        if (!usageLoaded) {
            return;
        }
        if (!tabChosen) {
            const dflt = defaultTab(rows);
            if (sel !== dflt) {
                setSel(dflt);
            }
        } else if (sel !== ALL && !rows.some((r) => r.harness === sel)) {
            setSel(ALL);
        }
    }, [usageLoaded, tabChosen, rows, sel, setSel]);

    // the ids in the order the strip draws them; none when the strip is hidden for a lone provider
    const tabIds = useMemo(() => (solo != null ? [] : [...tabRows(rows).map((r) => r.harness), ALL]), [solo, rows]);

    // Claude's sessions: rows for the By session table, the Insights card's state, and whether Analyze is held.
    // All of it is for the Claude tab only; elsewhere the lists stay empty and nothing is published to the list nav.
    const claude = scope === "claude";
    const windowLabel = usageWindow === "7d" ? "last 7 days" : "all time";
    const sessionRows = useMemo(
        () => (claude ? buildSessionRows(sessions, liveSessionTabs(agents)) : []),
        [claude, sessions, agents]
    );
    const visibleRows = useMemo(() => visibleSessionRows(sessionRows, showAllSessions), [sessionRows, showAllSessions]);
    const insights = insightsCard({
        sessionCount: sessionRows.length,
        saved: savedInsights,
        running: insightsRunning,
        error: insightsError,
        windowDays,
        now,
    });
    // Claude's 5-hour and weekly windows, as Live limits reads them. A dev fixture can stand in for the 5-hour one.
    const claudeDonut = donuts.find((d) => d.provider === "claude");
    const heldPct = devHeldPct();
    const heldWindows: DonutWindow[] = [
        heldPct != null ? { ...claudeDonut?.fivehour, pct: heldPct } : (claudeDonut?.fivehour ?? {}),
        claudeDonut?.week ?? {},
    ];
    const held = insightsHeld(heldWindows, now);

    // The digest is built when Analyze runs, not on every render. It does nothing off the Claude tab, with no
    // sessions to read, or while an analysis runs or is held. The `a` key reaches it through a ref, since the
    // bindings below are built once.
    const analyze = () => {
        if (!claude || sessionRows.length === 0 || insightsRunning || held != null) {
            return;
        }
        const digest = buildUsageDigest({
            windowLabel,
            stats: aggregateBuckets(buckets, Date.now(), "claude"),
            rows: sessionRows,
        });
        void analyzeUsage(windowDays, digest);
    };
    const analyzeRef = useRef(analyze);
    analyzeRef.current = analyze;

    // A row opens the way every other route to a session does: a live tab through the router, an ended one as its
    // transcript in the Agent surface.
    const openSession = useCallback(
        (row: SessionRow) => {
            setSessionCursor(row.id);
            if (row.liveTabId != null) {
                void openTarget(model, { kind: "agent", tabId: row.liveTabId });
            } else {
                showSession(model, sessionKey({ runtime: "claude", id: row.id }));
            }
        },
        [model, setSessionCursor]
    );

    // j / k / Enter drive the By session table on the Claude tab; the tabs are ← / →.
    const listNav = useMemo<ListNavController | null>(() => {
        if (!claude || visibleRows.length === 0) {
            return null;
        }
        return {
            surface: "usage",
            navigableIds: visibleRows.map((r) => r.id),
            cursorId: sessionCursor,
            setCursor: (id) => setSessionCursor(id),
            activate: () => {
                const row = visibleRows.find((r) => r.id === sessionCursor);
                if (row != null) {
                    openSession(row);
                }
            },
        };
    }, [claude, visibleRows, sessionCursor, setSessionCursor, openSession]);
    useSurfaceListNav(listNav);

    // ← / → switch tabs. The bindings are built once; the handlers read the live ids and selection from a ref.
    const tabNav = useRef({ ids: tabIds, sel, pickTab });
    tabNav.current = { ids: tabIds, sel, pickTab };
    const usageBindings = useMemo(() => {
        const step = (delta: number) => {
            const { ids, sel: cur, pickTab: pick } = tabNav.current;
            const next = moveCursor(ids, cur, delta);
            if (next != null && next !== cur) {
                pick(next);
            }
        };
        return buildUsageBindings({
            prevTab: () => step(-1),
            nextTab: () => step(1),
            analyze: () => analyzeRef.current(),
        });
    }, []);
    useKeybindings(usageBindings);

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
    const all = scope === ALL;
    // the aggregate can't average independent per-account quotas — it reports whichever is closest to
    // its cap (worstWindow) and says whose it is.
    const fiveHour: AggregateWindow = all ? worstWindow(rows, "fivehour") : (selRow?.fivehour ?? {});
    const week: AggregateWindow = all ? worstWindow(rows, "week") : (selRow?.week ?? {});
    const hasLimits = all ? fiveHour.pct != null || week.pct != null : selRow != null && selRow.state !== "none";
    const projectionForWeek = all
        ? week.harness === "claude"
            ? weeklyProjectionMs
            : null
        : scope === "claude"
          ? weeklyProjectionMs
          : null;

    const hasHistory = stats.providers.length > 0 || stats.totals.tokensWindow > 0;
    const revealHistory = useDidBecomeTrue(hasHistory);
    const chartHarnesses = all ? rows.map((r) => r.harness) : [scope];

    const estimateSub = (coveragePct: number | null) =>
        coveragePct == null ? "no priced tokens" : `${Math.round(coveragePct)}% of tokens priced`;
    // reported cost is a card only when some source reported one; otherwise it would be a dash
    const reportedCard = (label: string, present: boolean, sources: string[], value: number): StatCardProps[] =>
        present
            ? [{ label, value: usd(value), sub: sources.length > 0 ? `from ${sources.join(" · ")}` : undefined }]
            : [];
    const t = stats.totals;
    const statCards: StatCardProps[] =
        usageWindow === "7d"
            ? [
                  {
                      label: "Tokens · today",
                      value: fmt(t.tokensToday),
                      sub: all ? harnessSub(t.tokensTodayByHarness) : undefined,
                  },
                  { label: "Tokens · 7 days", value: fmt(t.tokensWeek) },
                  ...reportedCard(
                      "Reported cost · 7 days",
                      t.reportedCostWeekPresent,
                      t.reportedCostWeekHarnesses,
                      t.reportedCostWeekUsd
                  ),
                  {
                      label: "API-equivalent · 7 days",
                      value: `≈ ${usd(t.spendWeekUsd)}`,
                      sub: estimateSub(t.pricingCoverageWeekPct),
                  },
              ]
            : [
                  {
                      label: "Tokens · all time",
                      value: fmt(t.tokensWindow),
                      sub: all ? harnessSub(t.tokensWindowByHarness) : undefined,
                  },
                  {
                      label: "Daily avg",
                      value: fmt(t.activeDays > 0 ? t.tokensWindow / t.activeDays : 0),
                      sub: `over ${t.activeDays} active day${t.activeDays === 1 ? "" : "s"}`,
                  },
                  ...reportedCard(
                      "Reported cost · all time",
                      t.reportedCostWindowPresent,
                      t.reportedCostWindowHarnesses,
                      t.reportedCostWindowUsd
                  ),
                  {
                      label: "API-equivalent · all time",
                      value: `≈ ${usd(t.spendWindowUsd)}`,
                      sub: estimateSub(t.pricingCoverageWindowPct),
                  },
              ];

    return (
        <MotionConfig reducedMotion="user">
            <div className="flex h-full min-h-0 flex-col bg-background">
                <SurfaceHeader
                    title="Usage"
                    badge={
                        reporting > 0 && solo == null ? (
                            <span className="inline-flex items-center gap-1.5 rounded-sm border border-accent bg-accentbg px-2 py-[3px] text-[10.5px] font-semibold uppercase tabular-nums tracking-[0.08em] text-accent-soft">
                                <span className="h-1.5 w-1.5 rounded-full bg-accent" />
                                {reporting} reporting
                            </span>
                        ) : null
                    }
                    subtitle={
                        solo != null ? (
                            <span className="block leading-[1.5]">
                                Live quota and token history. Spend is an estimate from a bundled price table, not a
                                bill.
                            </span>
                        ) : (
                            <span className="block max-w-[680px] leading-[1.5]">
                                Live provider quota while agents run, and the durable history behind it. Pick a provider
                                tab; reported cost is what each agent source recorded, the API-equivalent estimate comes
                                from a bundled price table. Neither is a bill.
                            </span>
                        )
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

                {/* with one provider there is nothing to pick between, so no strip */}
                {solo == null ? (
                    <UsageTabs
                        rows={rows}
                        sel={sel}
                        now={now}
                        allTokens={allStats.totals.tokensWindow}
                        onSelect={pickTab}
                    />
                ) : null}

                <div
                    role="tabpanel"
                    data-usage-detail={scope}
                    className="@container min-h-0 min-w-0 flex-1 overflow-y-auto px-7 pb-12 pt-5"
                >
                    {/* live and historical share a row but stay two labelled groups: one is an
                            ephemeral reading, the other durable history, and they must not read as one */}
                    <div className={cn("mb-5 grid gap-x-4 gap-y-5", kpiGridClass(statCards.length))}>
                        <section className="min-w-0">
                            <SectionRule
                                label="Live limits"
                                meta={all ? "highest reading · ephemeral" : selRow ? stateMeta(selRow, now).long : "—"}
                                action={refreshShown ? <UsageRefreshButton className="h-6 w-6" /> : null}
                            />
                            {hasLimits ? (
                                <div className="grid grid-cols-2 gap-2.5">
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
                                <p className="rounded-[11px] border border-border bg-surface px-4 py-3 text-[11px] leading-[1.55] text-muted">
                                    No quota reading{all ? "" : ` for ${providerLabel(scope)}`}. Claude&apos;s windows
                                    are read from your Claude Code login with no session running, once it has signed in;
                                    other providers&apos; are known only while an agent that publishes them runs. The
                                    last snapshot is kept per provider, and rolls to empty once its window passes.
                                    History is unaffected.
                                </p>
                            )}
                        </section>

                        <section className="min-w-0">
                            <SectionRule label="Historical" meta={`durable · ${windowLabel}`} />
                            {!usageLoaded ? (
                                <StatTilesSkeleton />
                            ) : !hasHistory ? (
                                <p className="rounded-[11px] border border-border bg-surface px-4 py-3 text-[11px] leading-[1.55] text-muted">
                                    No usage in this window
                                    {all ? " — start an agent." : ` for ${providerLabel(scope)}.`}
                                </p>
                            ) : (
                                <motion.div
                                    variants={cardVariants}
                                    initial={revealHistory ? "initial" : false}
                                    animate="animate"
                                    className={cn("grid gap-2.5", statGridClass(statCards.length))}
                                >
                                    {statCards.map((c) => (
                                        <StatCard key={c.label} {...c} />
                                    ))}
                                </motion.div>
                            )}
                        </section>
                    </div>

                    {/* Claude only: it alone has the quota window and the cache classes that make these flags
                        mean something */}
                    {claude ? (
                        sessionsLoaded ? (
                            <>
                                <UsageInsightsCard
                                    card={insights}
                                    held={held}
                                    sessionCount={sessionRows.length}
                                    windowDays={windowDays}
                                    now={now}
                                    onAnalyze={analyze}
                                />
                                {sessionRows.length > 0 ? (
                                    <UsageSessionTable
                                        rows={sessionRows}
                                        visible={visibleRows}
                                        loaded
                                        windowName={windowDays === 0 ? "all time" : `${windowDays} days`}
                                        showAll={showAllSessions}
                                        onToggleAll={() => setShowAllSessions(!showAllSessions)}
                                        cursorId={sessionCursor}
                                        onOpen={openSession}
                                    />
                                ) : null}
                            </>
                        ) : (
                            <>
                                <section className="mb-[22px] min-w-0">
                                    <SectionRule label="Insights" />
                                    <div className={cn(CARD, "gap-2.5")}>
                                        <SkeletonLine className="h-3 w-[32%]" />
                                        <SkeletonLine className="h-2.5 w-[88%]" />
                                    </div>
                                </section>
                                <UsageSessionTable
                                    rows={[]}
                                    visible={[]}
                                    loaded={false}
                                    windowName=""
                                    showAll={false}
                                    onToggleAll={() => {}}
                                    cursorId={undefined}
                                    onOpen={() => {}}
                                />
                            </>
                        )
                    ) : null}

                    {!usageLoaded ? (
                        <BreakdownSkeleton />
                    ) : hasHistory ? (
                        <motion.div
                            variants={cardVariants}
                            initial={revealHistory ? "initial" : false}
                            animate="animate"
                        >
                            <div className={CHART_ROW}>
                                <DailyChart
                                    daily={stats.daily}
                                    window={usageWindow}
                                    metric={usageMetric}
                                    onMetric={setUsageMetric}
                                    harnesses={chartHarnesses}
                                />
                                <SplitCard split={stats.split} />
                                {stats.providers.map((p) => (
                                    <ModelGroup key={p.provider} p={p} />
                                ))}
                            </div>
                        </motion.div>
                    ) : null}
                </div>
            </div>
        </MotionConfig>
    );
}
