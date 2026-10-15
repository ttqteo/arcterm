// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The session block that opens the Agent details rail, shown whole: the context line (passed in as head, and left out
// while no live turn has reported it), the session's total tokens, its tokens bar and its spend on one row, its facts
// (the rail passes them in as children), the agent's state and cache with Resume or Stop (state), then Compact/Clear
// when offered (actions), so the cache countdown sits over the Compact/Clear it argues for. The tokens row comes from
// the transcript and is there asleep too, so a missing context drops a row rather than leaving a hole. The figures
// (head and tokens row) are the breakdown's toggle, with a chevron at the row's end. The breakdown is the one part that
// folds: the insight, the per-class split (tokens + ≈ spend) and, for a session that used more than one model, the
// per-model breakdown, from the session's own transcript (transcriptusagestore/sessionusage). The spend shows once, on
// the tokens row; a single model's name is in the facts. Class fills come from usagestats.ts's CLASS_FILL (theme
// tokens only). Spend is an estimate.

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
import type { SessionUsage } from "./sessionusage";
import { sessionUsageAtom, UsageUnavailable } from "./transcriptusagestore";
import type { TokenClass } from "./usagestats";
import { CLASS_FILL, fmt, usd } from "./usagestats";

function pctStr(n: number): string {
    if (n >= 10) return Math.round(n) + "%";
    if (n <= 0) return "0%";
    if (n < 0.1) return "<0.1%";
    return +n.toFixed(1) + "%";
}

// UsageBar is the session's total tokens, the tokens bar whose legend is the breakdown, then the session's spend; the
// chevron at its end says the figures open the breakdown
function UsageBar({
    usage,
    spend,
    open,
}: {
    usage: SessionUsage;
    spend?: { text: string; title: string };
    open: boolean;
}) {
    return (
        <div title={`${fmt(usage.totalTokens)} tokens this session`} className="flex min-w-0 items-center gap-[8px]">
            <span className="flex-none text-[11.5px] font-semibold tabular-nums text-primary">
                {fmt(usage.totalTokens)}
            </span>
            <StackedMeter
                height={6}
                radius={3}
                className="min-w-0 flex-1"
                segs={usage.classes.map((c) => ({ key: c.cls, value: c.tokens, fill: CLASS_FILL[c.cls] }))}
                total={usage.totalTokens}
            />
            {spend ? (
                <span title={spend.title} className="flex-none text-[12px] font-semibold tabular-nums text-success">
                    {spend.text}
                </span>
            ) : null}
            {open ? (
                <ChevronUp size={12} aria-hidden className="-ml-[2px] flex-none text-accent-soft" />
            ) : (
                <ChevronDown size={12} aria-hidden className="-ml-[2px] flex-none text-accent-soft" />
            )}
        </div>
    );
}

function UsageBreakdown({ usage }: { usage: SessionUsage }) {
    const { classes, models, insight, totalTokens } = usage;
    const topLabel = insight ? (classes.find((c) => c.cls === insight.topCostClass)?.label ?? "") : "";
    return (
        <>
            {insight ? (
                <div className="mt-[8px] flex gap-[8px] rounded-[9px] border border-border bg-surface px-[11px] py-[9px]">
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

export function SessionSection({
    head,
    spend,
    state,
    actions,
    children,
}: {
    head?: ReactNode; // the context line, left out while the context is unknown
    spend?: { text: string; title: string }; // the session's spend, at the end of the tokens bar's row
    state?: ReactNode; // the agent's state and cache with Resume or Stop, under the facts
    actions?: ReactNode; // Compact/Clear, on the last row
    children: ReactNode; // the session's facts
}) {
    const usage = useAtomValue(sessionUsageAtom);
    const [breakdown, setBreakdown] = useAtom(usageBreakdownAtom);
    const loaded = usage != null && usage !== UsageUnavailable && usage.totalTokens > 0 ? usage : null;

    const figures = (
        <>
            {head != null ? <div className="flex min-w-0 items-center py-[3px]">{head}</div> : null}
            <div className={head != null ? "mt-[6px]" : "py-[3px]"}>
                {usage == null ? (
                    <SkeletonLine className="h-[6px] w-full rounded-[3px]" />
                ) : usage === UsageUnavailable ? (
                    <div className="text-[11.5px] text-muted">Token usage unavailable.</div>
                ) : loaded == null ? (
                    <div className="text-[11.5px] text-muted">No token usage recorded yet.</div>
                ) : (
                    <UsageBar usage={loaded} spend={spend} open={breakdown} />
                )}
            </div>
        </>
    );

    return (
        // a raised tile, so the session's figures read apart from the lists under it
        <div
            data-rail-session
            className="-mx-[8px] mb-[10px] flex flex-col rounded-[10px] bg-surface-raised px-[12px] pb-[8px] pt-[9px]"
        >
            {loaded ? (
                // the figures are the breakdown's toggle: the breakdown is their legend, so a click on them opens it
                <button
                    type="button"
                    data-rail-breakdown-toggle
                    onClick={() => setBreakdown((v) => !v)}
                    aria-expanded={breakdown}
                    aria-controls="rail-session-breakdown"
                    title={breakdown ? "Hide the breakdown" : "Show the breakdown"}
                    className="-mx-[6px] -my-[3px] flex cursor-pointer flex-col rounded-[7px] px-[6px] py-[3px] text-left hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
                >
                    {figures}
                </button>
            ) : (
                figures
            )}
            <div className="mt-[10px]">{children}</div>
            {state != null ? <div className="mt-[8px]">{state}</div> : null}
            {actions != null ? <div className="-ml-[6px] mt-[6px] flex items-center gap-[4px]">{actions}</div> : null}
            <AnimatePresence initial={false}>
                {loaded && breakdown ? (
                    <motion.div
                        key="breakdown"
                        id="rail-session-breakdown"
                        data-rail-breakdown
                        variants={paneReveal}
                        initial="initial"
                        animate="animate"
                        exit="exit"
                        className="overflow-hidden pb-[4px]"
                    >
                        <UsageBreakdown usage={loaded} />
                    </motion.div>
                ) : null}
            </AnimatePresence>
        </div>
    );
}
