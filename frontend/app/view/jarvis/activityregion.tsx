// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The Brief's Activity region, at the top of the side column (spec 2026-11-05-jarvis-revamp-design.md decision 5,
// board Main.dc.html): the head (`Activity`, `N live`, Accept N unverified, the region-only button), the filter tabs,
// a card per live run or council, a `Queued N` line, then `Earlier · 7 days`: one 30px line per finished council and per
// run that ended without shipping, five then `+N more`, and the `+N runs older than 7 days` toggle.
//
// Presentational: the model is briefactivity.ts, and every open is a prop, so the Brief decides what a run line or a
// council line opens (the run sheet, the council sheet).

import { cn } from "@/util/util";
import type { ReactNode } from "react";
import {
    ACTIVITY_FILTERS,
    activityMeta,
    type ActivityFilter,
    type ActivityItem,
    type ActivityModel,
} from "./briefactivity";
import type { BriefLine, LineTone } from "./briefrows";
import { CURSOR_RING, cursorAttrs, LINK_BTN, TONE_TEXT } from "./briefstyle";

const DOT: Record<LineTone, string> = {
    ok: "bg-success",
    active: "bg-working",
    running: "bg-working",
    asking: "bg-asking",
    error: "bg-error",
    muted: "bg-feed-glyph",
    faint: "bg-feed-glyph",
};

const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent";

export type ActivityRegionProps = {
    model: ActivityModel;
    filter: ActivityFilter;
    onFilter: (f: ActivityFilter) => void;
    earlierOpen: boolean;
    onToggleEarlier: () => void;
    olderOpen: boolean;
    onToggleOlder: () => void;
    // queued plans the tab keeps; the line shows when there is one
    queued: number;
    onOpenQueue: () => void;
    // Accept N unverified (ackableRuns), drawn in the head when there are any
    ack?: ReactNode;
    // the region-only button the head carries, as every region head does
    only?: ReactNode;
    // the control an empty region carries (New run)
    act?: ReactNode;
    // the j/k cursor's line id, and the item whose sheet is open
    cursor?: string | null;
    selected?: string | null;
    onOpenRun: (line: BriefLine, e?: React.MouseEvent) => void;
    onOpenCouncil: (councilId: string, e?: React.MouseEvent) => void;
};

const EMPTY: Record<ActivityFilter, string> = {
    all: "Nothing is running, and nothing ended in the last seven days.",
    orchestrator: "No orchestrator run is going or ended this week.",
    quick: "No quick run is going or ended this week.",
    councils: "No council is going or ended this week.",
};

export function ActivityRegion(p: ActivityRegionProps) {
    const { model } = p;
    const open = (item: ActivityItem, e?: React.MouseEvent) =>
        item.source === "council" ? p.onOpenCouncil(item.councilId, e) : p.onOpenRun(item.line, e);
    const empty = model.live.length === 0 && model.earlierAll.length === 0 && p.queued === 0;
    return (
        <section data-jarvis-brief-region="activity" data-jarvis-activity className="flex flex-col gap-2">
            <div className="flex items-baseline gap-2">
                <span className="flex-none text-[12.5px] font-semibold text-ink-hi">Activity</span>
                <span
                    className={cn(
                        "flex-none text-[11px] tabular-nums",
                        model.live.length > 0 ? "text-success" : "text-muted"
                    )}
                >
                    {activityMeta(model)}
                </span>
                <span className="flex-1" />
                {p.ack}
                {p.only}
            </div>
            <div role="group" aria-label="Show activity of kind" className="flex flex-wrap items-center gap-1">
                {ACTIVITY_FILTERS.map((f) => (
                    <button
                        key={f}
                        type="button"
                        aria-pressed={p.filter === f}
                        data-jarvis-activity-tab={f}
                        onClick={() => p.onFilter(f)}
                        className={cn(
                            "flex cursor-pointer items-baseline gap-1.5 rounded-[5px] border px-1.5 py-px text-[10.5px]",
                            FOCUS,
                            p.filter === f
                                ? "border-edge-strong text-ink-hi"
                                : "border-transparent text-muted hover:text-ink-hi"
                        )}
                    >
                        {f}
                        <span className={cn("tabular-nums", p.filter === f ? "text-ink-mid" : "text-muted")}>
                            {model.counts[f]}
                        </span>
                    </button>
                ))}
            </div>
            {empty ? (
                <div className="flex items-center gap-3 rounded-[8px] border border-dashed border-edge-strong px-3 py-2.5">
                    <span className="min-w-0 flex-1 text-[12px] text-secondary">{EMPTY[p.filter]}</span>
                    {p.act}
                </div>
            ) : null}
            {model.live.map((item) => (
                <LiveCard
                    key={item.id}
                    item={item}
                    focused={p.cursor === item.line.id}
                    selected={p.selected === item.id}
                    onOpen={(e) => open(item, e)}
                />
            ))}
            {p.queued > 0 ? (
                <button
                    type="button"
                    data-jarvis-activity-queued
                    onClick={p.onOpenQueue}
                    className={cn(
                        "flex h-[26px] cursor-pointer items-center gap-2 rounded-[6px] px-1 text-left text-[11.5px] text-secondary hover:bg-surface-hover",
                        FOCUS
                    )}
                >
                    <span className="h-1.5 w-1.5 flex-none rounded-full bg-feed-glyph" />
                    Queued <span className="tabular-nums text-ink-mid">{p.queued}</span>
                </button>
            ) : null}
            {model.earlierAll.length > 0 || model.older.length > 0 ? (
                <div className="mt-1 flex flex-col">
                    <span className="text-[10.5px] text-ink-faint">Earlier · 7 days</span>
                    {model.earlier.map((item) => (
                        <EarlierLine
                            key={item.id}
                            item={item}
                            focused={p.cursor === item.line.id}
                            selected={p.selected === item.id}
                            onOpen={(e) => open(item, e)}
                        />
                    ))}
                    {model.earlierMore > 0 || p.earlierOpen ? (
                        <button
                            type="button"
                            data-jarvis-activity-more={p.earlierOpen ? "less" : "more"}
                            onClick={p.onToggleEarlier}
                            className={cn(LINK_BTN, "mt-1")}
                        >
                            {p.earlierOpen ? "Show less" : `+${model.earlierMore} more`}
                        </button>
                    ) : null}
                    {p.olderOpen
                        ? model.older.map((item) => (
                              <EarlierLine
                                  key={item.id}
                                  item={item}
                                  focused={p.cursor === item.line.id}
                                  selected={p.selected === item.id}
                                  onOpen={(e) => open(item, e)}
                              />
                          ))
                        : null}
                    {model.older.length > 0 ? (
                        <button
                            type="button"
                            aria-expanded={p.olderOpen}
                            data-jarvis-brief-stale
                            onClick={p.onToggleOlder}
                            className={cn(LINK_BTN, "mt-1")}
                        >
                            {p.olderOpen ? `Hide ${model.older.length}` : `+${model.older.length}`}{" "}
                            {model.older.length === 1 ? "run" : "runs"} older than 7 days
                        </button>
                    ) : null}
                </div>
            ) : null}
        </section>
    );
}

