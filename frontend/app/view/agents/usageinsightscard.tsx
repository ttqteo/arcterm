// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The Usage surface's Insights section (Claude tab): the rule with the Analyze button, and the card under it.
// Thin: which state shows is insightsCard (usageinsights.ts), whether Analyze is held is insightsHeld, and the
// markdown split is splitInsights. States and sizes follow Main.dc.html and InsightsStates.dc.html in the
// usage-insights prototype. Spec: 2026-10-08-usage-insights-design.md, section 3.

import { Markdown } from "@/app/element/markdown";
import { SkeletonLine } from "@/app/element/skeleton";
import { REGION_LABEL } from "@/app/view/jarvis/briefstyle";
import { cn } from "@/util/util";
import { CircleAlert, Clock, Sparkles } from "lucide-react";
import type { ReactNode } from "react";
import { formatAge } from "./agentsviewmodel";
import { splitInsights, type InsightsCard } from "./usageinsights";

const PANEL = "rounded-[14px] border border-border bg-surface-raised";
const BUTTON =
    "inline-flex flex-none cursor-pointer items-center gap-[7px] rounded-md font-medium outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed";
const BUTTON_PRIMARY = "h-[30px] bg-accent px-3 text-[12px] font-semibold text-background hover:bg-accent-300";
const BUTTON_SECONDARY =
    "h-[26px] border border-edge-mid bg-surface-raised px-2.5 text-[11.5px] text-ink-mid hover:border-edge-strong hover:bg-surface-hover disabled:border-border disabled:bg-surface disabled:text-ink-faint disabled:hover:border-border disabled:hover:bg-surface";

// The markdown element sizes its headings for a document (a bordered 1.5em "##"); in this card a "##" is a
// 13.5px run-in title. The element's own rules are unlayered CSS, so only an important utility outranks them.
const MD_HEADINGS =
    "[&_.heading]:mb-1! [&_.heading]:border-b-0! [&_.heading]:p-0! [&_.heading]:text-[13.5px]! [&_.heading]:font-semibold!";

function windowName(days: number): string {
    return days === 0 ? "all time" : `${days} days`;
}

function clock(ts: number, now: number): string {
    const d = new Date(ts);
    const hhmm = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
    return now - ts < 20 * 3600_000 ? hhmm : `${d.toLocaleDateString([], { weekday: "short" })} ${hhmm}`;
}

// "analysed 14:30 · 7 days · sonnet"
function analysedMeta(ins: UsageInsights, now: number): string {
    return `analysed ${clock(ins.analyzedts, now)} · ${windowName(ins.windowdays)} · ${ins.model || "sonnet"}`;
}

// The server's message starts lowercase and carries no full stop ("the analysis did not finish: ...").
function sentence(text: string): string {
    const t = text.trim();
    if (t === "") return "The analysis failed.";
    const cap = t[0].toUpperCase() + t.slice(1);
    return /[.!?]$/.test(cap) ? cap : `${cap}.`;
}

function Rule({ meta, action }: { meta?: string; action?: ReactNode }) {
    return (
        <div className="mb-3 flex items-center gap-2.5">
            <h3 className={cn(REGION_LABEL, "text-muted")}>Insights</h3>
            <div className="h-px flex-1 bg-edge-faint" />
            {meta != null ? <span className="text-[10.5px] tabular-nums text-muted">{meta}</span> : null}
            {action}
        </div>
    );
}

function AnalyzeButton({
    label,
    primary,
    disabled,
    title,
    onAnalyze,
}: {
    label: string;
    primary: boolean;
    disabled: boolean;
    title: string;
    onAnalyze: () => void;
}) {
    return (
        <button
            type="button"
            data-usage-analyze=""
            title={title}
            disabled={disabled}
            onClick={onAnalyze}
            className={cn(BUTTON, primary ? BUTTON_PRIMARY : BUTTON_SECONDARY)}
        >
            <Sparkles size={13} aria-hidden />
            {label}
            <kbd
                className={cn(
                    "rounded-[4px] border px-1 font-mono text-[10px] font-normal",
                    primary ? "border-background/35" : "border-edge-mid text-muted"
                )}
            >
                a
            </kbd>
        </button>
    );
}

