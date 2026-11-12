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
// tokens only). Spend is an estimate. For a Claude agent the breakdown opens on a Context part (what fills the
// context in use, by source, read from Claude Code's /context on a click; ctxbreakdown.ts is its model) above the
// Spend part.

import { StackedMeter } from "@/app/element/meter";
import { paneReveal } from "@/app/element/motiontokens";
import { SkeletonLine } from "@/app/element/skeleton";
import { cn } from "@/util/util";
import { useAtom, useAtomValue } from "jotai";
import { ArrowUpRight, ChevronDown, ChevronUp, Clock, Lightbulb } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useMemo, useState, type ReactNode } from "react";
import { cacheRewriteTitle } from "./agentrailmodel";
import {
    cacheMinutes,
    compactBuffer,
    contextGroups,
    fmtTok,
    freeTokens,
    readAgo,
    type CtxGroup,
    type CtxRow,
} from "./ctxbreakdown";
import { ctxBreakdownAtom, readCtxBreakdown } from "./ctxbreakdownstore";
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

// what the Context part needs from the rail: the folder the breakdown is read in and kept under, the context in use
// now and its window, the cache countdown's text, and how a memory file or skill opens
export interface SessionContext {
    cwd: string;
    liveTokens: number; // contextpct × contextmax
    windowTokens: number; // contextmax
    cache: string; // formatCacheCountdown's text ("43m left", "—")
    onOpenFile: (path: string) => void;
}

// a part's heading: its label, a rule and one figure
function PartHeading({ label, figure, className }: { label: string; figure: string; className?: string }) {
    return (
        <div data-rail-part-heading={label} className={cn("flex items-center gap-[8px]", className)}>
            <SubLabel>{label}</SubLabel>
            <div className="h-px flex-1 bg-edge-faint" />
            <span className="text-[10.5px] tabular-nums text-muted">{figure}</span>
        </div>
    );
}

const CTX_BTN =
    "flex-none cursor-pointer rounded-[6px] px-[6px] py-[2px] text-[10.5px] font-semibold text-accent-soft hover:bg-surface-hover disabled:cursor-default disabled:text-muted disabled:hover:bg-transparent";

// DESIGN.md's secondary button
const CTX_SECONDARY_BTN =
    "w-fit cursor-pointer rounded-[6px] border border-edge-mid bg-surface-raised px-[10px] py-[4px] text-[11.5px] font-medium text-muted hover:border-edge-strong hover:bg-surface-hover disabled:cursor-default disabled:hover:border-edge-mid disabled:hover:bg-surface-raised";

const MESSAGES_TITLE = "context in use minus what loads every turn; includes what hooks added";

// one memory file, skill, custom agent or MCP server of an open group; a row with a file behind it opens that file
function CtxItemRow({ row, onOpen }: { row: CtxRow; onOpen: (path: string) => void }) {
    const path = row.path;
    const body = (
        <>
            <span
                className={cn(
                    "min-w-0 max-w-[60%] flex-none truncate text-[11.5px] font-medium",
                    path ? "text-primary" : "text-secondary"
                )}
            >
                {row.name}
            </span>
            <span className="min-w-0 flex-1 truncate text-[10.5px] text-muted">{row.detail}</span>
            {row.tokens != null ? (
                <span className="flex-none text-[10.5px] tabular-nums text-muted">{fmtTok(row.tokens)}</span>
            ) : null}
            {path ? (
                <ArrowUpRight size={11} aria-hidden className="flex-none text-accent-soft" />
            ) : (
                <span aria-hidden className="w-[11px] flex-none" />
            )}
        </>
    );
    return path ? (
        <button
            type="button"
            data-ctx-row
            data-ctx-open-file
            title={`Open ${path}`}
            onClick={() => onOpen(path)}
            className="-mx-[6px] flex w-[calc(100%+12px)] cursor-pointer items-center gap-[7px] rounded-[6px] px-[6px] py-[4px] text-left hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
        >
            {body}
        </button>
    ) : (
        <div data-ctx-row className="flex items-center gap-[7px] py-[4px]">
            {body}
        </div>
    );
}

