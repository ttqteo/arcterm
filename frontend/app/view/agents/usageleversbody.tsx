// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The Insights card's levers body (a saved analysis with a headline): the headline, then the levers ranked by what each
// fix could recover, with the selected one's fix and tabs beside the list on a wide container and under its row on a
// narrow one, then a General tips row for advice the numbers do not measure. Thin: the numbers, the ranking and the
// selection fallback are usagelevers.ts. Sizes follow Main.dc.html and Narrow.dc.html in the usage-insights-levers
// prototype; the labels stay English (spec 2026-10-13-usage-insights-levers-design.md, section 4).

import { REGION_LABEL } from "@/app/view/jarvis/briefstyle";
import { cn } from "@/util/util";
import { useAtom } from "jotai";
import { Lightbulb } from "lucide-react";
import { useRef, type KeyboardEvent, type ReactNode } from "react";
import { moveCursor } from "./agentsviewmodel";
import { insightsLeverAtom } from "./usageinsightsstore";
import { leverEvidence, leverViews, selectedLeverKey, TIPS_KEY, type LeverKey, type LeverView } from "./usagelevers";

const PANEL = "rounded-[14px] border border-border bg-surface-raised";

const LEVER_TITLE: Record<LeverKey, string> = {
    longctx: "Long context",
    bigread: "Oversized reads",
    bigbash: "Noisy Bash output",
    opus: "Opus on clear work",
    cold: "Cold resumes",
};

const NOT_FROM_NUMBERS = "not from your numbers";

// A row: one line of rank, title and value with the bar under it on a narrow container; one row of rank, title, bar and
// value on a wide one (the line's wrapper is display: contents there, so its children join the button's row).
const OPTION =
    "flex w-full cursor-pointer flex-col gap-[7px] rounded-md border-0 bg-transparent p-0 text-left text-inherit outline-none focus-visible:ring-2 focus-visible:ring-accent @3xl:flex-row @3xl:items-center @3xl:gap-3.5 @3xl:px-2.5 @3xl:py-[9px]";
const OPTION_ON = "@3xl:bg-surface-selected";
const OPTION_OFF = "@3xl:hover:bg-surface-hover";
// what wraps an option and, on a narrow container, the block that opens under it
const ITEM = "flex flex-col gap-2.5 border-b border-edge-mid py-2.5 @3xl:gap-0 @3xl:border-b-0 @3xl:py-0";

function percent(v: LeverView): string {
    return `~${Math.round(v.share * 100)}%`;
}

function Chips({ view, onOpenSession }: { view: LeverView; onOpenSession: (id: string) => void }) {
    if (view.tabs.length === 0) {
        return null;
    }
    return (
        <div className="flex max-w-[64ch] flex-wrap gap-1.5">
            {view.tabs.map((s) => (
                <button
                    key={s.id}
                    type="button"
                    data-usage-lever-tab={s.id}
                    title="Open this tab"
                    onClick={() => onOpenSession(s.id)}
                    className="h-6 max-w-full cursor-pointer truncate rounded-md border border-edge-mid bg-surface px-[9px] text-[11.5px] text-secondary outline-none hover:border-edge-strong focus-visible:ring-2 focus-visible:ring-accent"
                >
                    {s.title || s.id.slice(0, 8)}
                </button>
            ))}
            {view.more > 0 ? <span className="self-center text-[11.5px] text-muted">+{view.more}</span> : null}
        </div>
    );
}

function TipsList({ tips, className }: { tips: string[]; className: string }) {
    return (
        <ul className={cn("m-0 flex max-w-[64ch] list-disc flex-col gap-2 pl-[18px]", className)}>
            {tips.map((tip, i) => (
                <li key={i}>{tip}</li>
            ))}
        </ul>
    );
}