// The side tile's heading ("## What to change") is its label; the rest is the list.
function sideParts(side: string): { label?: string; body: string } {
    const m = /^##\s+(.+?)\s*(?:\n|$)/.exec(side);
    return m == null ? { body: side } : { label: m[1], body: side.slice(m[0].length).trim() };
}

// `note` (the stale line) sits inside the panel, above the analysis, which it dims.
function AnalysisBody({ ins, note }: { ins: UsageInsights; note?: ReactNode }) {
    const { main, side } = splitInsights(ins.markdown);
    const tile = side != null ? sideParts(side) : undefined;
    return (
        <div aria-live="polite" className={cn(PANEL, "px-[22px] py-5")}>
            {note}
            <div
                className={cn(
                    "grid grid-cols-1 gap-7",
                    tile != null && "@3xl:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]",
                    note != null && "opacity-85"
                )}
            >
                <Markdown
                    text={main}
                    scrollable={false}
                    fontSizeOverride={13}
                    className={cn("text-ink-hi", MD_HEADINGS)}
                />
                {tile != null ? (
                    <div className="self-start rounded-[11px] border border-edge-mid bg-surface px-[18px] py-4">
                        {tile.label != null ? (
                            <div className={cn(REGION_LABEL, "mb-2.5 text-muted")}>{tile.label}</div>
                        ) : null}
                        <Markdown text={tile.body} scrollable={false} fontSizeOverride={13} className="text-ink-hi" />
                    </div>
                ) : null}
            </div>
        </div>
    );
}

function RunningBody() {
    return (
        <div aria-live="polite" className={cn(PANEL, "flex flex-col gap-2.5 px-5 py-[18px]")}>
            <div className="text-[12px] text-muted">
                Analysing… Claude reads the per-tab numbers, not your conversations (~30 s).
            </div>
            <SkeletonLine className="h-3 w-[32%]" />
            <SkeletonLine className="h-2.5 w-[88%]" />
            <SkeletonLine className="h-2.5 w-[76%]" />
            <SkeletonLine className="mt-2 h-3 w-[28%]" />
            <SkeletonLine className="h-2.5 w-[82%]" />
            <SkeletonLine className="h-2.5 w-[64%]" />
        </div>
    );
}

function StaleNote({ ins, windowDays, now }: { ins: UsageInsights; windowDays: number; now: number }) {
    const text =
        ins.windowdays !== windowDays
            ? `This analysis covers ${windowName(ins.windowdays)}; the window shown is ${windowName(windowDays)}. Re-analyze to read this one.`
            : `The numbers have changed since this analysis (${formatAge(now - ins.analyzedts)} ago). Re-analyze to read the current window.`;
    return (
        <div
            data-usage-insights-stale=""
            className="mb-3 flex items-center gap-[7px] border-b border-edge-faint pb-2.5 text-[11px] text-muted"
        >
            <Clock size={12} className="flex-none" aria-hidden />
            {text}
        </div>
    );
}

function ErrorNote({ message, hasPrev }: { message: string; hasPrev: boolean }) {
    return (
        <div
            role="alert"
            className="mb-2.5 flex items-start gap-[9px] rounded-[11px] border border-error/35 bg-error/10 px-3.5 py-2.5 text-[12px] leading-[1.5] text-error-soft"
        >
            <CircleAlert size={13} className="mt-0.5 flex-none" aria-hidden />
            <span>
                {sentence(message)} {hasPrev ? "Your last analysis is below; try again." : "Try again."}
            </span>
        </div>
    );
}