// one group of the context: its swatch, name, count, tag, tokens and share. A group with rows or a note folds open
function CtxGroupRow({
    g,
    open,
    showAll,
    onToggle,
    onShowAll,
    onOpenFile,
}: {
    g: CtxGroup;
    open: boolean;
    showAll: boolean;
    onToggle: () => void;
    onShowAll: () => void;
    onOpenFile: (path: string) => void;
}) {
    const expandable = g.rows.length > 0 || !!g.note;
    const head = (
        <>
            <span className={cn("h-[9px] w-[9px] flex-none rounded-[3px]", g.fill)} />
            {/* the tag sits under the name: the rail is 300px wide, and beside the name it left room for one letter */}
            <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-[12px] text-secondary">
                    {g.label}
                    {g.count != null ? <span className="ml-[5px] text-[10.5px] text-muted">{g.count}</span> : null}
                </span>
                <span className="truncate text-[10.5px] text-muted">{g.tag}</span>
            </span>
            <span className="w-[48px] flex-none text-right text-[11.5px] tabular-nums text-secondary">
                {fmtTok(g.tokens)}
            </span>
            <span className="w-[40px] flex-none text-right text-[10.5px] tabular-nums text-muted">{pctStr(g.pct)}</span>
            <span aria-hidden className="flex w-[12px] flex-none">
                {expandable ? (
                    open ? (
                        <ChevronUp size={12} className="text-accent-soft" />
                    ) : (
                        <ChevronDown size={12} className="text-accent-soft" />
                    )
                ) : null}
            </span>
        </>
    );
    const rows = showAll ? g.rows.concat(g.more) : g.rows;
    return (
        <>
            {expandable ? (
                <button
                    type="button"
                    data-ctx-group={g.id}
                    aria-expanded={open}
                    onClick={onToggle}
                    className="-mx-[6px] flex w-[calc(100%+12px)] cursor-pointer items-center gap-[9px] border-b border-edge-faint px-[6px] py-[6px] text-left hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
                >
                    {head}
                </button>
            ) : (
                <div
                    data-ctx-group={g.id}
                    title={g.id === "messages" ? MESSAGES_TITLE : undefined}
                    className="flex items-center gap-[9px] border-b border-edge-faint py-[6px]"
                >
                    {head}
                </div>
            )}
            {expandable && open ? (
                <div data-ctx-rows={g.id} className="mb-[6px] ml-[18px] mt-[4px] flex flex-col">
                    {g.note ? <p className="mb-[4px] text-[11px] leading-[1.5] text-muted">{g.note}</p> : null}
                    {rows.map((r, i) => (
                        <CtxItemRow key={`${r.name}:${i}`} row={r} onOpen={onOpenFile} />
                    ))}
                    {!showAll && g.more.length > 0 ? (
                        <button
                            type="button"
                            data-ctx-more
                            onClick={onShowAll}
                            className="mt-[2px] w-fit cursor-pointer text-[10.5px] font-semibold text-accent-soft"
                        >
                            +{g.more.length} more
                        </button>
                    ) : null}
                </div>
            ) : null}
        </>
    );
}

