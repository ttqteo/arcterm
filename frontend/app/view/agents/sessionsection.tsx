// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The session block that opens the Agent details rail. Closed, it is one row: the rail's status line (context and
// spend, passed in as head) with a chevron, and Compact/Clear under it when offered. Open, it adds the session's total
// tokens over a tokens bar, its facts (the rail passes them in as children), and a toggle for the insight, the
// per-class split (tokens + ≈ spend) and, for a session that used more than one model, the per-model breakdown, from
// the session's own transcript (transcriptusagestore/sessionusage). The spend shows once, in the head; a single model's
// name is the Model line. Class fills come from usagestats.ts's CLASS_FILL (theme tokens only). Spend is an estimate.

import { StackedMeter } from "@/app/element/meter";
import { paneReveal } from "@/app/element/motiontokens";
import { railSectionOpenAtom, sectionOpen, toggleSection, type RailSectionHeader } from "@/app/element/railsections";
import { SkeletonLine } from "@/app/element/skeleton";
import { cn } from "@/util/util";
import { useAtom, useAtomValue } from "jotai";
import { ChevronDown, ChevronRight, ChevronUp, Lightbulb } from "lucide-react";
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

// open, the block's open state is kept with the rail's sections (railSectionOpenAtom) under this id
const SESSION_ID = "session";
const SESSION_HEADER: RailSectionHeader = { defaultOpen: false };

// UsageHead is the session's total tokens over the tokens bar, whose legend is the breakdown
function UsageHead({ usage }: { usage: SessionUsage }) {
    return (
        <>
            <div className="mb-[6px] flex items-baseline gap-[5px]">
                <span className="text-[12px] font-semibold tabular-nums text-primary">{fmt(usage.totalTokens)}</span>
                <span className="text-[11px] text-muted">tokens</span>
            </div>
            <StackedMeter
                height={6}
                radius={3}
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

export function SessionSection({
    head,
    actions,
    children,
}: {
    head: ReactNode; // the status line: context on the left, spend on the right
    actions?: ReactNode; // shown under the head, open or closed
    children: ReactNode; // the session's facts
}) {
    const usage = useAtomValue(sessionUsageAtom);
    const [stored, setStored] = useAtom(railSectionOpenAtom);
    const [breakdown, setBreakdown] = useAtom(usageBreakdownAtom);
    const open = sectionOpen(stored, SESSION_ID, SESSION_HEADER);
    const loaded = usage != null && usage !== UsageUnavailable && usage.totalTokens > 0 ? usage : null;

    return (
        <div data-rail-session data-open={open ? "true" : "false"} className="flex flex-col pt-[2px]">
            <button
                type="button"
                aria-expanded={open}
                aria-controls="rail-session-body"
                title={open ? "Hide session details" : "Show session details"}
                onClick={() => setStored(toggleSection(stored, SESSION_ID, SESSION_HEADER))}
                className="group -mx-[6px] flex min-w-0 cursor-pointer items-center gap-[8px] rounded-[6px] px-[6px] py-[3px] text-left hover:bg-surface-hover"
            >
                {head}
                <ChevronRight
                    size={12}
                    aria-hidden
                    className={cn(
                        "flex-none text-ink-faint transition-transform group-hover:text-secondary",
                        open && "rotate-90"
                    )}
                />
            </button>
            {actions}
            <AnimatePresence initial={false}>
                {open ? (
                    <motion.div
                        key="session-body"
                        id="rail-session-body"
                        variants={paneReveal}
                        initial="initial"
                        animate="animate"
                        exit="exit"
                        className="overflow-hidden"
                    >
                        <div className="pb-[4px] pt-[10px]">
                            {usage == null ? (
                                <div>
                                    <SkeletonLine className="h-[12px] w-[90px]" />
                                    <SkeletonLine className="mt-[6px] h-[6px] w-full rounded-[3px]" />
                                </div>
                            ) : usage === UsageUnavailable ? (
                                <div className="text-[11.5px] text-muted">Token usage unavailable.</div>
                            ) : loaded == null ? (
                                <div className="text-[11.5px] text-muted">No token usage recorded yet.</div>
                            ) : (
                                <UsageHead usage={loaded} />
                            )}

                            <div className="mt-[12px]">{children}</div>

                            {loaded ? (
                                <>
                                    <button
                                        type="button"
                                        onClick={() => setBreakdown((v) => !v)}
                                        aria-expanded={breakdown}
                                        className="-ml-[6px] mt-[8px] inline-flex cursor-pointer items-center gap-[3px] rounded-[7px] px-[6px] py-[3px] text-[10.5px] font-semibold text-accent-soft hover:bg-surface-hover"
                                    >
                                        {breakdown ? "Hide breakdown" : "Show breakdown"}
                                        {breakdown ? (
                                            <ChevronUp size={11} aria-hidden />
                                        ) : (
                                            <ChevronDown size={11} aria-hidden />
                                        )}
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
                    </motion.div>
                ) : null}
            </AnimatePresence>
        </div>
    );
}