function LiveCard({
    item,
    focused,
    selected,
    onOpen,
}: {
    item: ActivityItem;
    focused: boolean;
    selected: boolean;
    onOpen: (e?: React.MouseEvent) => void;
}) {
    return (
        <button
            type="button"
            data-jarvis-activity-card={item.source}
            data-jarvis-activity-id={item.id}
            {...cursorAttrs(focused)}
            onClick={onOpen}
            className={cn(
                "flex w-full cursor-pointer flex-col gap-1 rounded-[8px] border bg-surface-raised px-2.5 py-[9px] text-left hover:bg-surface-hover",
                selected ? "border-edge-strong" : "border-edge-mid",
                FOCUS,
                focused && CURSOR_RING
            )}
        >
            <span className="flex w-full items-center gap-1.5">
                <span className={cn("h-1.5 w-1.5 flex-none rounded-full", DOT[item.stageTone])} />
                <span className="min-w-0 truncate text-[10.5px] text-muted">{item.kind}</span>
                <span className="flex-1" />
                <span className={cn("flex-none text-[10.5px] font-semibold", TONE_TEXT[item.stageTone])}>
                    {item.stage}
                </span>
            </span>
            <span title={item.title} className="line-clamp-2 break-words text-[12.5px] leading-[17px] text-ink-hi">
                {item.title}
            </span>
            <span className="truncate text-[10.5px] text-muted">{item.meta}</span>
        </button>
    );
}

function EarlierLine({
    item,
    focused,
    selected,
    onOpen,
}: {
    item: ActivityItem;
    focused: boolean;
    selected: boolean;
    onOpen: (e?: React.MouseEvent) => void;
}) {
    return (
        <button
            type="button"
            data-jarvis-activity-line={item.source}
            data-jarvis-activity-id={item.id}
            {...cursorAttrs(focused)}
            onClick={onOpen}
            title={item.stage !== "" ? `${item.title} · ${item.stage}` : item.title}
            className={cn(
                "flex h-[30px] w-full flex-none cursor-pointer items-center gap-2 rounded-[6px] px-1 text-left hover:bg-surface-hover",
                selected && "bg-surface-selected",
                FOCUS,
                focused && CURSOR_RING
            )}
        >
            <span
                className={cn(
                    "flex-none rounded-[4px] border border-edge-mid px-[5px] py-px text-[10px]",
                    item.stageTone === "error" ? "text-error" : "text-muted"
                )}
            >
                {item.chip}
            </span>
            <span className="min-w-0 flex-1 truncate text-[12px] text-secondary">{item.title}</span>
            <span className="flex-none text-[10.5px] tabular-nums text-ink-faint">{item.age}</span>
        </button>
    );
}