// The Context part: what fills the context in use now, by source. wavesrv reads it from Claude Code's /context (about
// 30 s, so only on a click); until then the part says so and offers the read. The cache line needs only the countdown
// and the context in use, so it shows in every state.
function ContextPart({ context }: { context: SessionContext }) {
    const { cwd, liveTokens, windowTokens, cache, onOpenFile } = context;
    const st = useAtomValue(ctxBreakdownAtom(cwd));
    const [open, setOpen] = useState<Record<string, boolean>>({});
    const [showAll, setShowAll] = useState<Record<string, boolean>>({});
    const data = st.state === "ready" ? st.data : st.state === "reading" ? st.prev : undefined;
    const groups = useMemo(() => (data ? contextGroups(data, liveTokens) : []), [data, liveTokens]);
    const reading = st.state === "reading";
    const warm = cacheMinutes(cache) != null;
    const live = fmtTok(liveTokens);

    return (
        <div data-rail-context className="flex flex-col">
            <PartHeading label="Context" figure={`${live} of ${fmtTok(windowTokens)}`} className="mb-[8px] mt-[12px]" />
            {data ? (
                <StackedMeter
                    height={8}
                    radius={4}
                    track="bg-border"
                    segs={groups.map((g) => ({ key: g.id, value: g.tokens, fill: g.fill }))}
                />
            ) : reading ? (
                <SkeletonLine className="h-[8px] w-full rounded-[4px]" />
            ) : (
                <div data-ctx-bar-empty className="h-[8px] rounded-[4px] bg-border" />
            )}

            {data
                ? groups.map((g) => (
                      <CtxGroupRow
                          key={g.id}
                          g={g}
                          open={!!open[g.id]}
                          showAll={!!showAll[g.id]}
                          onToggle={() => setOpen((o) => ({ ...o, [g.id]: !o[g.id] }))}
                          onShowAll={() => setShowAll((o) => ({ ...o, [g.id]: true }))}
                          onOpenFile={onOpenFile}
                      />
                  ))
                : null}

            {!data && st.state === "failed" ? (
                <div data-ctx-failed className="mt-[8px] flex flex-col items-start gap-[6px]">
                    <p className="text-[11px] leading-[1.5] text-muted">
                        {`Couldn't read /context: ${st.error.replace(/\.+$/, "")}.`}
                    </p>
                    <button
                        type="button"
                        data-ctx-retry
                        onClick={() => void readCtxBreakdown(cwd, true)}
                        className={CTX_SECONDARY_BTN}
                    >
                        Try again
                    </button>
                </div>
            ) : null}
            {!data && st.state !== "failed" ? (
                <div className="mt-[8px] flex flex-col items-start gap-[6px]">
                    {reading ? null : (
                        <p className="text-[11px] leading-[1.5] text-muted">
                            {`What fills the ${live} is read from Claude Code's /context. It runs between turns and adds nothing to the conversation.`}
                        </p>
                    )}
                    <button
                        type="button"
                        data-ctx-read
                        disabled={reading}
                        onClick={() => void readCtxBreakdown(cwd, false)}
                        className={CTX_SECONDARY_BTN}
                    >
                        {reading ? "Reading… about 30 s" : "Read the breakdown"}
                    </button>
                </div>
            ) : null}

            {warm ? (
                <div
                    data-ctx-cache-line
                    title={cacheRewriteTitle((liveTokens / windowTokens) * 100, windowTokens)}
                    className="mt-[10px] flex items-start gap-[6px] text-[11px] leading-[1.45] text-secondary"
                >
                    <Clock size={11} aria-hidden className="mt-[2px] flex-none text-muted" />
                    <span className="flex-1">
                        Cache warm <b className="font-semibold text-primary">{cache.replace(/ left$/, "")}</b> · after
                        that the next turn rewrites these {live}
                    </span>
                </div>
            ) : null}

            {data ? (
                <div data-ctx-footer className="mt-[4px] flex items-center gap-[6px] text-[10.5px] text-muted">
                    <span className="flex-1">
                        Free {fmtTok(freeTokens(windowTokens, liveTokens))} · autocompact keeps{" "}
                        {fmtTok(compactBuffer(data))}
                    </span>
                    <span data-ctx-read-ago>{readAgo(data.readat, Date.now())}</span>
                    <button
                        type="button"
                        data-ctx-refresh
                        disabled={reading}
                        title="Read the context again (runs /context between turns)"
                        onClick={() => void readCtxBreakdown(cwd, true)}
                        className={cn(CTX_BTN, "-mr-[6px]")}
                    >
                        {reading ? "Reading…" : "Refresh"}
                    </button>
                </div>
            ) : null}
        </div>
    );
}

export function SessionSection({
    head,
    spend,
    state,
    actions,
    context,
    children,
}: {
    head?: ReactNode; // the context line, left out while the context is unknown
    spend?: { text: string; title: string }; // the session's spend, at the end of the tokens bar's row
    state?: ReactNode; // the agent's state and cache with Resume or Stop, under the facts
    actions?: ReactNode; // Compact/Clear, on the last row
    context?: SessionContext; // a Claude agent's context in use: the breakdown opens on what fills it
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
                        {context ? (
                            <>
                                <ContextPart context={context} />
                                <PartHeading
                                    label="Spend"
                                    figure={`${fmt(loaded.totalTokens)} processed`}
                                    className="mb-[4px] mt-[18px]"
                                />
                            </>
                        ) : null}
                        <UsageBreakdown usage={loaded} />
                    </motion.div>
                ) : null}
            </AnimatePresence>
        </div>
    );
}