// Analyze is held with no result to show: the percentage in a pill, then why.
function HeldNote({ held }: { held: string }) {
    const pct = /(\d+)%/.exec(held)?.[1];
    return (
        <div
            data-usage-insights-held=""
            className={cn(PANEL, "flex items-center gap-2.5 px-5 py-4 text-[12px] leading-[1.55] text-muted")}
        >
            {pct != null ? (
                <span className="flex-none rounded-[4px] bg-error/15 px-1.5 py-0.5 text-[10.5px] font-bold tabular-nums tracking-[0.06em] text-error">
                    {pct}%
                </span>
            ) : null}
            <span>
                {held}. Analyze waits for it so it doesn&apos;t spend the last of your quota; the per-tab table below
                still works.
            </span>
        </div>
    );
}

// `held` is the insightsHeld tooltip, or null when Analyze may run. `windowDays` is the surface's window (7, or 0
// for all time), against which a result is stale.
export function UsageInsightsCard({
    card,
    held,
    sessionCount,
    windowDays,
    now,
    onAnalyze,
}: {
    card: InsightsCard;
    held: string | null;
    sessionCount: number;
    windowDays: number;
    now: number;
    onAnalyze: () => void;
}) {
    const shown = card.kind === "done" ? card.ins : card.kind === "error" ? card.prev : undefined;
    const meta =
        card.kind === "running"
            ? `reading ${sessionCount} tab${sessionCount === 1 ? "" : "s"}…`
            : shown != null
              ? analysedMeta(shown, now)
              : undefined;
    // the first run is the one call to action, so it sits in the card as the primary button; every other state
    // keeps the secondary one on the rule
    const primaryInCard = card.kind === "never" && held == null;
    const button = (primary: boolean) => (
        <AnalyzeButton
            label={card.kind === "done" ? "Re-analyze" : card.kind === "error" ? "Try again" : "Analyze"}
            primary={primary}
            disabled={card.kind === "running" || held != null}
            title={held ?? "Analyze usage (a)"}
            onAnalyze={onAnalyze}
        />
    );

    return (
        <section data-usage-insights={card.kind} className="mb-[22px] min-w-0">
            <Rule meta={meta} action={card.kind === "no-sessions" || primaryInCard ? null : button(false)} />

            {card.kind === "no-sessions" ? (
                <p className="rounded-[11px] border border-border bg-surface px-4 py-3 text-[11px] leading-[1.55] text-muted">
                    {windowDays === 0
                        ? "No Claude tabs yet, so there is nothing to analyse. Start an agent."
                        : `No Claude tabs in the last ${windowName(windowDays)}, so there is nothing to analyse. Switch to All time, or start an agent.`}
                </p>
            ) : null}

            {card.kind === "never" ? (
                held != null ? (
                    <HeldNote held={held} />
                ) : (
                    <div className={cn(PANEL, "flex items-center gap-[18px] px-5 py-[18px]")}>
                        <div className="min-w-0 flex-1">
                            <div className="mb-1 text-[13px] font-semibold text-primary">Where does your quota go?</div>
                            <div className="text-[12px] leading-[1.55] text-muted">
                                Claude reads the per-tab numbers below, not your conversations, and points at what
                                spends quota and what to change. One Sonnet call, about 30 s.
                            </div>
                        </div>
                        {primaryInCard ? button(true) : null}
                    </div>
                )
            ) : null}

            {card.kind === "running" ? <RunningBody /> : null}

            {card.kind === "done" ? (
                <AnalysisBody
                    ins={card.ins}
                    note={card.stale ? <StaleNote ins={card.ins} windowDays={windowDays} now={now} /> : undefined}
                />
            ) : null}

            {card.kind === "error" ? (
                <>
                    <ErrorNote message={card.message} hasPrev={card.prev != null} />
                    {card.prev != null ? <AnalysisBody ins={card.prev} /> : null}
                </>
            ) : null}
        </section>
    );
}