function LeverOption({
    view,
    rank,
    max,
    selected,
    onPick,
}: {
    view: LeverView;
    rank: number;
    max: number;
    selected: boolean;
    onPick: () => void;
}) {
    const width = `${max > 0 ? Math.round((view.totalUsd / max) * 100) : 0}%`;
    return (
        <button
            type="button"
            role="option"
            data-usage-lever={view.key}
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            onClick={onPick}
            className={cn(OPTION, selected ? OPTION_ON : OPTION_OFF)}
        >
            <span className="flex items-baseline gap-2.5 @3xl:contents">
                <span className="w-3 flex-none text-[12px] tabular-nums text-ink-faint">{rank}</span>
                {/* the evidence follows the title on a narrow container; a wide one has it in the detail column */}
                <span className="min-w-0 flex-1 text-[13px] @3xl:truncate">
                    <span className="font-medium text-ink-hi">{LEVER_TITLE[view.key]}</span>
                    <span className="text-[12px] text-muted @3xl:hidden"> {leverEvidence(view)}</span>
                </span>
                <span className="hidden h-0.5 w-[140px] flex-none overflow-hidden rounded-[1px] bg-edge-strong @3xl:block">
                    <span className="block h-full bg-muted" style={{ width }} />
                </span>
                <span className="w-11 flex-none text-right text-[13px] font-semibold tabular-nums text-primary">
                    {percent(view)}
                </span>
            </span>
            <span
                data-usage-lever-bar=""
                className="ml-[22px] block h-0.5 overflow-hidden rounded-[1px] bg-edge-strong @3xl:hidden"
            >
                <span className="block h-full bg-muted" style={{ width }} />
            </span>
        </button>
    );
}

function TipsOption({ selected, onPick }: { selected: boolean; onPick: () => void }) {
    return (
        <button
            type="button"
            role="option"
            data-usage-lever={TIPS_KEY}
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            onClick={onPick}
            className={cn(OPTION, "flex-row items-center gap-2.5", selected ? OPTION_ON : OPTION_OFF)}
        >
            <span className="flex w-3 flex-none items-center">
                <Lightbulb size={12} className="text-ink-faint" aria-hidden />
            </span>
            <span className="flex-1 text-[13px] font-medium text-secondary">General tips</span>
            <span className="text-[11px] text-muted">{NOT_FROM_NUMBERS}</span>
        </button>
    );
}

// The wide container's right column: the selected lever's evidence, fix and tabs, or the tips.
function Detail({
    sel,
    view,
    tips,
    onOpenSession,
}: {
    sel: string;
    view?: LeverView;
    tips: string[];
    onOpenSession: (id: string) => void;
}) {
    return (
        <div
            data-usage-lever-detail={sel}
            // the chips are buttons: with focus on one, Enter must click it, not run the surface's list:activate
            data-owns-keys=""
            className="hidden min-w-0 flex-1 flex-col gap-3 border-l border-edge-mid pb-1 pl-7 @3xl:flex"
        >
            {view != null ? (
                <>
                    <div className="flex items-baseline gap-2.5 pb-2">
                        <span className={cn(REGION_LABEL, "text-muted")}>{LEVER_TITLE[view.key]}</span>
                        <span className="text-[12px] text-muted">{leverEvidence(view)}</span>
                    </div>
                    {view.fix != null ? (
                        <p className="m-0 max-w-[64ch] text-[13px] leading-[1.6] text-ink-hi">{view.fix}</p>
                    ) : null}
                    <Chips view={view} onOpenSession={onOpenSession} />
                </>
            ) : (
                <>
                    <div className="flex items-baseline gap-2.5 pb-2">
                        <span className={cn(REGION_LABEL, "text-muted")}>General tips</span>
                        <span className="rounded-[4px] border border-edge-mid px-1.5 py-px text-[11px] text-muted">
                            {NOT_FROM_NUMBERS}
                        </span>
                    </div>
                    <TipsList tips={tips} className="text-[13px] leading-[1.6] text-ink-hi" />
                </>
            )}
        </div>
    );
}

