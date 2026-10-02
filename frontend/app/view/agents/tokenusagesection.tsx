// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// "Token usage" rail section for the focused agent: the totals and a tokens bar, with the per-class split
// (tokens + ≈ spend) and per-model breakdown folded behind a toggle, from the session's own transcript
// (transcriptusagestore/sessionusage).
// Class fills come from usagestats.ts's CLASS_FILL (theme tokens only). Spend is an estimate.

import { StackedMeter } from "@/app/element/meter";
import { paneReveal } from "@/app/element/motiontokens";
import { SkeletonLine } from "@/app/element/skeleton";
import { cn } from "@/util/util";
import { useAtom, useAtomValue } from "jotai";
import { ChevronDown, ChevronUp, Lightbulb } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { prettyModel } from "./modellabel";
import { usageBreakdownAtom } from "./railstore";
import { SubLabel } from "./sectionlabel";
import { sessionUsageAtom, UsageUnavailable } from "./transcriptusagestore";
import { CLASS_FILL, fmt, usd } from "./usagestats";
import type { TokenClass } from "./usagestats";

function pctStr(n: number): string {
    if (n >= 10) return Math.round(n) + "%";
    if (n <= 0) return "0%";
    if (n < 0.1) return "<0.1%";
    return +n.toFixed(1) + "%";
}

