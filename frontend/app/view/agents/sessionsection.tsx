// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// "Session" rail section for the focused agent: its token usage on top (the total and the spend on one line, a tokens
// bar under them), then the session's facts (the rail passes them in as children), then the insight, the per-class
// split (tokens + ≈ spend) and, for a session that used more than one model, the per-model breakdown folded behind a
// toggle, from the session's own transcript (transcriptusagestore/sessionusage). A single model's name is the Model
// line. Class fills come from usagestats.ts's CLASS_FILL (theme tokens only). Spend is an estimate.

import { StackedMeter } from "@/app/element/meter";
import { paneReveal } from "@/app/element/motiontokens";
import { SkeletonLine } from "@/app/element/skeleton";
import { cn } from "@/util/util";
import { useAtom, useAtomValue } from "jotai";
import { ChevronDown, ChevronUp, Lightbulb } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import type { ReactNode } from "react";
import { prettyModel } from "./modellabel";
import { usageBreakdownAtom } from "./railstore";
import { SubLabel } from "./sectionlabel";
import { spendHeadline, type SessionUsage } from "./sessionusage";
import { sessionUsageAtom, UsageUnavailable } from "./transcriptusagestore";
import type { TokenClass } from "./usagestats";
import { CLASS_FILL, fmt, usd } from "./usagestats";

function pctStr(n: number): string {
    if (n >= 10) return Math.round(n) + "%";
    if (n <= 0) return "0%";
    if (n < 0.1) return "<0.1%";
    return +n.toFixed(1) + "%";
}

// UsageHead is the section's first lines: the total and the spend, then the tokens bar, whose legend is the breakdown
function UsageHead({ usage }: { usage: SessionUsage }) {
    const headline = spendHeadline(usage);
    return (
        <>
            <div className="mb-[8px] flex items-baseline justify-between gap-[8px]">
                <span className="flex items-baseline gap-[5px]">
                    <span className="text-[15px] font-semibold leading-none tabular-nums text-primary">
                        {fmt(usage.totalTokens)}
                    </span>
                    <span className="text-[11px] text-muted">tokens</span>
                </span>
                <span
                    title={headline.caption}
                    className="text-[15px] font-semibold leading-none tabular-nums text-success"
                >
                    {headline.text}
                </span>
            </div>
            <StackedMeter
                height={8}
                radius={4}
                segs={usage.classes.map((c) => ({ key: c.cls, value: c.tokens, fill: CLASS_FILL[c.cls] }))}
                total={usage.totalTokens}
            />
        </>
    );
}