// `note` (the stale line) sits inside the panel, above the levers, which it dims. The levers themselves are one
// element, [data-usage-levers], so the note and an error above the card both read as above them.
export function LeversBody({
    ins,
    note,
    onOpenSession,
}: {
    ins: UsageInsights;
    note?: ReactNode;
    onOpenSession: (id: string) => void;
}) {
    const [saved, setSaved] = useAtom(insightsLeverAtom);
    const listRef = useRef<HTMLDivElement>(null);
    const views = leverViews(ins);
    const tips = ins.tips ?? [];
    const hasTips = tips.length > 0;
    const sel = selectedLeverKey(saved, views, hasTips);
    const selView = views.find((v) => v.key === sel);
    const max = views[0]?.totalUsd ?? 0; // largest first
    const keys = [...views.map((v) => v.key as string), ...(hasTips ? [TIPS_KEY] : [])];

    // ↑ / ↓ move the selection and follow it with focus. The listbox is data-owns-keys, so the surface's own list keys
    // stand down while focus is inside it (dispatcher.ts ownsKeys).
    const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
        if (e.key !== "ArrowDown" && e.key !== "ArrowUp") {
            return;
        }
        // a chip under the selected row is no option
        if ((e.target as HTMLElement).closest("[data-usage-lever]") == null) {
            return;
        }
        const next = moveCursor(keys, sel, e.key === "ArrowDown" ? 1 : -1);
        if (next == null) {
            return;
        }
        e.preventDefault();
        setSaved(next);
        listRef.current?.querySelector<HTMLElement>(`[data-usage-lever="${next}"]`)?.focus();
    };

    return (
        <div aria-live="polite" className={cn(PANEL, "px-[18px] py-[18px] @3xl:px-[22px] @3xl:py-5")}>
            {note}
            <div
                data-usage-levers=""
                className={cn("flex flex-col gap-4 @3xl:gap-[18px]", note != null && "opacity-85")}
            >
                <p className="m-0 max-w-[72ch] text-[15px] font-semibold leading-[1.45] text-primary">{ins.headline}</p>

                {sel == null ? (
                    <p className="m-0 text-[12px] leading-[1.55] text-muted">
                        No lever recovers 1% or more of this window&apos;s spend.
                    </p>
                ) : (
                    <div className="flex flex-col @3xl:flex-row @3xl:gap-7">
                        <div className="flex min-w-0 flex-col @3xl:w-[520px] @3xl:flex-none">
                            <div className="flex items-baseline gap-3 border-b border-edge-mid pb-2 @3xl:px-2.5">
                                <div className="min-w-0 flex-1">
                                    <span className={cn(REGION_LABEL, "text-muted")}>Recoverable</span>
                                </div>
                                <span className="text-[10.5px] text-muted">at most · % of spend</span>
                            </div>
                            <div
                                ref={listRef}
                                role="listbox"
                                aria-label="Levers"
                                data-owns-keys=""
                                onKeyDown={onKeyDown}
                                className="flex flex-col @3xl:gap-0.5 @3xl:pt-1.5"
                            >
                                {views.map((v, i) => (
                                    <div key={v.key} role="presentation" className={ITEM}>
                                        <LeverOption
                                            view={v}
                                            rank={i + 1}
                                            max={max}
                                            selected={sel === v.key}
                                            onPick={() => setSaved(v.key)}
                                        />
                                        {sel === v.key ? (
                                            <div
                                                data-usage-lever-inline={v.key}
                                                className="ml-[22px] flex flex-col gap-2 @3xl:hidden"
                                            >
                                                <Chips view={v} onOpenSession={onOpenSession} />
                                                {v.fix != null ? (
                                                    <p className="m-0 text-[12.5px] leading-[1.55] text-secondary">
                                                        {v.fix}
                                                    </p>
                                                ) : null}
                                            </div>
                                        ) : null}
                                    </div>
                                ))}
                                {hasTips ? (
                                    <div
                                        role="presentation"
                                        className={cn(ITEM, "border-b-0 @3xl:mt-1.5 @3xl:border-t")}
                                    >
                                        <TipsOption selected={sel === TIPS_KEY} onPick={() => setSaved(TIPS_KEY)} />
                                        {sel === TIPS_KEY ? (
                                            <div data-usage-lever-inline={TIPS_KEY} className="ml-[22px] @3xl:hidden">
                                                <TipsList
                                                    tips={tips}
                                                    className="text-[12.5px] leading-[1.55] text-secondary"
                                                />
                                            </div>
                                        ) : null}
                                    </div>
                                ) : null}
                            </div>
                        </div>
                        <Detail sel={sel} view={selView} tips={tips} onOpenSession={onOpenSession} />
                    </div>
                )}

                {views.length > 0 ? (
                    <p className="m-0 text-[11px] text-muted">Levers overlap, so they don&apos;t add up.</p>
                ) : null}
            </div>
        </div>
    );
}