export function TokenUsageSection() {
    const usage = useAtomValue(sessionUsageAtom);
    const [breakdown, setBreakdown] = useAtom(usageBreakdownAtom);

    if (usage == null) {
        return (
            <div>
                <SkeletonLine className="h-[24px] w-[120px]" />
                <SkeletonLine className="mt-[12px] h-[11px] w-full rounded-[5px]" />
                <SkeletonLine className="mt-[10px] h-[11px] w-full rounded-[5px]" />
            </div>
        );
    }
    if (usage === UsageUnavailable) {
        return (
            <div>
                <div className="text-[11.5px] text-muted">Token usage unavailable.</div>
            </div>
        );
    }
    if (usage.totalTokens === 0) {
        return (
            <div>
                <div className="text-[11.5px] text-muted">No token usage recorded yet.</div>
            </div>
        );
    }

    const { classes, models, insight, totalTokens, totalSpendUsd, reportedTotalUsd } = usage;
    const single = models.length === 1;
    const topLabel = insight ? classes.find((c) => c.cls === insight.topCostClass)?.label ?? "" : "";
    const headlineUsd = reportedTotalUsd !== undefined ? usd(reportedTotalUsd) : `≈ ${usd(totalSpendUsd)}`;
    const headlineCaption = reportedTotalUsd !== undefined ? "reported" : "API-equivalent";

    return (
        <div>
            {/* headline pair */}
            <div className="mb-[15px] flex items-end justify-between">
                <div>
                    <div className="font-mono text-[22px] font-bold leading-none text-primary">{fmt(totalTokens)}</div>
                    <div className="mt-[4px] font-mono text-[10.5px] text-muted">total tokens</div>
                </div>
                <div className="text-right">
                    <div className="font-mono text-[22px] font-bold leading-none text-success">{headlineUsd}</div>
                    <div className="mt-[4px] font-mono text-[10.5px] text-muted">{headlineCaption}</div>
                </div>
            </div>

            {/* tokens bar */}
            <div className="mb-[6px] flex items-baseline justify-between">
                <SubLabel>Tokens</SubLabel>
                <span className="font-mono text-[11px] text-secondary">{fmt(totalTokens)}</span>
            </div>
            <StackedMeter
                height={11}
                radius={5}
                segs={classes.map((c) => ({ key: c.cls, value: c.tokens, fill: CLASS_FILL[c.cls] }))}
                total={totalTokens}
            />

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
                        {/* spend bar */}
                        <div className="mb-[6px] mt-[13px] flex items-baseline justify-between">
                            <SubLabel>≈ Spend</SubLabel>
                            <span className="font-mono text-[11px] text-secondary">{usd(totalSpendUsd)}</span>
                        </div>
                        <StackedMeter
                            height={11}
                            radius={5}
                            segs={classes.map((c) => ({ key: c.cls, value: c.spendUsd, fill: CLASS_FILL[c.cls] }))}
                            total={totalSpendUsd}
                        />

                        {/* insight */}
                        {insight ? (
                            <div className="mt-[13px] flex gap-[8px] rounded-[9px] border border-border bg-surface-raised px-[11px] py-[9px]">
                                <Lightbulb size={13} aria-hidden className="mt-[1px] flex-none text-warning" />
                                <p className="text-[11.5px] leading-[1.5] text-secondary">
                                    Cache reads are {pctStr(insight.readTokPct)} of tokens but {pctStr(insight.readCostPct)} of spend;{" "}
                                    {topLabel.toLowerCase()} drives the cost.
                                </p>
                            </div>
                        ) : null}

                        {/* per-class table */}
                        <div className="mt-[14px] flex flex-col">
                            {/* a class the session never used is noise in the table */}
                            {classes.filter((c) => c.tokens > 0).map((c) => (
                                <div
                                    key={c.cls}
                                    className="flex items-center gap-[9px] border-b border-edge-faint py-[7px] last:border-b-0"
                                >
                                    <span className={cn("h-[9px] w-[9px] flex-none rounded-[3px]", CLASS_FILL[c.cls])} />
                                    <span className="min-w-0 flex-1 text-[12px] text-secondary">{c.label}</span>
                                    <span className="w-[52px] text-right font-mono text-[11.5px] text-secondary">{fmt(c.tokens)}</span>
                                    <span className="w-[40px] text-right font-mono text-[10.5px] text-muted">
                                        {pctStr(totalTokens > 0 ? (c.tokens / totalTokens) * 100 : 0)}
                                    </span>
                                    <span className="w-[48px] text-right font-mono text-[11.5px] text-muted">{usd(c.spendUsd)}</span>
                                </div>
                            ))}
                        </div>

                        {/* by model */}
                        <div className="mb-[11px] mt-[16px] flex items-center gap-[8px]">
                            <SubLabel>By model</SubLabel>
                            <div className="h-px flex-1 bg-edge-faint" />
                            <span className="font-mono text-[10.5px] text-muted">{single ? "1 model" : `${models.length} models`}</span>
                        </div>
                        <div className="flex flex-col gap-[11px]">
                            {models.map((m) => (
                                <div key={m.model}>
                                    <div className="mb-[6px] flex items-center gap-[8px]">
                                        <span className="min-w-0 flex-1 truncate font-mono text-[12px] font-semibold text-secondary" title={m.model}>
                                            {prettyModel(m.model)}
                                        </span>
                                        <span className="font-mono text-[11px] text-muted">{fmt(m.tokens)}</span>
                                        <span className="w-[48px] text-right font-mono text-[11px] text-muted">{usd(m.spendUsd)}</span>
                                    </div>
                                    {single ? null : (
                                        <StackedMeter
                                            height={11}
                                            radius={5}
                                            segs={(Object.keys(m.classes) as TokenClass[]).map((cls) => ({
                                                key: cls,
                                                value: m.classes[cls],
                                                fill: CLASS_FILL[cls],
                                            }))}
                                            total={m.tokens}
                                        />
                                    )}
                                </div>
                            ))}
                        </div>

                        <p className="mt-[13px] font-mono text-[10.5px] leading-[1.5] text-muted">
                            Priced per class from a bundled table. Subagents run in separate transcripts — see Subagents.
                        </p>
                    </motion.div>
                ) : null}
            </AnimatePresence>
            <button
                type="button"
                onClick={() => setBreakdown((v) => !v)}
                className="-ml-[6px] mt-[8px] inline-flex cursor-pointer items-center gap-[3px] rounded-[7px] px-[6px] py-[3px] font-mono text-[10.5px] font-semibold text-accent-soft hover:bg-surface-hover"
            >
                {breakdown ? "Hide breakdown" : "Show breakdown"}
                {breakdown ? <ChevronUp size={11} aria-hidden /> : <ChevronDown size={11} aria-hidden />}
            </button>
        </div>
    );
}