function UsageBreakdown({ usage }: { usage: SessionUsage }) {
    const { classes, models, insight, totalTokens } = usage;
    const topLabel = insight ? (classes.find((c) => c.cls === insight.topCostClass)?.label ?? "") : "";
    return (
        <>
            {insight ? (
                <div className="mt-[8px] flex gap-[8px] rounded-[9px] border border-border bg-surface-raised px-[11px] py-[9px]">
                    <Lightbulb size={13} aria-hidden className="mt-[1px] flex-none text-warning" />
                    <p className="text-[11.5px] leading-[1.5] text-secondary">
                        Cache reads are {pctStr(insight.readTokPct)} of tokens but {pctStr(insight.readCostPct)} of
                        spend; {topLabel.toLowerCase()} drives the cost.
                    </p>
                </div>
            ) : null}

            {/* per-class table */}
            <div className="mt-[10px] flex flex-col">
                {/* a class the session never used is noise in the table */}
                {classes
                    .filter((c) => c.tokens > 0)
                    .map((c) => (
                        <div
                            key={c.cls}
                            className="flex items-center gap-[9px] border-b border-edge-faint py-[7px] last:border-b-0"
                        >
                            <span className={cn("h-[9px] w-[9px] flex-none rounded-[3px]", CLASS_FILL[c.cls])} />
                            <span className="min-w-0 flex-1 text-[12px] text-secondary">{c.label}</span>
                            <span className="w-[52px] text-right text-[11.5px] tabular-nums text-secondary">
                                {fmt(c.tokens)}
                            </span>
                            <span className="w-[40px] text-right text-[10.5px] tabular-nums text-muted">
                                {pctStr(totalTokens > 0 ? (c.tokens / totalTokens) * 100 : 0)}
                            </span>
                            <span className="w-[48px] text-right text-[11.5px] tabular-nums text-muted">
                                {usd(c.spendUsd)}
                            </span>
                        </div>
                    ))}
            </div>

            {/* by model: one model has nothing to break down, and the Model line names it */}
            {models.length > 1 ? (
                <>
                    <div className="mb-[11px] mt-[16px] flex items-center gap-[8px]">
                        <SubLabel>By model</SubLabel>
                        <div className="h-px flex-1 bg-edge-faint" />
                        <span className="text-[10.5px] tabular-nums text-muted">{models.length} models</span>
                    </div>
                    <div className="flex flex-col gap-[11px]">
                        {models.map((m) => (
                            <div key={m.model}>
                                <div className="mb-[6px] flex items-center gap-[8px]">
                                    <span
                                        className="min-w-0 flex-1 truncate text-[12px] font-semibold text-secondary"
                                        title={m.model}
                                    >
                                        {prettyModel(m.model)}
                                    </span>
                                    <span className="text-[11px] tabular-nums text-muted">{fmt(m.tokens)}</span>
                                    <span className="w-[48px] text-right text-[11px] tabular-nums text-muted">
                                        {usd(m.spendUsd)}
                                    </span>
                                </div>
                                <StackedMeter
                                    height={8}
                                    radius={4}
                                    segs={(Object.keys(m.classes) as TokenClass[]).map((cls) => ({
                                        key: cls,
                                        value: m.classes[cls],
                                        fill: CLASS_FILL[cls],
                                    }))}
                                    total={m.tokens}
                                />
                            </div>
                        ))}
                    </div>
                </>
            ) : null}

            <p className="mt-[13px] text-[10.5px] leading-[1.5] text-muted">
                Priced per class from a bundled table. Subagents run in separate transcripts — see Subagents.
            </p>
        </>
    );
}

export function SessionSection({ children }: { children: ReactNode }) {
    const usage = useAtomValue(sessionUsageAtom);
    const [breakdown, setBreakdown] = useAtom(usageBreakdownAtom);
    const loaded = usage != null && usage !== UsageUnavailable && usage.totalTokens > 0 ? usage : null;

    return (
        <div>
            {usage == null ? (
                <div>
                    <SkeletonLine className="h-[15px] w-[140px]" />
                    <SkeletonLine className="mt-[8px] h-[8px] w-full rounded-[4px]" />
                </div>
            ) : usage === UsageUnavailable ? (
                <div className="text-[11.5px] text-muted">Token usage unavailable.</div>
            ) : loaded == null ? (
                <div className="text-[11.5px] text-muted">No token usage recorded yet.</div>
            ) : (
                <UsageHead usage={loaded} />
            )}

            <div className="my-[12px] h-px bg-edge-faint" />
            {children}

            {loaded ? (
                <>
                    <button
                        type="button"
                        onClick={() => setBreakdown((v) => !v)}
                        aria-expanded={breakdown}
                        className="-ml-[6px] mt-[8px] inline-flex cursor-pointer items-center gap-[3px] rounded-[7px] px-[6px] py-[3px] text-[10.5px] font-semibold text-accent-soft hover:bg-surface-hover"
                    >
                        {breakdown ? "Hide breakdown" : "Show breakdown"}
                        {breakdown ? <ChevronUp size={11} aria-hidden /> : <ChevronDown size={11} aria-hidden />}
                    </button>
                    <AnimatePresence initial={false}>
                        {breakdown ? (
                            <motion.div
                                key="breakdown"
                                variants={paneReveal}
                                initial="initial"
                                animate="animate"
                                exit="exit"
                                className="overflow-hidden"
                            >
                                <UsageBreakdown usage={loaded} />
                            </motion.div>
                        ) : null}
                    </AnimatePresence>
                </>
            ) : null}
        </div>
    );
}
